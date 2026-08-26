import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import type { HexData } from '../src/board/board.js';
import type { EdgeId, VertexId } from '../src/board/graph.js';
import { type BuildIntent, locationOf, resolveIntents } from '../src/game/buildIntent.js';
import type { Command } from '../src/game/commands.js';
import { defaultConfig } from '../src/game/config.js';
import { dispatch } from '../src/game/engine.js';
import { type GameState, createGame, pairedPlayer, playerOf } from '../src/game/state.js';
import { settlementSpots } from '../src/placement.js';
import { COSTS, addCounts, amount, counts, total } from '../src/resources.js';

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
const cmd = (type: Command['type'], playerId: string, extra: Record<string, unknown> = {}): Command =>
  ({ actionId: `c${counter++}`, playerId, type, ...extra } as Command);

function newGame(playerCount = 6, seed: string | number = 'cycle'): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const state = createGame({ players, board: boardInit(), config: defaultConfig(playerCount), seed });

  while (state.phase === 'setup') {
    const player = state.setupQueue[0] as string;
    let spot = state.setupPendingVertex;
    if (spot === undefined) {
      spot = settlementSpots(state.board, player, { setupPhase: true })[0] as VertexId;
      dispatch(state, cmd('PLACE_SETUP_SETTLEMENT', player, { vertex: spot }));
    }
    const edge = state.board.graph
      .edgesOfVertexOnBoard(spot)
      .find((e) => state.board.roadAt(e) === undefined) as EdgeId;
    dispatch(state, cmd('PLACE_SETUP_ROAD', player, { edge }));
  }

  dispatch(state, cmd('ROLL_DICE', 'p1'));
  // Le sept perturberait les scénarios : on neutralise ses effets.
  state.pendingRobber = false;
  for (const p of state.players) p.mustDiscard = 0;
  return state;
}

/** Une arête libre partant d'une construction du joueur. */
function freeEdgeFor(state: GameState, player: string): EdgeId {
  const vertex = [...state.board.allBuildings().entries()]
    .find(([, b]) => b.owner === player)?.[0] as VertexId;
  return state.board.graph
    .edgesOfVertexOnBoard(vertex)
    .find((e) => state.board.roadAt(e) === undefined) as EdgeId;
}

function fund(state: GameState, player: string, resources = COSTS.road): void {
  const p = playerOf(state, player);
  if (p) p.hand = addCounts(p.hand, resources);
}

// ── départage pur ──────────────────────────────────────────────────────────

describe('départage des annonces', () => {
  const intent = (player: string, order: number, vertex = 'v1'): BuildIntent => ({
    id: `${player}:${order}`,
    player,
    target: { kind: 'settlement', vertex },
    reserved: counts({}),
    cycle: 1,
    order,
  });

  it('donne la priorité au joueur actif', () => {
    const result = resolveIntents([intent('p2', 0), intent('p1', 1)], 'p1');
    expect(result.built.map((i) => i.player)).toEqual(['p1']);
    expect(result.refunded.map((i) => i.player)).toEqual(['p2']);
  });

  it('départage deux non-actifs par ancienneté', () => {
    const result = resolveIntents([intent('p3', 5), intent('p2', 2)], 'p1');
    expect(result.built.map((i) => i.player)).toEqual(['p2']);
  });

  it('désigne toujours un vainqueur, donc ne gèle jamais', () => {
    const result = resolveIntents([intent('p2', 0), intent('p3', 1), intent('p4', 2)], 'p1');
    expect(result.built).toHaveLength(1);
    expect(result.refunded).toHaveLength(2);
    expect(result.frozen).toHaveLength(0);
  });

  it('laisse passer des annonces sur des emplacements distincts', () => {
    const result = resolveIntents([intent('p2', 0, 'vA'), intent('p3', 1, 'vB')], 'p1');
    expect(result.built).toHaveLength(2);
    expect(result.refunded).toHaveLength(0);
  });

  it('construit dans l ordre d arrivée', () => {
    const result = resolveIntents([intent('p3', 9, 'vB'), intent('p2', 4, 'vA')], 'p1');
    expect(result.built.map((i) => i.order)).toEqual([4, 9]);
  });

  it('distingue une arête d un sommet portant la même clé', () => {
    expect(locationOf({ kind: 'road', edge: 'x' })).not.toBe(locationOf({ kind: 'settlement', vertex: 'x' }));
  });
});

// ── joueur associé ─────────────────────────────────────────────────────────

describe('joueur associé', () => {
  it('peut construire pendant le tour de l actif', () => {
    const state = newGame(6);
    const paired = pairedPlayer(state);
    expect(paired?.id).toBe('p4');
    if (!paired) return;

    fund(state, paired.id);
    const edge = freeEdgeFor(state, paired.id);
    expect(dispatch(state, cmd('BUILD_ROAD', paired.id, { edge })).ok).toBe(true);
    expect(state.board.roadAt(edge)).toBe(paired.id);
  });

  it('peut commercer avec la banque', () => {
    const state = newGame(6);
    const paired = pairedPlayer(state);
    if (!paired) return;
    paired.hand = counts({ wood: 4 });

    expect(dispatch(state, cmd('TRADE_WITH_BANK', paired.id, {
      give: counts({ wood: 4 }), receive: counts({ ore: 1 }),
    })).ok).toBe(true);
    expect(amount(paired.hand, 'ore')).toBe(1);
  });

  it('reste bloqué pour les autres joueurs', () => {
    const state = newGame(6);
    fund(state, 'p2');
    const edge = freeEdgeFor(state, 'p2');
    expect(dispatch(state, cmd('BUILD_ROAD', 'p2', { edge })))
      .toEqual({ ok: false, reason: 'not-your-turn' });
  });

  // L'associé n'a aucun moyen de déplacer le voleur : le bloquer dessus
  // reviendrait à le priver de son tour pour une raison qui ne le concerne pas.
  it('n est pas bloqué par un voleur en attente', () => {
    const state = newGame(6);
    state.pendingRobber = true;
    const paired = pairedPlayer(state);
    if (!paired) return;

    fund(state, paired.id);
    const edge = freeEdgeFor(state, paired.id);
    expect(dispatch(state, cmd('BUILD_ROAD', paired.id, { edge })).ok).toBe(true);

    // Le joueur actif, lui, reste bloqué.
    fund(state, 'p1');
    expect(dispatch(state, cmd('BUILD_ROAD', 'p1', { edge: freeEdgeFor(state, 'p1') })))
      .toMatchObject({ ok: false, reason: 'invalid-robber-move' });
  });
});

// ── annonces dans le moteur ────────────────────────────────────────────────

describe('annonces de construction', () => {
  it('réserve les ressources dès l annonce', () => {
    const state = newGame(6);
    const p3 = playerOf(state, 'p3');
    if (!p3) return;
    p3.hand = counts({ wood: 1, brick: 1 });

    const edge = freeEdgeFor(state, 'p3');
    expect(dispatch(state, cmd('DECLARE_BUILD', 'p3', { target: { kind: 'road', edge } })).ok).toBe(true);

    // La main est vidée : les ressources ne sont plus échangeables.
    expect(total(p3.hand)).toBe(0);
    expect(state.intents).toHaveLength(1);
  });

  it('refuse une annonce sans les ressources', () => {
    const state = newGame(6);
    const p3 = playerOf(state, 'p3');
    if (p3) p3.hand = counts({});
    const edge = freeEdgeFor(state, 'p3');
    expect(dispatch(state, cmd('DECLARE_BUILD', 'p3', { target: { kind: 'road', edge } })))
      .toEqual({ ok: false, reason: 'not-enough-resources' });
  });

  it('rend les ressources à l annulation', () => {
    const state = newGame(6);
    const p3 = playerOf(state, 'p3');
    if (!p3) return;
    p3.hand = counts({ wood: 1, brick: 1 });

    const edge = freeEdgeFor(state, 'p3');
    dispatch(state, cmd('DECLARE_BUILD', 'p3', { target: { kind: 'road', edge } }));
    const intentId = state.intents[0]?.id as string;

    expect(dispatch(state, cmd('CANCEL_BUILD', 'p3', { intentId })).ok).toBe(true);
    expect(total(p3.hand)).toBe(2);
    expect(state.intents).toHaveLength(0);
  });

  it('interdit d annuler l annonce d un autre', () => {
    const state = newGame(6);
    const p3 = playerOf(state, 'p3');
    if (p3) p3.hand = counts({ wood: 1, brick: 1 });
    dispatch(state, cmd('DECLARE_BUILD', 'p3', { target: { kind: 'road', edge: freeEdgeFor(state, 'p3') } }));
    const intentId = state.intents[0]?.id as string;

    expect(dispatch(state, cmd('CANCEL_BUILD', 'p2', { intentId })).ok).toBe(false);
  });

  it('refuse deux annonces du même joueur au même endroit', () => {
    const state = newGame(6);
    const p3 = playerOf(state, 'p3');
    if (p3) p3.hand = counts({ wood: 2, brick: 2 });

    const edge = freeEdgeFor(state, 'p3');
    dispatch(state, cmd('DECLARE_BUILD', 'p3', { target: { kind: 'road', edge } }));
    expect(dispatch(state, cmd('DECLARE_BUILD', 'p3', { target: { kind: 'road', edge } })))
      .toEqual({ ok: false, reason: 'already-declared' });
  });
});

// ── cycle complet ──────────────────────────────────────────────────────────

describe('résolution en fin de cycle', () => {
  it('construit l annonce retenue et rembourse la perdante', () => {
    const state = newGame(6);
    const edge = freeEdgeFor(state, 'p3');

    for (const id of ['p3', 'p5']) {
      const p = playerOf(state, id);
      if (p) p.hand = counts({ wood: 1, brick: 1 });
    }
    // p3 annonce en premier, p5 ensuite : l'ancienneté doit départager.
    dispatch(state, cmd('DECLARE_BUILD', 'p3', { target: { kind: 'road', edge } }));
    dispatch(state, cmd('DECLARE_BUILD', 'p5', { target: { kind: 'road', edge } }));

    dispatch(state, cmd('END_TURN', 'p1'));
    const result = dispatch(state, cmd('END_CYCLE', 'p1'));
    expect(result.ok).toBe(true);

    expect(state.board.roadAt(edge)).toBe('p3');
    expect(total(playerOf(state, 'p5')?.hand ?? counts({}))).toBe(2);
    expect(state.intents).toHaveLength(0);
  });

  it('rembourse une annonce devenue illégale entre-temps', () => {
    const state = newGame(6);
    const edge = freeEdgeFor(state, 'p3');
    const p3 = playerOf(state, 'p3');
    if (p3) p3.hand = counts({ wood: 1, brick: 1 });

    dispatch(state, cmd('DECLARE_BUILD', 'p3', { target: { kind: 'road', edge } }));
    // Un autre joueur prend l'emplacement avant la résolution.
    state.board.setRoad(edge, 'p6');

    dispatch(state, cmd('END_TURN', 'p1'));
    const result = dispatch(state, cmd('END_CYCLE', 'p1'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events.some((e) => e.type === 'BuildRefunded' && e.reason === 'no-longer-legal')).toBe(true);
    expect(total(p3?.hand ?? counts({}))).toBe(2);
    expect(state.board.roadAt(edge)).toBe('p6');
  });

  it('refuse de terminer le cycle hors de la fenêtre de commerce', () => {
    const state = newGame(6);
    expect(dispatch(state, cmd('END_CYCLE', 'p1'))).toEqual({ ok: false, reason: 'wrong-phase' });
  });

  it('enchaîne les cycles et fait tourner l associé avec l actif', () => {
    const state = newGame(6);
    expect(pairedPlayer(state)?.id).toBe('p4');

    dispatch(state, cmd('END_TURN', 'p1'));
    dispatch(state, cmd('END_CYCLE', 'p1'));

    expect(state.cycle).toBe(2);
    expect(state.phase).toBe('production');
    expect(pairedPlayer(state)?.id).toBe('p5');
  });
});

describe('victoire en fin de cycle', () => {
  it('ne déclare pas de vainqueur en cours de phase', () => {
    const state = newGame(6);
    // On offre à p1 de quoi largement dépasser le seuil.
    for (const [vertex] of state.board.allBuildings()) {
      if (state.board.buildingAt(vertex)?.owner === 'p1') {
        state.board.setBuilding(vertex, { kind: 'city', owner: 'p1' });
      }
    }
    for (let i = 0; i < 8; i++) {
      const spot = settlementSpots(state.board, 'p1', { setupPhase: true })[0] as VertexId;
      if (!spot) break;
      state.board.setBuilding(spot, { kind: 'city', owner: 'p1' });
    }

    expect(state.winner).toBeUndefined();
    expect(state.phase).toBe('activeTurn');

    dispatch(state, cmd('END_TURN', 'p1'));
    const result = dispatch(state, cmd('END_CYCLE', 'p1'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.events.some((e) => e.type === 'GameWon')).toBe(true);
    expect(state.winner).toBe('p1');
    expect(state.phase).toBe('ended');
  });
});
