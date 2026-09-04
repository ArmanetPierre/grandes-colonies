/**
 * Mesurer les adversaires : les niveaux se départagent-ils vraiment ?
 *
 * Un jeu qui propose quatre niveaux doit pouvoir montrer que le quatrième bat
 * le premier, sinon il propose quatre décors. C'est ce que ce script vérifie,
 * en faisant s'affronter deux fabriques de bots à sièges alternés — l'ordre
 * du tour compte, et le mesurer d'un seul côté fausserait tout.
 *
 *   npx tsx scripts/adversaires.ts            duels et tables, réglage par défaut
 *   npx tsx scripts/adversaires.ts 24 6       vingt-quatre parties à six joueurs
 */

import {
  type Bot,
  GreedyBot,
  NIVEAU_IDS,
  PiloteBot,
  playGame,
} from '@grandes-colonies/sim';

const PARTIES = Number(process.argv[2] ?? 16);
const JOUEURS = Number(process.argv[3] ?? 6);

type Fabrique = (index: number, graine: string) => Bot;

/** Deux fabriques, sièges alternés d'une partie à l'autre. */
function duel(nom: string, a: Fabrique, b: Fabrique): void {
  let pointsA = 0, pointsB = 0, victoiresA = 0, victoiresB = 0, nulles = 0, cycles = 0;
  for (let g = 0; g < PARTIES; g++) {
    const graine = `duel-${g}`;
    const decale = g % 2;
    const partie = playGame({
      playerCount: JOUEURS,
      seed: graine,
      makeBot: (i) => ((i + decale) % 2 === 0 ? a(i, graine) : b(i, graine)),
    });
    cycles += partie.cycles;
    partie.points.forEach((p, i) => { if ((i + decale) % 2 === 0) pointsA += p; else pointsB += p; });
    const gagnant = partie.winner === undefined ? -1 : Number(partie.winner.slice(1)) - 1;
    if (gagnant < 0) nulles++;
    else if ((gagnant + decale) % 2 === 0) victoiresA++;
    else victoiresB++;
  }
  const sieges = (PARTIES * JOUEURS) / 2;
  console.log(
    `${nom.padEnd(26)} ${String(victoiresA).padStart(3)} — ${String(victoiresB).padEnd(3)}`
    + ` (${nulles} sans vainqueur)   points ${(pointsA / sieges).toFixed(1)} contre ${(pointsB / sieges).toFixed(1)}`
    + `   ${(cycles / PARTIES).toFixed(0)} cycles`,
  );
}

/** Une table entière au même niveau : ce qu'une soirée donnerait. */
function table(niveau: number): void {
  let cycles = 0, achevees = 0, offres = 0, acceptees = 0, banque = 0, ports = 0;
  let annonces = 0, defausses = 0, meilleur = 0;
  for (let g = 0; g < PARTIES; g++) {
    const partie = playGame({
      playerCount: JOUEURS,
      seed: `table-${g}`,
      makeBot: (i) => new PiloteBot(i, { niveau, graine: `table-${g}` }),
    });
    cycles += partie.cycles;
    if (!partie.exhausted) achevees++;
    offres += partie.tradesOffered;
    acceptees += partie.tradesAccepted;
    banque += partie.bankTrades;
    ports += partie.portTrades;
    annonces += partie.buildsResolved;
    defausses += partie.discards;
    meilleur += Math.max(...partie.points);
  }
  const taux = offres === 0 ? 0 : Math.round((100 * acceptees) / offres);
  console.log(
    `niveau ${niveau}   ${(cycles / PARTIES).toFixed(0).padStart(4)} cycles`
    + `   ${achevees}/${PARTIES} conclues`
    + `   meilleur score ${(meilleur / PARTIES).toFixed(1)}`
    + `   offres ${(offres / PARTIES).toFixed(0)} (${taux} % acceptées)`
    + `   banque ${(banque / PARTIES).toFixed(0)}   ports ${(ports / PARTIES).toFixed(0)}`
    + `   annonces ${(annonces / PARTIES).toFixed(0)}   défausses ${(defausses / PARTIES).toFixed(0)}`,
  );
}

console.log(`\n  ${PARTIES} parties à ${JOUEURS} joueurs\n`);

console.log('  Duels — sièges alternés, même plateau des deux côtés\n');
duel('niveau 4 contre niveau 1',
  (i, g) => new PiloteBot(i, { niveau: 4, graine: g }),
  (i, g) => new PiloteBot(i, { niveau: 1, graine: g }));
duel('niveau 4 contre niveau 3',
  (i, g) => new PiloteBot(i, { niveau: 4, graine: g }),
  (i, g) => new PiloteBot(i, { niveau: 3, graine: g }));
duel('niveau 3 contre niveau 2',
  (i, g) => new PiloteBot(i, { niveau: 3, graine: g }),
  (i, g) => new PiloteBot(i, { niveau: 2, graine: g }));
duel('niveau 2 contre niveau 1',
  (i, g) => new PiloteBot(i, { niveau: 2, graine: g }),
  (i, g) => new PiloteBot(i, { niveau: 1, graine: g }));
duel('niveau 2 contre l’ancien',
  (i, g) => new PiloteBot(i, { niveau: 2, graine: g }),
  () => new GreedyBot());

console.log('\n  Tables entières — une soirée au même niveau\n');
for (const niveau of NIVEAU_IDS) table(niveau);
console.log('');
