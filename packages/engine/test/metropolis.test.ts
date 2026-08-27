/**
 * Métropoles et monuments.
 *
 * Le barème les chiffrait depuis le début sans que rien ne les attribue.
 * Ces tests couvrent leurs deux raisons d'être : la rareté de la métropole,
 * qui en fait un prix de course, et le monument, qui laisse un joueur sans
 * emplacement libre convertir ses ressources en points.
 */

import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import type { HexData } from '../src/board/board.js';
import type { VertexId } from '../src/board/graph.js';
import { defaultConfig } from '../src/game/config.js';
import type { Command } from '../src/game/commands.js';
import { dispatch, metropolisesBuilt, playerPoints } from '../src/game/engine.js';
import { type GameState, activePlayer, createGame, playerOf } from '../src/game/state.js';
import { settlementSpots } from '../src/placement.js';
import { COSTS, addCounts, amount, counts } from '../src/resources.js';

const ORIGIN: Axial = { q: 0, r: 0 };

function boardInit() {
  const positions = hexesWithin(ORIGIN, 2);
  const terrains = ['forest', 'pasture', 'field', 'hills', 'mountain'] as const;
  const tokens = [3, 4, 5, 6, 8, 9, 10, 11] as const;
  const hexes = new Map<string, HexData>();
  positions.forEach((p, i) => {
    hexes.set(hexKey(p), {
      terrain: terrains[i % terrains.length] ?? 'forest',
      token: tokens[i % tokens.length] ?? 5,
    });
  });
  return { positions, hexes };
}

let counter = 0;
const cmd = (type: string, playerId: string, extra: Record<string, unknown> = {}): Command =>
  ({ actionId: `m${counter++}`, playerId, type, ...extra }) as Command;

function playingGame(playerCount = 3): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const state = createGame({
    players, board: boardInit(), config: defaultConfig(playerCount), seed: 'metro',
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

/** Donne une cité à un joueur, sans passer par la construction. */
function giveCity(state: GameState, playerId: string): VertexId {
  const vertex = [...state.board.allBuildings().entries()]
    .find(([, b]) => b.owner === playerId)?.[0] as VertexId;
  state.board.setBuilding(vertex, { kind: 'city', owner: playerId });
  return vertex;
}

const fund = (state: GameState, playerId: string, cost = COSTS.metropolis): void => {
  const player = playerOf(state, playerId);
  if (!player) throw new Error('joueur absent');
  player.hand = addCounts(player.hand, cost);
};

describe('métropole', () => {
  it('améliore une cité et vaut un point de plus', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const vertex = giveCity(state, me);
    fund(state, me);

    const before = playerPoints(state, me)?.total ?? 0;
    const result = dispatch(state, cmd('BUILD_METROPOLIS', me, { vertex }));

    expect(result.ok).toBe(true);
    expect(state.board.buildingAt(vertex)?.kind).toBe('metropolis');
    // Trois points au lieu des deux de la cité : un net.
    expect(playerPoints(state, me)?.total).toBe(before + 1);
  });

  it('coûte de l or, la seule construction qui en réclame', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const vertex = giveCity(state, me);
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');

    // Tout sauf l'or.
    player.hand = counts({ ore: 3, grain: 2 });
    expect(dispatch(state, cmd('BUILD_METROPOLIS', me, { vertex })).ok).toBe(false);

    player.hand = counts({ ore: 3, grain: 2, gold: 2 });
    expect(dispatch(state, cmd('BUILD_METROPOLIS', me, { vertex })).ok).toBe(true);
    expect(amount(playerOf(state, me)?.hand ?? {}, 'gold')).toBe(0);
  });

  it('refuse une colonie : il faut une cité', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    fund(state, me);
    const vertex = [...state.board.allBuildings().entries()]
      .find(([, b]) => b.owner === me)?.[0] as VertexId;

    const result = dispatch(state, cmd('BUILD_METROPOLIS', me, { vertex }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe('not-a-city');
  });

  it('refuse la cité d un autre joueur', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const other = state.players.find((p) => p.id !== me)?.id as string;
    const vertex = giveCity(state, other);
    fund(state, me);

    const result = dispatch(state, cmd('BUILD_METROPOLIS', me, { vertex }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe('not-owner');
  });

  /**
   * Le point qui fait de la métropole un prix de course : elles sont trois
   * pour toute la partie, pas trois par joueur.
   */
  it('n en distribue que trois pour toute la partie', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    expect(state.config.metropolisesTotal).toBe(3);

    // Trois métropoles déjà bâties par d'autres.
    const free = [...state.board.graph.vertices].sort()
      .filter((v) => !state.board.buildingAt(v)).slice(0, 3);
    for (const vertex of free) state.board.setBuilding(vertex, { kind: 'metropolis', owner: 'p2' });
    expect(metropolisesBuilt(state)).toBe(3);

    const mine = giveCity(state, me);
    fund(state, me);
    const result = dispatch(state, cmd('BUILD_METROPOLIS', me, { vertex: mine }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('none-left');
    // Rien n'a été prélevé : le refus arrive avant le paiement.
    expect(amount(playerOf(state, me)?.hand ?? {}, 'gold')).toBe(2);
  });

  it('ne produit pas plus qu une cité', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const vertex = giveCity(state, me);
    fund(state, me);
    dispatch(state, cmd('BUILD_METROPOLIS', me, { vertex }));

    // Deux ressources, comme la cité : la récompense est le point, pas le flux.
    expect(state.board.buildingAt(vertex)?.kind).toBe('metropolis');
  });
});

describe('monument', () => {
  it('vaut deux points sans occuper de nouvel emplacement', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const vertex = giveCity(state, me);
    fund(state, me, COSTS.monument);

    const before = playerPoints(state, me)?.total ?? 0;
    const buildings = state.board.allBuildings().size;

    const result = dispatch(state, cmd('BUILD_MONUMENT', me, { vertex }));

    expect(result.ok).toBe(true);
    expect(playerPoints(state, me)?.total).toBe(before + 2);
    // Aucun sommet supplémentaire consommé : c'est tout son intérêt.
    expect(state.board.allBuildings().size).toBe(buildings);
  });

  it('exige une ressource de chaque, pour forcer le commerce', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const vertex = giveCity(state, me);
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');

    // Beaucoup de tout sauf du minerai.
    player.hand = counts({ wood: 5, brick: 5, wool: 5, grain: 5 });
    expect(dispatch(state, cmd('BUILD_MONUMENT', me, { vertex })).ok).toBe(false);

    player.hand = counts({ wood: 1, brick: 1, wool: 1, grain: 1, ore: 1 });
    expect(dispatch(state, cmd('BUILD_MONUMENT', me, { vertex })).ok).toBe(true);
  });

  it('n en autorise qu un par joueur', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const vertex = giveCity(state, me);
    fund(state, me, COSTS.monument);
    fund(state, me, COSTS.monument);

    expect(dispatch(state, cmd('BUILD_MONUMENT', me, { vertex })).ok).toBe(true);
    const second = dispatch(state, cmd('BUILD_MONUMENT', me, { vertex }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('none-left');
  });

  it('refuse une colonie', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    fund(state, me, COSTS.monument);
    const vertex = [...state.board.allBuildings().entries()]
      .find(([, b]) => b.owner === me)?.[0] as VertexId;

    const result = dispatch(state, cmd('BUILD_MONUMENT', me, { vertex }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe('not-a-city');
  });

  it('s élève aussi sur une métropole', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const vertex = giveCity(state, me);
    state.board.setBuilding(vertex, { kind: 'metropolis', owner: me });
    fund(state, me, COSTS.monument);

    expect(dispatch(state, cmd('BUILD_MONUMENT', me, { vertex })).ok).toBe(true);
  });
});

describe('victoire', () => {
  /**
   * Le calcul des points de victoire était dupliqué : un joueur aurait pu
   * atteindre le seuil sans que sa métropole ni son monument comptent.
   */
  it('compte métropole et monument dans la victoire', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');

    // On amène le joueur juste sous le seuil avec des cités.
    const free = [...state.board.graph.vertices].sort()
      .filter((v) => !state.board.buildingAt(v)).slice(0, 6);
    for (const vertex of free) state.board.setBuilding(vertex, { kind: 'city', owner: me });

    const withoutExtras = playerPoints(state, me)?.total ?? 0;
    player.hasMonument = true;
    state.board.setBuilding(free[0] as VertexId, { kind: 'metropolis', owner: me });

    // +2 pour le monument, +1 net pour la métropole.
    expect(playerPoints(state, me)?.total).toBe(withoutExtras + 3);
  });
});
