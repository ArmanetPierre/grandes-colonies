/**
 * Plateau en archipel et exploration.
 *
 * Le §4 du game design décrit une île centrale disputée et deux à trois îles
 * majeures reliées par la mer. Les plateaux étaient des disques pleins : les
 * voies maritimes n'avaient nulle part où mener.
 *
 * Le test qui compte est celui de la navigabilité : une île qu'on ne peut
 * pas atteindre à la voile est une île morte, et le point d'exploration qui
 * s'y trouve serait inatteignable.
 */

import { describe, expect, it } from 'vitest';

import { Board } from '../src/board/board.js';
import { hexKey } from '../src/board/axial.js';
import { hexesOfEdge, verticesOfEdge } from '../src/board/graph.js';
import { landMasses, mainIsland } from '../src/board/islands.js';
import { archipelagoBoard, archipelagoOptionsFor } from '../src/board/presets.js';
import { canPlaceSettlement } from '../src/placement.js';
import { SeededRandom } from '../src/rng.js';
import { COSTS, addCounts } from '../src/resources.js';
import { defaultConfig } from '../src/game/config.js';
import type { Command, DomainEvent } from '../src/game/commands.js';
import { dispatch, playerPoints } from '../src/game/engine.js';
import { type GameState, createGame, playerOf } from '../src/game/state.js';

/** Une partie sur archipel, mise en place jouée. */
function archipelagoGame(playerCount: number): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const rng = new SeededRandom('partie');
  const state = createGame({
    players,
    board: archipelagoBoard(rng, archipelagoOptionsFor(playerCount)),
    config: defaultConfig(playerCount),
    seed: 'partie',
  });

  let guard = 0;
  while (state.phase === 'setup' && guard++ < 400) {
    const player = state.setupQueue[0] as string;
    let spot = state.setupPendingVertex;
    if (spot === undefined) {
      spot = [...state.board.graph.vertices].sort()
        .find((v) => canPlaceSettlement(state.board, v, player, { setupPhase: true }).ok) as string;
      dispatch(state, cmd('PLACE_SETUP_SETTLEMENT', player, { vertex: spot }));
      spot = state.setupPendingVertex;
    }
    const edge = state.board.graph
      .edgesOfVertexOnBoard(spot as string).find((e) => state.board.roadAt(e) === undefined) as string;
    dispatch(state, cmd('PLACE_SETUP_ROAD', player, { edge }));
  }
  return state;
}

let counter = 0;
const cmd = (type: string, playerId: string, extra: Record<string, unknown> = {}): Command =>
  ({ actionId: `i${counter++}`, playerId, type, ...extra }) as Command;

/**
 * Pose une colonie par la vraie commande, en amenant d'abord une route à
 * portée. Rejouer l'attribution à la main dans le test l'aurait rendue
 * toujours verte, moteur cassé ou non.
 */
function settle(state: GameState, playerId: string, vertex: string): DomainEvent[] {
  const player = playerOf(state, playerId);
  if (!player) throw new Error('joueur absent');
  player.hand = addCounts(player.hand, COSTS.settlement);

  // On amène la partie au moment où ce joueur peut bâtir.
  state.activeIndex = state.players.findIndex((p) => p.id === playerId);
  state.phase = 'activeTurn';
  state.pendingRobber = false;
  for (const p of state.players) p.mustDiscard = 0;

  const edge = state.board.graph
    .edgesOfVertexOnBoard(vertex).find((e) => state.board.roadAt(e) === undefined);
  if (edge === undefined) throw new Error('aucune arête libre');
  state.board.setRoad(edge, playerId, 'maritime');

  const result = dispatch(state, cmd('BUILD_SETTLEMENT', playerId, { vertex }));
  if (!result.ok) throw new Error(`colonie refusée : ${result.reason} ${result.detail ?? ''}`);
  return [...result.events];
}

/** Deux sommets partagent-ils une arête ? */
function adjacent(board: Board, a: string, b: string): boolean {
  const shared = a.split('|').filter((h) => b.split('|').includes(h));
  return shared.length >= 2;
}

const boardFor = (playerCount: number, seed = 'archi'): Board =>
  new Board(archipelagoBoard(new SeededRandom(`${seed}-${playerCount}`), archipelagoOptionsFor(playerCount)));

/** Les îles atteignables à la voile depuis l'île centrale. */
function reachableIslands(board: Board): number {
  const islands = landMasses(board);
  const main = islands[0];
  if (!main) return 0;
  const mainHexes = new Set(main.hexes);

  const isSea = (edge: string): boolean =>
    hexesOfEdge(edge).some((h) => !board.graph.has(h) || board.terrainAt(h) === 'sea');

  const start = [...board.graph.edges]
    .filter((e) => isSea(e) && hexesOfEdge(e).some((h) => mainHexes.has(hexKey(h))));

  const seen = new Set(start);
  const queue = [...start];
  while (queue.length > 0) {
    const edge = queue.pop() as string;
    for (const vertex of verticesOfEdge(edge)) {
      for (const next of board.graph.edgesOfVertexOnBoard(vertex)) {
        if (seen.has(next) || !isSea(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
  }

  return islands.slice(1).filter((island) => {
    const hexes = new Set(island.hexes);
    return [...seen].some((e) => hexesOfEdge(e).some((h) => hexes.has(hexKey(h))));
  }).length;
}

describe('génération de l archipel', () => {
  it('produit une île centrale et des îles secondaires', () => {
    for (const count of [8, 10, 12]) {
      const islands = landMasses(boardFor(count));
      const expected = archipelagoOptionsFor(count).islands + 1;
      expect(islands).toHaveLength(expected);

      // La centrale est nettement plus grande : c'est la région disputée.
      const [main, ...rest] = islands;
      for (const island of rest) {
        expect(main?.hexes.length ?? 0).toBeGreaterThan(island.hexes.length);
      }
    }
  });

  it('respecte le volume de terres du §4', () => {
    for (const count of [8, 10, 12]) {
      const total = landMasses(boardFor(count)).reduce((sum, i) => sum + i.hexes.length, 0);
      expect(total).toBeGreaterThanOrEqual(40);
      expect(total).toBeLessThanOrEqual(56);
    }
  });

  /** Sans séparation, la voie maritime resterait un raccourci facultatif. */
  it('sépare les îles par de la mer', () => {
    const board = boardFor(12);
    const islands = landMasses(board);

    for (const island of islands) {
      const own = new Set(island.hexes);
      const others = new Set(islands.filter((i) => i.id !== island.id).flatMap((i) => i.hexes));
      // Aucun hexagone d'une île n'est voisin d'un hexagone d'une autre.
      for (const edge of board.graph.edges) {
        const [a, b] = hexesOfEdge(edge).map(hexKey);
        if (a === undefined || b === undefined) continue;
        expect(own.has(a) && others.has(b)).toBe(false);
        expect(own.has(b) && others.has(a)).toBe(false);
      }
    }
  });

  it('laisse toutes les îles atteignables à la voile', () => {
    for (const count of [8, 10, 12]) {
      for (const seed of ['a', 'b', 'c']) {
        const board = boardFor(count, seed);
        const expected = archipelagoOptionsFor(count).islands;
        expect(reachableIslands(board)).toBe(expected);
      }
    }
  });

  it('reste déterministe à graine égale', () => {
    const a = landMasses(boardFor(12, 'x')).map((i) => i.id);
    const b = landMasses(boardFor(12, 'x')).map((i) => i.id);
    expect(a).toEqual(b);
  });
});

describe('mise en place', () => {
  /**
   * Commencer sur une île secondaire donnerait un point d'exploration
   * gratuit et priverait la partie de la course qui en fait l'intérêt.
   */
  it('reste cantonnée à l île centrale', () => {
    const board = boardFor(12);
    const main = mainIsland(board);
    if (!main) throw new Error('aucune île centrale');
    const mainHexes = new Set(main.hexes);

    let offMain = 0;
    for (const vertex of board.graph.vertices) {
      const check = canPlaceSettlement(board, vertex, 'p1', { setupPhase: true });
      if (!check.ok) continue;
      // Tout emplacement proposé touche l'île centrale.
      expect(vertex.split('|').some((h) => mainHexes.has(h))).toBe(true);
      offMain++;
    }
    expect(offMain).toBeGreaterThan(0);
  });

  it('autorise en revanche une colonie hors mise en place', () => {
    const board = boardFor(12);
    const secondary = landMasses(board)[1];
    if (!secondary) throw new Error('aucune île secondaire');

    const vertex = [...board.graph.vertices]
      .find((v) => v.split('|').every((h) => secondary.hexes.includes(h)));
    if (vertex === undefined) throw new Error('aucun sommet intérieur à l île');

    // Hors mise en place, seule la connexion au réseau manque.
    const check = canPlaceSettlement(board, vertex, 'p1');
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('not-connected');
  });
});

describe('exploration majeure', () => {
  it('donne un point au premier arrivé, et à lui seul', () => {
    const state = archipelagoGame(8);
    const secondary = landMasses(state.board)[1];
    if (!secondary) throw new Error('aucune île secondaire');

    const vertices = [...state.board.graph.vertices]
      .filter((v) => v.split('|').some((h) => secondary.hexes.includes(h)))
      .sort();

    const first = vertices[0] as string;
    const second = vertices.find((v) => v !== first
      && !adjacent(state.board, v, first)) as string;

    // On pose directement : le test porte sur la récompense, pas l'accès.
    let events = settle(state, 'p1', first);
    expect(events.some((e) => e.type === 'IslandReached')).toBe(true);
    expect(playerOf(state, 'p1')?.explorations).toBe(1);

    // Un second joueur sur la même île ne marque rien.
    events = settle(state, 'p2', second);
    expect(events.some((e) => e.type === 'IslandReached')).toBe(false);
    expect(playerOf(state, 'p2')?.explorations).toBe(0);
  });

  it('compte le point au barème de victoire', () => {
    const state = archipelagoGame(8);
    const before = playerPoints(state, 'p1')?.total ?? 0;

    const secondary = landMasses(state.board)[1];
    if (!secondary) throw new Error('aucune île secondaire');
    const vertex = [...state.board.graph.vertices]
      .find((v) => v.split('|').some((h) => secondary.hexes.includes(h))) as string;

    settle(state, 'p1', vertex);

    // Un point d'exploration, plus le point de la colonie elle-même.
    expect(playerPoints(state, 'p1')?.total).toBe(before + 2);
    expect(playerPoints(state, 'p1')?.majorExplorations).toBe(1);
  });

  it('ne donne rien sur l île centrale', () => {
    const state = archipelagoGame(8);
    const main = mainIsland(state.board);
    if (!main) throw new Error('aucune île centrale');

    // Un sommet intérieur à l'île centrale, libre et assez loin des colonies
    // de la mise en place pour que la règle de distance ne s'y oppose pas.
    const mainHexes = new Set(main.hexes);
    const vertex = [...state.board.graph.vertices].sort().find((v) =>
      v.split('|').every((h) => mainHexes.has(h))
      && state.board.buildingAt(v) === undefined
      && state.board.graph.adjacentVerticesOnBoard(v)
        .every((n) => state.board.buildingAt(n) === undefined)) as string;
    expect(vertex).toBeDefined();

    const events = settle(state, 'p1', vertex);
    expect(events.some((e) => e.type === 'IslandReached')).toBe(false);
    expect(playerOf(state, 'p1')?.explorations).toBe(0);
  });
});
