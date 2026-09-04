/**
 * Mesure du marché dynamique (§10).
 *
 * Trois questions, dans l'ordre où elles peuvent tuer la mécanique :
 *
 * 1. Le cours **vit-il** ? Un marché resté sur ses valeurs d'ouverture
 *    pendant deux cents cycles n'est pas un marché, c'est un barème.
 * 2. S'emballe-t-il ? Six cours collés au plafond signifieraient que le
 *    palier est trop court, ou que rien ne les fait redescendre.
 * 3. Coûte-t-il la partie ? Des conversions plus chères, ce sont des
 *    constructions en moins et des parties qui n'aboutissent plus.
 *
 * Le témoin est l'ancien jeu : cours plat à 4:1, palier hors d'atteinte.
 * C'est exactement le comportement d'avant le marché, ce qui rend les deux
 * colonnes comparables.
 */
import {
  type MarketConfig, SeededRandom, archipelagoBoard, archipelagoOptionsFor, defaultConfig,
} from '@grandes-colonies/engine';
import { GreedyBot, playGame } from '@grandes-colonies/sim';

const PARTIES = Number(process.env.PARTIES ?? 16);
const TRADED = ['wood', 'brick', 'wool', 'grain', 'ore', 'gold'] as const;

/** Le marché d'avant : un taux figé que rien ne déplace. */
const MARCHE_FIGE: MarketConfig = Object.freeze({
  opening: Object.freeze({
    wood: 4, brick: 4, wool: 4, grain: 4, ore: 4, gold: 4, fish: 4,
  }),
  step: Number.MAX_SAFE_INTEGER,
  minimum: 2,
  maximum: 6,
});

function mesure(label: string, players: number, market?: MarketConfig) {
  const cycles: number[] = [];
  const gagnants: number[] = [];
  const constructions: number[] = [];
  const banque: number[] = [];
  const amplitudes: number[] = [];
  const bornes: number[] = [];
  let conclues = 0;

  for (let i = 0; i < PARTIES; i++) {
    const seed = `marche-${players}-${i}`;
    const rng = new SeededRandom(`${seed}:board`);
    const board = archipelagoBoard(rng, archipelagoOptionsFor(players));
    const base = defaultConfig(players);

    const out = playGame({
      playerCount: players, seed, board,
      config: market ? { ...base, market } : base,
      makeBot: () => new GreedyBot(), maxCycles: 600,
    });

    cycles.push(out.cycles);
    if (!out.exhausted) conclues++;
    gagnants.push(Math.max(...out.points));
    constructions.push(out.builds.reduce((a, b) => a + b, 0) / players);
    banque.push(out.bankTrades);

    // Amplitude : de combien de crans le cours le plus mobile a bougé.
    const rates = TRADED.map((r) => out.marketRates[r] ?? 4);
    const opening = TRADED.map((r) => (market ?? base.market).opening[r] ?? 4);
    amplitudes.push(Math.max(...rates.map((v, k) => Math.abs(v - (opening[k] ?? 4)))));
    bornes.push(rates.filter((v) => v === 6 || v === 2).length);
  }

  const moy = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

  console.log(
    `${label.padEnd(14)}`,
    `| conclues ${String(conclues).padStart(2)}/${PARTIES}`,
    `| cycles méd ${String(med(cycles)).padStart(3)}`,
    `| pts gagnant ${moy(gagnants).toFixed(1)}`,
    `| constr/j ${moy(constructions).toFixed(1)}`,
    `| échanges banque ${moy(banque).toFixed(0).padStart(3)}`,
    `| amplitude ${moy(amplitudes).toFixed(1)}`,
    `| cours aux bornes ${moy(bornes).toFixed(1)}/6`,
  );
}

/** Un marché plus doux : mêmes cours d'ouverture, moins d'amplitude. */
const resserre = (step: number, minimum: number, maximum: number): MarketConfig =>
  Object.freeze({ ...defaultConfig(8).market, step, minimum, maximum });

for (const players of [12, 8]) {
  console.log(`— ${players} joueurs, archipel, ${PARTIES} parties —`);
  mesure('marché figé', players, MARCHE_FIGE);
  mesure('§10 pal.4 2-6', players);
  if (process.env.VARIANTES) {
    mesure('§10 pal.6 2-6', players, resserre(6, 2, 6));
    mesure('§10 pal.4 3-5', players, resserre(4, 3, 5));
  }
  console.log('');
}
