#!/usr/bin/env node
/**
 * Génération des images de Grand Colonies via l'API Gemini (Google AI Studio).
 *
 * La clé n'est jamais écrite dans le dépôt : elle est lue depuis la variable
 * d'environnement GEMINI_API_KEY, ou depuis un fichier .env local (gitignoré).
 *
 *   node scripts/generate-assets.mjs --list
 *   node scripts/generate-assets.mjs --priority P0
 *   node scripts/generate-assets.mjs --id tile_forest --force
 *
 * Voir assets/README.md.
 */

import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://generativelanguage.googleapis.com/v1beta';

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { priority: null, id: null, force: false, list: false, model: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--list') args.list = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--priority') args.priority = argv[++i]?.toUpperCase();
    else if (a === '--id') args.id = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--help' || a === '-h') args.list = true;
  }
  return args;
}

// ------------------------------------------------------------------- clé API

async function loadApiKey() {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY.trim();
  if (process.env.GOOGLE_API_KEY) return process.env.GOOGLE_API_KEY.trim();

  try {
    const env = await readFile(join(ROOT, '.env'), 'utf8');
    const match = env.match(/^\s*(?:GEMINI|GOOGLE)_API_KEY\s*=\s*["']?([^"'\s#]+)/m);
    if (match) return match[1];
  } catch { /* pas de .env : on tombe dans l'erreur ci-dessous */ }

  throw new Error(
    'Clé API introuvable.\n\n' +
    "  Option 1 (recommandée) — pour la session courante du terminal :\n" +
    '    export GEMINI_API_KEY="ta-clé"\n\n' +
    "  Option 2 — fichier local, déjà gitignoré :\n" +
    '    echo \'GEMINI_API_KEY=ta-clé\' > .env\n\n' +
    '  Clé à créer sur https://aistudio.google.com/apikey'
  );
}

// ------------------------------------------------------- découverte du modèle

/**
 * Les noms de modèles d'image de Google changent souvent (Imagen a été arrêté
 * le 17/08/2026 au profit de Nano Banana). Plutôt que de coder un nom en dur,
 * on interroge l'API pour prendre le meilleur modèle d'image réellement
 * disponible sur cette clé.
 */
async function discoverImageModel(key, override) {
  if (override) return override;

  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) throw new Error(`Impossible de lister les modèles (HTTP ${res.status}) : ${await res.text()}`);

  const { models = [] } = await res.json();
  const candidates = models.filter(m =>
    (m.supportedGenerationMethods || []).includes('generateContent') &&
    /image/i.test(m.name) &&
    !/vision|understand|embed/i.test(m.name)
  );

  if (!candidates.length) {
    throw new Error(
      "Aucun modèle de génération d'image disponible sur cette clé.\n" +
      'Modèles visibles : ' + models.map(m => m.name.replace('models/', '')).join(', ')
    );
  }

  // Préférence : version numérique la plus élevée, puis "pro" avant "flash".
  const score = (m) => {
    const v = parseFloat((m.name.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]) || 0;
    return v * 10 + (/pro/i.test(m.name) ? 2 : /flash/i.test(m.name) ? 1 : 0);
  };
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0].name.replace('models/', '');
}

// ------------------------------------------------------------------ génération

function buildPrompt(asset, manifest) {
  const styleKey = asset.style || asset.category;
  const style = manifest.style[styleKey] || manifest.style[asset.category];
  return `${asset.subject}. ${style}. Avoid: ${manifest.negative}.`;
}

/**
 * Appelle le modèle et renvoie le PNG en Buffer.
 * Les variantes de payload couvrent les différences entre versions de l'API :
 * certaines exigent TEXT en plus d'IMAGE, d'autres ignorent imageConfig.
 */
async function generateImage(key, model, prompt, aspect) {
  const variants = [
    { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: aspect } },
    { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio: aspect } },
    { responseModalities: ['IMAGE'] },
    {},
  ];

  let lastError;
  for (const generationConfig of variants) {
    const body = { contents: [{ parts: [{ text: prompt }] }] };
    if (Object.keys(generationConfig).length) body.generationConfig = generationConfig;

    const res = await fetch(`${API}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'x-goog-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (res.status === 429 || res.status >= 500) {
      lastError = new Error(`HTTP ${res.status} — quota ou serveur indisponible`);
      await new Promise(r => setTimeout(r, 4000));
      continue;
    }
    if (!res.ok) {
      lastError = new Error(`HTTP ${res.status} : ${(await res.text()).slice(0, 300)}`);
      continue; // payload refusé : on essaie la variante suivante
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const image = parts.find(p => p.inlineData?.data);
    if (image) return Buffer.from(image.inlineData.data, 'base64');

    const blocked = data.candidates?.[0]?.finishReason;
    lastError = new Error(`Réponse sans image${blocked ? ` (finishReason: ${blocked})` : ''}`);
  }
  throw lastError ?? new Error('Échec inconnu');
}

// ------------------------------------------------------------------- exécution

const exists = (p) => access(p).then(() => true, () => false);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(join(ROOT, 'assets/prompts.json'), 'utf8'));

  let assets = manifest.assets;
  if (args.priority) assets = assets.filter(a => a.priority === args.priority);
  if (args.id) assets = assets.filter(a => a.id === args.id);

  if (args.list) {
    console.log('\nAssets du manifeste :\n');
    const byPriority = {};
    for (const a of manifest.assets) (byPriority[a.priority] ||= []).push(a);
    for (const p of Object.keys(byPriority).sort()) {
      console.log(`  ${p} — ${byPriority[p].length} images`);
      for (const a of byPriority[p]) console.log(`     ${a.id.padEnd(22)} ${a.aspect.padEnd(6)} ${a.category}`);
    }
    console.log('\nUsage :');
    console.log('  node scripts/generate-assets.mjs --priority P0');
    console.log('  node scripts/generate-assets.mjs --id tile_forest --force');
    console.log('  node scripts/generate-assets.mjs --dry-run --priority P0   (affiche les prompts)\n');
    return;
  }

  if (!assets.length) {
    console.error('Aucun asset ne correspond aux filtres.');
    process.exitCode = 1;
    return;
  }

  if (args.dryRun) {
    for (const a of assets) {
      console.log(`\n──────── ${a.id} (${a.aspect}) ────────\n${buildPrompt(a, manifest)}`);
    }
    return;
  }

  const key = await loadApiKey();
  const model = await discoverImageModel(key, args.model);
  console.log(`Modèle : ${model}`);
  console.log(`À générer : ${assets.length} image(s)\n`);

  let done = 0, skipped = 0, failed = 0;

  for (const asset of assets) {
    const out = join(ROOT, 'assets/generated', asset.category, `${asset.id}.png`);

    if (!args.force && await exists(out)) {
      console.log(`  ⊘ ${asset.id.padEnd(22)} déjà généré (--force pour refaire)`);
      skipped++;
      continue;
    }

    process.stdout.write(`  … ${asset.id.padEnd(22)} `);
    try {
      const png = await generateImage(key, model, buildPrompt(asset, manifest), asset.aspect);
      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, png);
      console.log(`✓ ${(png.length / 1024).toFixed(0)} Ko`);
      done++;
    } catch (err) {
      console.log(`✗ ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${done} générée(s), ${skipped} ignorée(s), ${failed} en échec.`);
  if (done) console.log('Contrôle qualité : ouvrir assets/preview/index.html');
  if (failed) process.exitCode = 1;
}

main().catch(err => {
  console.error(`\n${err.message}\n`);
  process.exitCode = 1;
});
