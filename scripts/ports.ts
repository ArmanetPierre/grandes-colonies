/**
 * Mesure des ports à contrat (§11).
 *
 * Deux questions :
 *
 * 1. Le port commercial **sert-il** ? Un port qu'aucune main ne peut
 *    utiliser serait un panneau posé sur l'eau.
 * 2. Est-il trop fort ? Deux cartes pour une, sans condition de nature, ce
 *    serait le meilleur taux du jeu offert à qui pose une colonie au bon
 *    endroit. La contrainte — deux natures différentes — est censée le
 *    ramener à sa place.
 *
 * Le témoin retire les deux ports du plateau après génération, ce qui laisse
 * tout le reste identique : mêmes terres, mêmes jetons, mêmes autres ports.
 */
import {
  type BoardInit, type Port, type VertexId, SeededRandom,
  archipelagoBoard, archipelagoOptionsFor, defaultConfig, isContractPort,
} from '@grandes-colonies/engine';
import { GreedyBot, playGame } from '@grandes-colonies/sim';

const PARTIES = Number(process.env.PARTIES ?? 40);

/** Le même plateau, ses deux ports à contrat en moins. */
function sansContrats(board: BoardInit): BoardInit {
  const ports = new Map<VertexId, Port>();
  for (const [vertex, port] of board.ports ?? []) {
    if (!isContractPort(port.kind)) ports.set(vertex, port);
  }
  return { ...board, ports };
}

function mesure(label: string, players: number, retirer: boolean) {
  const cycles: number[] = [];
  const gagnants: number[] = [];
  const constructions: number[] = [];
  const viaPort: number[] = [];
  const viaBanque: number[] = [];
  let conclues = 0;

  for (let i = 0; i < PARTIES; i++) {
    const seed = `ports-${players}-${i}`;
    const rng = new SeededRandom(`${seed}:board`);
    const genere = archipelagoBoard(rng, archipelagoOptionsFor(players));
    const board = retirer ? sansContrats(genere) : genere;

    const out = playGame({
      playerCount: players, seed, board, config: defaultConfig(players),
      makeBot: () => new GreedyBot(), maxCycles: 600,
    });

    cycles.push(out.cycles);
    if (!out.exhausted) conclues++;
    gagnants.push(Math.max(...out.points));
    constructions.push(out.builds.reduce((a, b) => a + b, 0) / players);
    viaPort.push(out.portTrades);
    viaBanque.push(out.bankTrades);
  }

  const moy = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const med = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] ?? 0;

  console.log(
    `${label.padEnd(16)}`,
    `| conclues ${String(conclues).padStart(2)}/${PARTIES}`,
    `| cycles méd ${String(med(cycles)).padStart(3)}`,
    `| pts gagnant ${moy(gagnants).toFixed(1)}`,
    `| constr/j ${moy(constructions).toFixed(1)}`,
    `| via port ${moy(viaPort).toFixed(0).padStart(3)}`,
    `| via banque ${moy(viaBanque).toFixed(0).padStart(3)}`,
  );
}

for (const players of [12, 8]) {
  console.log(`— ${players} joueurs, archipel, ${PARTIES} parties —`);
  mesure('sans contrats', players, true);
  mesure('§11 minier+comm.', players, false);
  console.log('');
}
