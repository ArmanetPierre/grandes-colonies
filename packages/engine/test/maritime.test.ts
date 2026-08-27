/**
 * Routes maritimes.
 *
 * Le type existait depuis le début, le calcul du plus long réseau les
 * comptait, mais aucune commande ne permettait d'en poser une : du code mort.
 * Ces tests couvrent la pose et, tout autant, la frontière entre les deux
 * sortes de route — c'est elle qui donne son sens au tracé côtier.
 */

import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import type { HexData } from '../src/board/board.js';
import type { VertexId } from '../src/board/graph.js';
import { defaultConfig } from '../src/game/config.js';
import type { Command } from '../src/game/commands.js';
import { dispatch } from '../src/game/engine.js';
import { type GameState, activePlayer, createGame, playerOf } from '../src/game/state.js';
import { canPlaceMaritimeRoute, canPlaceRoad, maritimeSpots, settlementSpots } from '../src/placement.js';
import { COSTS, addCounts, counts } from '../src/resources.js';

const ORIGIN: Axial = { q: 0, r: 0 };

/** Un îlot de terre entouré de mer : les deux régimes se touchent. */
function boardInit() {
  const positions = hexesWithin(ORIGIN, 2);
  const land = new Set(hexesWithin(ORIGIN, 1).map(hexKey));
  const terrains = ['forest', 'pasture', 'field', 'hills', 'mountain'] as const;
  const hexes = new Map<string, HexData>();
  positions.forEach((p, i) => {
    const key = hexKey(p);
    hexes.set(key, land.has(key)
      ? { terrain: terrains[i % terrains.length] ?? 'forest', token: ([3, 4, 5, 6, 8, 9] as const)[i % 6] ?? 5 }
      : { terrain: 'sea' });
  });
  return { positions, hexes };
}

let counter = 0;
const cmd = (type: string, playerId: string, extra: Record<string, unknown> = {}): Command =>
  ({ actionId: `w${counter++}`, playerId, type, ...extra }) as Command;

function playingGame(playerCount = 3): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const state = createGame({
    players, board: boardInit(), config: defaultConfig(playerCount), seed: 'mer',
  });
  while (state.phase === 'setup') {
    const player = state.setupQueue[0] as string;
    let spot = state.setupPendingVertex;
    if (spot === undefined) {
      spot = settlementSpots(state.board, player, { setupPhase: true })[0] as VertexId;
      dispatch(state, cmd('PLACE_SETUP_SETTLEMENT', player, { vertex: spot }));
    }
    const edge = state.board.graph
      .edgesOfVertexOnBoard(spot).find((e) => state.board.roadAt(e) === undefined) as string;
    dispatch(state, cmd('PLACE_SETUP_ROAD', player, { edge }));
  }
  dispatch(state, cmd('ROLL_DICE', activePlayer(state).id));
  state.pendingRobber = false;
  for (const p of state.players) p.mustDiscard = 0;
  state.phase = 'activeTurn';
  return state;
}

const fund = (state: GameState, playerId: string, cost = COSTS.maritimeRoute): void => {
  const player = playerOf(state, playerId);
  if (!player) throw new Error('joueur absent');
  player.hand = addCounts(player.hand, cost);
};

describe('frontière entre les deux régimes', () => {
  /**
   * Le défaut trouvé en implémentant : rien ne vérifiait qu'une route
   * terrestre longeait de la terre. On pouvait tracer une route sur la mer
   * ouverte, du moment qu'elle touchait son propre réseau.
   */
  it('refuse une route terrestre en pleine mer', () => {
    const state = playingGame();
    const me = activePlayer(state).id;

    const openSea = [...state.board.graph.edges].sort().find((e) => {
      const hexes = e.split('|');
      return hexes.every((h) => state.board.terrainAt(h) === 'sea');
    });
    if (openSea === undefined) throw new Error('aucune arête de pleine mer');

    const check = canPlaceRoad(state.board, openSea, me);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('unbuildable-land');
  });

  it('refuse une route maritime en pleine terre', () => {
    const state = playingGame();
    const me = activePlayer(state).id;

    const inland = [...state.board.graph.edges].sort().find((e) => {
      if (state.board.roadAt(e) !== undefined) return false;
      const hexes = e.split('|');
      // `terrainAt` renvoie undefined hors plateau : deux terrains définis
      // et non maritimes font une arête entièrement intérieure.
      return hexes.every((h) => {
        const t = state.board.terrainAt(h);
        return t !== undefined && t !== 'sea';
      });
    });
    if (inland === undefined) throw new Error('aucune arête intérieure');

    const check = canPlaceMaritimeRoute(state.board, inland, me);
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.reason).toBe('needs-water');
  });

  it('accepte les deux sur une arête côtière', () => {
    const state = playingGame();
    const me = activePlayer(state).id;

    const coastal = [...state.board.graph.edges].sort().find((e) => {
      const hexes = e.split('|');
      const terrains = hexes.map((h) => state.board.terrainAt(h));
      return terrains.includes('sea') && terrains.some((t) => t !== undefined && t !== 'sea');
    });
    if (coastal === undefined) throw new Error('aucune arête côtière');

    // Seule la connexion au réseau les départage, pas le terrain.
    const road = canPlaceRoad(state.board, coastal, me);
    const sea = canPlaceMaritimeRoute(state.board, coastal, me);
    const reasonOf = (p: typeof road) => (p.ok ? 'ok' : p.reason);
    expect(reasonOf(road)).not.toBe('unbuildable-land');
    expect(reasonOf(sea)).not.toBe('needs-water');
  });
});

describe('pose d une route maritime', () => {
  it('la pose, la facture et la marque comme maritime', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');

    player.hand = counts({});
    fund(state, me);
    const before = player.roadsLeft;

    const edge = maritimeSpots(state.board, me)[0];
    if (edge === undefined) throw new Error('aucune voie maritime');

    const result = dispatch(state, cmd('BUILD_MARITIME_ROUTE', me, { edge }));

    expect(result.ok).toBe(true);
    expect(state.board.routeAt(edge)?.kind).toBe('maritime');
    expect(state.board.roadAt(edge)).toBe(me);
    // Bois et laine, pas bois et brique.
    expect(player.hand).toEqual({});
    // Même réserve de pièces : c'est un tracé, pas une seconde armée.
    expect(player.roadsLeft).toBe(before - 1);
  });

  it('refuse sans les ressources', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');
    player.hand = counts({ brick: 5 });

    const edge = maritimeSpots(state.board, me)[0];
    if (edge === undefined) throw new Error('aucune voie maritime');
    const result = dispatch(state, cmd('BUILD_MARITIME_ROUTE', me, { edge }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-enough-resources');
  });

  it('prolonge le réseau : une voie maritime en porte une autre', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    fund(state, me);
    fund(state, me);

    const first = maritimeSpots(state.board, me)[0];
    if (first === undefined) throw new Error('aucune voie maritime');
    expect(dispatch(state, cmd('BUILD_MARITIME_ROUTE', me, { edge: first })).ok).toBe(true);

    // De nouvelles arêtes s'ouvrent, appuyées sur la première.
    const next = maritimeSpots(state.board, me).filter((e) => e !== first);
    expect(next.length).toBeGreaterThan(0);
    expect(dispatch(state, cmd('BUILD_MARITIME_ROUTE', me, { edge: next[0] as string })).ok).toBe(true);
  });

  it('refuse une voie coupée du réseau', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    fund(state, me);

    const reachable = new Set(maritimeSpots(state.board, me));
    const remote = [...state.board.graph.edges].sort()
      .find((e) => !reachable.has(e) && state.board.roadAt(e) === undefined);
    if (remote === undefined) throw new Error('aucune arête éloignée');

    const result = dispatch(state, cmd('BUILD_MARITIME_ROUTE', me, { edge: remote }));
    expect(result.ok).toBe(false);
  });
});
