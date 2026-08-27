/**
 * Les cartes développement jouables.
 *
 * Quatre des cinq cartes du paquet étaient distribuées sans qu'aucune
 * commande ne permette de les jouer : un joueur pouvait acheter un Monopole
 * et ne jamais s'en servir. Ces tests couvrent leurs effets et, tout autant,
 * les règles qui les encadrent — une carte par tour, pas le tour de l'achat.
 */

import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import type { HexData } from '../src/board/board.js';
import type { VertexId } from '../src/board/graph.js';
import { defaultConfig } from '../src/game/config.js';
import type { Command } from '../src/game/commands.js';
import { dispatch } from '../src/game/engine.js';
import { getCapabilities } from '../src/game/capabilities.js';
import { type GameState, activePlayer, createGame, playerOf } from '../src/game/state.js';
import { settlementSpots } from '../src/placement.js';
import { locationOf } from '../src/game/buildIntent.js';
import { type DevCardKind, EMPTY_HOLDING, beginTurn, buyCard } from '../src/devCards.js';
import { amount, counts, total } from '../src/resources.js';

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
  ({ actionId: `d${counter++}`, playerId, type, ...extra }) as Command;

/** Une partie arrivée au tour actif du premier joueur, dés déjà lancés. */
function playingGame(playerCount = 3): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const state = createGame({
    players, board: boardInit(), config: defaultConfig(playerCount), seed: 'cartes',
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
  // On neutralise ce qui n'a rien à voir avec les cartes.
  state.pendingRobber = false;
  for (const p of state.players) p.mustDiscard = 0;
  state.phase = 'activeTurn';
  return state;
}

/** Donne une carte au joueur, déjà jouable — comme si elle datait d'un tour. */
function give(state: GameState, playerId: string, card: DevCardKind): void {
  const player = playerOf(state, playerId);
  if (!player) throw new Error('joueur absent');
  player.devCards = beginTurn(buyCard(player.devCards, card));
}

/**
 * Ouvre un emplacement de colonie légal et le renvoie.
 *
 * Au sortir de la mise en place, il n'en existe aucun : chaque route initiale
 * mène à un sommet voisin d'une colonie, que la règle de distance interdit.
 * Il faut prolonger le réseau d'un cran pour dégager un emplacement.
 */
function openSettlementSpot(state: GameState, playerId: string): VertexId {
  for (let step = 0; step < 6; step++) {
    const spot = settlementSpots(state.board, playerId)[0];
    if (spot !== undefined) return spot;
    state.board.setRoad(freeEdgeFor(state, playerId), playerId);
  }
  throw new Error('aucun emplacement de colonie atteignable');
}

/** Une arête libre reliée au réseau du joueur. */
function freeEdgeFor(state: GameState, playerId: string): string {
  for (const [edge, route] of state.board.allRoutes()) {
    if (route.owner !== playerId) continue;
    for (const vertex of state.board.graph.verticesOfEdgeOnBoard(edge)) {
      const candidate = state.board.graph
        .edgesOfVertexOnBoard(vertex).find((e) => state.board.roadAt(e) === undefined);
      if (candidate) return candidate;
    }
  }
  throw new Error('aucune arête libre');
}

describe('construction de routes', () => {
  it('pose deux routes gratuitement', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'roadBuilding');
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');

    player.hand = counts({});
    const before = player.roadsLeft;
    const first = freeEdgeFor(state, me);
    state.board.setRoad(first, me);
    const second = freeEdgeFor(state, me);
    state.board.clearRoad(first);

    const result = dispatch(state, cmd('PLAY_ROAD_BUILDING', me, { edges: [first, second] }));

    expect(result.ok).toBe(true);
    expect(state.board.roadAt(first)).toBe(me);
    expect(state.board.roadAt(second)).toBe(me);
    // Gratuites : la main était vide et le reste.
    expect(total(player.hand)).toBe(0);
    expect(player.roadsLeft).toBe(before - 2);
  });

  it('accepte une seule route pour un joueur enfermé', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'roadBuilding');
    const edge = freeEdgeFor(state, me);

    expect(dispatch(state, cmd('PLAY_ROAD_BUILDING', me, { edges: [edge] })).ok).toBe(true);
    expect(state.board.roadAt(edge)).toBe(me);
  });

  /**
   * Le piège de cette carte : la seconde route s'appuie souvent sur la
   * première, il faut donc poser pour valider. Un refus ne doit pas laisser
   * la première sur le plateau.
   */
  it('ne laisse aucune route posée si la seconde est illégale', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const other = state.players.find((p) => p.id !== me)?.id as string;
    give(state, me, 'roadBuilding');

    const legal = freeEdgeFor(state, me);
    const taken = freeEdgeFor(state, other);
    state.board.setRoad(taken, other);

    const result = dispatch(state, cmd('PLAY_ROAD_BUILDING', me, { edges: [legal, taken] }));

    expect(result.ok).toBe(false);
    expect(state.board.roadAt(legal)).toBeUndefined();
    expect(state.board.roadAt(taken)).toBe(other);
    // La carte n'a pas été consommée.
    expect(playerOf(state, me)?.devCards.playable).toContain('roadBuilding');
  });

  it('refuse deux fois la même arête', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'roadBuilding');
    const edge = freeEdgeFor(state, me);

    const result = dispatch(state, cmd('PLAY_ROAD_BUILDING', me, { edges: [edge, edge] }));
    expect(result.ok).toBe(false);
  });

  it('refuse si le joueur n a plus assez de routes', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'roadBuilding');
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');
    player.roadsLeft = 1;

    const first = freeEdgeFor(state, me);
    state.board.setRoad(first, me);
    const second = freeEdgeFor(state, me);
    state.board.clearRoad(first);

    const result = dispatch(state, cmd('PLAY_ROAD_BUILDING', me, { edges: [first, second] }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('no-pieces-left');
  });
});

describe('invention', () => {
  it('donne deux ressources au choix, prises à la banque', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'invention');
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');
    player.hand = counts({});
    const bankOre = amount(state.bank, 'ore');

    const result = dispatch(state, cmd('PLAY_INVENTION', me, { resources: { ore: 2 } }));

    expect(result.ok).toBe(true);
    expect(amount(player.hand, 'ore')).toBe(2);
    expect(amount(state.bank, 'ore')).toBe(bankOre - 2);
  });

  it('accepte deux ressources différentes', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'invention');
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');
    player.hand = counts({});

    expect(dispatch(state, cmd('PLAY_INVENTION', me, { resources: { wood: 1, brick: 1 } })).ok).toBe(true);
    expect(amount(player.hand, 'wood')).toBe(1);
    expect(amount(player.hand, 'brick')).toBe(1);
  });

  it('refuse un compte autre que deux', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'invention');

    expect(dispatch(state, cmd('PLAY_INVENTION', me, { resources: { ore: 3 } })).ok).toBe(false);
    expect(dispatch(state, cmd('PLAY_INVENTION', me, { resources: { ore: 1 } })).ok).toBe(false);
  });

  it('refuse ce que la banque n a plus', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'invention');
    state.bank = counts({ ore: 1 });

    const result = dispatch(state, cmd('PLAY_INVENTION', me, { resources: { ore: 2 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-trade');
  });
});

describe('monopole', () => {
  it('rafle la ressource nommée chez tous les autres', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'monopoly');
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');

    player.hand = counts({ wool: 1 });
    for (const other of state.players) {
      if (other.id === me) continue;
      other.hand = counts({ wool: 3, ore: 2 });
    }

    const result = dispatch(state, cmd('PLAY_MONOPOLY', me, { resource: 'wool' }));

    expect(result.ok).toBe(true);
    expect(amount(player.hand, 'wool')).toBe(1 + 3 * (state.players.length - 1));
    for (const other of state.players) {
      if (other.id === me) continue;
      expect(amount(other.hand, 'wool')).toBe(0);
      // Le reste de leur main est intact.
      expect(amount(other.hand, 'ore')).toBe(2);
    }
  });

  it('se joue même si personne n a la ressource', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'monopoly');
    for (const p of state.players) p.hand = counts({ ore: 1 });

    const result = dispatch(state, cmd('PLAY_MONOPOLY', me, { resource: 'fish' }));
    expect(result.ok).toBe(true);
    expect(playerOf(state, me)?.devCards.played).toContain('monopoly');
  });
});

describe('bâtisseur', () => {
  it('offre une colonie sans en payer le coût', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'freeBuild');
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');
    player.hand = counts({});

    const vertex = openSettlementSpot(state, me);
    const result = dispatch(state, cmd('PLAY_FREE_BUILD', me, {
      target: { kind: 'settlement', vertex },
    }));

    expect(result.ok).toBe(true);
    expect(state.board.buildingAt(vertex)?.owner).toBe(me);
    expect(total(player.hand)).toBe(0);
  });

  it('respecte les règles de placement', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const other = state.players.find((p) => p.id !== me)?.id as string;
    give(state, me, 'freeBuild');

    // Un sommet déjà occupé par un autre joueur reste interdit.
    const occupied = [...state.board.allBuildings()]
      .find(([, b]) => b.owner === other)?.[0] as VertexId;

    const result = dispatch(state, cmd('PLAY_FREE_BUILD', me, {
      target: { kind: 'settlement', vertex: occupied },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('invalid-placement');
  });

  it('refuse un emplacement gelé', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'freeBuild');
    const vertex = openSettlementSpot(state, me);
    state.frozenLocations.add(locationOf({ kind: 'settlement', vertex }));

    const result = dispatch(state, cmd('PLAY_FREE_BUILD', me, {
      target: { kind: 'settlement', vertex },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('location-frozen');
  });
});

describe('règles communes aux cartes', () => {
  it('interdit de jouer une carte achetée le tour même', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    const player = playerOf(state, me);
    if (!player) throw new Error('joueur absent');
    player.devCards = buyCard(EMPTY_HOLDING, 'monopoly');

    const result = dispatch(state, cmd('PLAY_MONOPOLY', me, { resource: 'wool' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toBe('bought-this-turn');
  });

  it('n autorise qu une carte par tour', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    give(state, me, 'monopoly');
    give(state, me, 'invention');

    expect(dispatch(state, cmd('PLAY_MONOPOLY', me, { resource: 'wool' })).ok).toBe(true);
    const second = dispatch(state, cmd('PLAY_INVENTION', me, { resources: { ore: 2 } }));
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.detail).toBe('already-played-this-turn');
  });

  it('réserve les cartes au joueur actif', () => {
    const state = playingGame();
    const other = state.players.find((p) => p.id !== activePlayer(state).id)?.id as string;
    give(state, other, 'monopoly');

    const result = dispatch(state, cmd('PLAY_MONOPOLY', other, { resource: 'wool' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('not-your-turn');
  });

  it('annonce la capacité quand une carte est jouable', () => {
    const state = playingGame();
    const me = activePlayer(state).id;
    expect(getCapabilities(state, me).has('CAN_PLAY_DEV_CARD')).toBe(false);

    give(state, me, 'invention');
    expect(getCapabilities(state, me).has('CAN_PLAY_DEV_CARD')).toBe(true);
  });
});
