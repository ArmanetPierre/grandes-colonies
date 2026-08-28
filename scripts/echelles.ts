/**
 * Mesure des échelles de plateau.
 *
 * Question : un plateau nettement plus grand reste-t-il jouable, et à quel
 * prix en durée ? On mesure plutôt que de supposer — c'est la méthode de
 * SIMULATION_FINDINGS.md, et la seule qui ait déjà eu raison ici.
 */
import {
  type BoardScale, SeededRandom, archipelagoBoard, archipelagoOptionsFor,
  defaultConfig, xxlBoard, xxlOptionsFor,
} from '@grand-colonies/engine';
import { GreedyBot, playGame } from '@grand-colonies/sim';

const PARTIES = 16;
const scales: BoardScale[] = ['normal', 'grand', 'immense'];

function mesure(players: number, kind: 'archipelago' | 'disc', scale: BoardScale, roads: number) {
  const cycles: number[] = [];
  const gagnants: number[] = [];
  const constructions: number[] = [];
  let conclues = 0;
  let hexes = 0;
  let terres = 0;

  for (let i = 0; i < PARTIES; i++) {
    const seed = `ech-${players}-${kind}-${scale}-${roads}-${i}`;
    const rng = new SeededRandom(`${seed}:board`);
    const board = kind === 'disc'
      ? xxlBoard(rng, xxlOptionsFor(players, scale))
      : archipelagoBoard(rng, archipelagoOptionsFor(players, scale));
    terres = kind === 'disc' ? xxlOptionsFor(players, scale).landCount
      : archipelagoOptionsFor(players, scale).landCount;
    hexes = board.positions.length;

    const out = playGame({
      playerCount: players, seed, board,
      config: { ...defaultConfig(players), roadsPerPlayer: roads },
      makeBot: () => new GreedyBot(), maxCycles: 600,
    });
    cycles.push(out.cycles);
    if (!out.exhausted) conclues++;
    gagnants.push(Math.max(...out.points));
    constructions.push(out.builds.reduce((a, b) => a + b, 0) / players);
  }

  const moy = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;
  console.log(
    `${String(players).padStart(2)}j ${kind === 'disc' ? 'disque ' : 'archip.'} ${scale.padEnd(8)}`,
    `terres=${String(terres).padStart(3)} hex=${String(hexes).padStart(4)} routes=${String(roads).padStart(2)}`,
    `| conclues ${String(conclues).padStart(2)}/${PARTIES}`,
    `| cycles méd ${String(med(cycles)).padStart(3)} moy ${String(Math.round(moy(cycles))).padStart(3)}`,
    `| pts gagnant ${moy(gagnants).toFixed(1)}`,
    `| constr/j ${moy(constructions).toFixed(1)}`,
  );
}

for (const players of [12, 8]) {
  for (const scale of scales) mesure(players, 'archipelago', scale, 20);
  console.log('');
}
console.log('— dotation de routes portée à 30 sur les grands plateaux —');
for (const scale of scales) mesure(12, 'archipelago', scale, 30);
console.log('');
console.log('— plateau en disque —');
for (const scale of scales) mesure(12, 'disc', scale, 20);
