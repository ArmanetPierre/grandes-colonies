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

import { readFile, writeFile, mkdir, access, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://generativelanguage.googleapis.com/v1beta';

// ---------------------------------------------------------------- arguments

function parseArgs(argv) {
  const args = { priority: null, id: null, force: false, list: false, model: null, dryRun: false, tier: 'balanced', yes: false, manifest: 'assets/prompts.json' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--force') args.force = true;
    else if (a === '--list') args.list = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a === '--best') args.tier = 'best';
    else if (a === '--cheap') args.tier = 'cheap';
    else if (a === '--yes' || a === '-y') args.yes = true;
    else if (a === '--priority') args.priority = argv[++i]?.toUpperCase();
    else if (a === '--id') args.id = argv[++i];
    else if (a === '--model') args.model = argv[++i];
    else if (a === '--manifest') args.manifest = argv[++i];
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
 * Tarifs indicatifs par image générée, en USD (relevés le 26/08/2026).
 * Servent uniquement à estimer et à afficher le coût avant de dépenser :
 * la facturation réelle fait foi. Voir https://ai.google.dev/gemini-api/docs/pricing
 */
const PRICING = [
  { match: /gemini-3-pro-image/,          usd: 0.134, label: 'Nano Banana Pro' },
  { match: /gemini-3\.1-flash-lite-image/, usd: 0.0336, label: 'Nano Banana 2 Lite' },
  { match: /gemini-3\.1-flash-image/,     usd: 0.067, label: 'Nano Banana 2' },
  { match: /gemini-2\.5-flash-image/,     usd: 0.039, label: 'Nano Banana (retiré le 02/10/2026)' },
];

const priceOf = (model) => PRICING.find(p => p.match.test(model)) ?? { usd: null, label: 'tarif inconnu' };

/**
 * Les noms de modèles d'image de Google changent souvent (Imagen a été arrêté
 * le 17/08/2026 au profit de Nano Banana). Plutôt que de coder un nom en dur,
 * on interroge l'API pour prendre le modèle d'image réellement disponible.
 *
 * Par défaut on privilégie un modèle "flash" : sur ce projet, la contrainte est
 * la cohérence d'une série de tuiles, pas le rendu d'une image isolée, et un
 * modèle "pro" coûte environ le double sans mieux y répondre. --best et --cheap
 * permettent de choisir explicitement.
 */
async function discoverImageModel(key, override, tier) {
  if (override) return override;

  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) {
    const body = await res.text();
    if (/API_KEY_INVALID/.test(body)) {
      throw new Error(
        "La clé API est refusée par Google.\n\n" +
        `  Clé lue : ${key.length} caractères, commençant par « ${key.slice(0, 3)} »\n\n` +
        '  Formats attendus :\n' +
        '    « AQ. »  clé d\'autorisation — format actuel, ~53 caractères\n' +
        '    « AIza » ancienne clé standard — rejetée depuis septembre 2026\n\n' +
        "  Cause la plus fréquente : un caractère parasite ajouté au collage.\n" +
        '  Vérifier le début et la fin de la valeur dans .env, ou recopier la clé\n' +
        '  avec le bouton de copie sur https://aistudio.google.com/apikey'
      );
    }
    if (res.status === 403) {
      throw new Error(
        "Clé valide mais accès refusé (HTTP 403).\n" +
        "  Vérifier que l'API Generative Language est activée et que la facturation\n" +
        '  est bien liée au projet Google auquel appartient cette clé.'
      );
    }
    throw new Error(`Impossible de lister les modèles (HTTP ${res.status}) : ${body}`);
  }

  const { models = [] } = await res.json();
  const candidates = models
    .filter(m =>
      (m.supportedGenerationMethods || []).includes('generateContent') &&
      /image/i.test(m.name) &&
      !/vision|understand|embed/i.test(m.name))
    .map(m => m.name.replace('models/', ''));

  if (!candidates.length) {
    throw new Error(
      "Aucun modèle de génération d'image disponible sur cette clé.\n" +
      'Modèles visibles : ' + models.map(m => m.name.replace('models/', '')).join(', ')
    );
  }

  const version = (n) => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]) || 0;
  const family = (n) => /lite/i.test(n) ? 'lite' : /pro/i.test(n) ? 'pro' : /flash/i.test(n) ? 'flash' : 'other';

  // Ordre de préférence des familles selon le palier demandé.
  const order = { best: ['pro', 'flash', 'lite'], cheap: ['lite', 'flash', 'pro'], balanced: ['flash', 'lite', 'pro'] }[tier];

  candidates.sort((a, b) => {
    const fa = order.indexOf(family(a)), fb = order.indexOf(family(b));
    if (fa !== fb) return (fa < 0 ? 99 : fa) - (fb < 0 ? 99 : fb);
    return version(b) - version(a); // à famille égale, version la plus récente
  });

  return candidates[0];
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
    if (image) return {
      buffer: Buffer.from(image.inlineData.data, 'base64'),
      mimeType: image.inlineData.mimeType || 'image/png',
    };

    const blocked = data.candidates?.[0]?.finishReason;
    lastError = new Error(`Réponse sans image${blocked ? ` (finishReason: ${blocked})` : ''}`);
  }
  throw lastError ?? new Error('Échec inconnu');
}

// ------------------------------------------------------------------- exécution

const exists = (p) => access(p).then(() => true, () => false);

/** Le modèle renvoie du JPEG ou du PNG selon les cas : on nomme le fichier d'après le contenu réel. */
const extFor = (mimeType) => (/jpe?g/i.test(mimeType) ? 'jpg' : /webp/i.test(mimeType) ? 'webp' : 'png');

/** Un asset est considéré comme déjà généré quelle que soit son extension. */
async function findExisting(outDir, category, id) {
  for (const ext of ['png', 'jpg', 'webp']) {
    const p = join(ROOT, outDir, category, `${id}.${ext}`);
    if (await exists(p)) return p;
  }
  return null;
}

/**
 * Écrit assets/generated/index.json : identifiant -> chemin réel du fichier.
 * Le modèle renvoie tantôt du JPEG tantôt du PNG ; sans cet index, tout
 * consommateur devrait deviner l'extension en enchaînant des requêtes en échec.
 */
async function writeIndex(manifest, outDir) {
  const index = {};
  for (const asset of manifest.assets) {
    const found = await findExisting(outDir, asset.category, asset.id);
    if (found) index[asset.id] = `${asset.category}/${found.split('/').pop()}`;
  }
  await writeFile(
    join(ROOT, outDir, 'index.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), files: index }, null, 2) + '\n'
  );
  // Variante JS : la planche de contrôle s'ouvre en file://, où fetch() est
  // bloqué par la politique d'origine. Une balise <script>, elle, fonctionne.
  await writeFile(
    join(ROOT, outDir, 'index.js'),
    `window.ASSET_INDEX = ${JSON.stringify(index, null, 2)};\n`
  );
  return Object.keys(index).length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const manifest = JSON.parse(await readFile(join(ROOT, args.manifest), 'utf8'));
  const outDir = manifest.outDir || 'assets/generated';

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
  const model = await discoverImageModel(key, args.model, args.tier);
  const price = priceOf(model);

  // Ne compter que ce qui sera réellement généré.
  const todo = [];
  for (const a of assets) {
    if (!args.force && await findExisting(outDir, a.category, a.id)) continue;
    todo.push(a);
  }

  console.log(`Modèle    : ${model}  (${price.label})`);
  console.log(`À générer : ${todo.length} image(s) sur ${assets.length} sélectionnée(s)`);
  if (price.usd !== null) {
    console.log(`Coût estimé : ~${(todo.length * price.usd).toFixed(2)} USD  (${price.usd} / image)`);
  } else {
    console.log('Coût estimé : inconnu pour ce modèle');
  }
  console.log('');

  if (todo.length && !args.yes) {
    process.stdout.write('Démarrage dans 4 s — Ctrl+C pour annuler…');
    await new Promise(r => setTimeout(r, 4000));
    console.log('\n');
  }

  let done = 0, skipped = assets.length - todo.length, failed = 0;

  for (const asset of todo) {
    process.stdout.write(`  … ${asset.id.padEnd(22)} `);
    try {
      const { buffer, mimeType } = await generateImage(key, model, buildPrompt(asset, manifest), asset.aspect);
      const ext = extFor(mimeType);
      const out = join(ROOT, outDir, asset.category, `${asset.id}.${ext}`);

      // Éviter de laisser deux fichiers du même asset avec des extensions différentes.
      if (args.force) {
        const stale = await findExisting(outDir, asset.category, asset.id);
        if (stale && stale !== out) await rm(stale);
      }

      await mkdir(dirname(out), { recursive: true });
      await writeFile(out, buffer);
      console.log(`✓ ${(buffer.length / 1024).toFixed(0)} Ko  .${ext}`);
      done++;
    } catch (err) {
      console.log(`✗ ${err.message}`);
      failed++;
    }
  }

  await mkdir(join(ROOT, outDir), { recursive: true });
  const indexed = await writeIndex(manifest, outDir);
  console.log(`\n${done} générée(s), ${skipped} ignorée(s), ${failed} en échec.`);
  console.log(`Index mis à jour : ${indexed} fichier(s) référencé(s).`);
  if (done && price.usd !== null) console.log(`Coût approximatif de ce passage : ~${(done * price.usd).toFixed(2)} USD`);
  if (done) console.log('Contrôle qualité : ouvrir assets/preview/index.html');
  if (failed) process.exitCode = 1;
}

main().catch(err => {
  console.error(`\n${err.message}\n`);
  process.exitCode = 1;
});
