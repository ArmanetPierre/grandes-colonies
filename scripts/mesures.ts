/**
 * Lit le journal d'une partie et en imprime les mesures (Phase 8 du plan).
 *
 *   npx tsx scripts/mesures.ts parties/partie-xxx.jsonl
 *   npx tsx scripts/mesures.ts            # la partie la plus récente
 *
 * Sert à confronter les impressions des joueurs aux chiffres : « j'ai eu
 * l'impression d'attendre » se vérifie sur la plus longue attente, et non sur
 * un souvenir.
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { measure, readJournal } from '../packages/server/src/index.js';

const ROOT = resolve(import.meta.dirname ?? '.', '..');

/** Le journal le plus récemment écrit, faute d'un chemin donné. */
function dernierePartie(): string | undefined {
  const dossier = join(ROOT, 'parties');
  try {
    const fichiers = readdirSync(dossier)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => ({ f, at: statSync(join(dossier, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at);
    return fichiers[0] ? join(dossier, fichiers[0].f) : undefined;
  } catch {
    return undefined;
  }
}

const chemin = process.argv[2] ? resolve(process.argv[2]) : dernierePartie();
if (!chemin) {
  console.error('Aucun journal. Jouez une partie, ou donnez un chemin en argument.');
  process.exit(1);
}

const journal = readJournal(chemin);
if (!journal) {
  console.error(`Journal illisible : ${chemin}`);
  process.exit(1);
}

const m = measure(journal);
const s = (ms: number): string => `${(ms / 1000).toFixed(0)} s`;
const mn = (ms: number): string => `${(ms / 60000).toFixed(1)} min`;

console.log('');
console.log(`  ${m.gameId} — ${m.playerCount} joueurs`);
console.log('');
console.log(`  Durée totale        ${mn(m.totalMs)}`);
console.log(`  Cycles joués        ${m.cycles.length}`);
console.log(`  Cycle médian        ${s(m.medianCycleMs)}`);
console.log(`  Commandes           ${m.commands}`);
console.log('');
console.log(`  Échanges proposés   ${m.tradesOffered}`);
console.log(`  Échanges acceptés   ${m.tradesAccepted}`
  + (m.tradesOffered > 0 ? `  (${Math.round((m.tradesAccepted / m.tradesOffered) * 100)} %)` : ''));
console.log(`  Annonces            ${m.buildsDeclared} (${m.buildsCancelled} annulées)`);
console.log(`  Tours joués d'office ${m.timeouts}`);
if (m.hostInterventions > 0) {
  console.log(`  ⚠ Interventions du maître de jeu : ${m.hostInterventions} — cette partie est truquée`);
}
console.log('');
console.log('  joueur | gestes | d\'office | échanges | annonces | attente max | attente moy.');
console.log('  ' + '-'.repeat(76));
for (const p of m.players) {
  console.log(
    `  ${p.player.padEnd(6)} | ${String(p.commands).padStart(6)} | ${String(p.timeouts).padStart(8)}`
    + ` | ${String(p.tradesOffered).padStart(8)} | ${String(p.buildsDeclared).padStart(8)}`
    + ` | ${s(p.longestSilenceMs).padStart(11)} | ${s(p.averageGapMs).padStart(12)}`,
  );
}
console.log('');
