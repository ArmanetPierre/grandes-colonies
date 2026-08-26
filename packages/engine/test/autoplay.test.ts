import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import type { HexData } from '../src/board/board.js';
import type { EdgeId, VertexId } from '../src/board/graph.js';
import { defaultRobberTarget, nextDefaultCommand, suggestDiscard } from '../src/game/autoplay.js';
import type { Command } from '../src/game/commands.js';
import { defaultConfig } from '../src/game/config.js';
import { dispatch } from '../src/game/engine.js';
import { type GameState, createGame, playerOf } from '../src/game/state.js';
import { settlementSpots } from '../src/placement.js';
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
const cmd = (type: Command['type'], playerId: string, extra: Record<string, unknown> = {}): Command =>
  ({ actionId: `d${counter++}`, playerId, type, ...extra } as Command);

function startedGame(playerCount = 4, seed: string | number = 'auto'): GameState {
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
  return state;
}

/** Déroule le jeu par défaut jusqu'à ce que le joueur ne bloque plus rien. */
function autoPlay(state: GameState, playerId: string, limit = 12): Command[] {
  const played: Command[] = [];
  for (let i = 0; i < limit; i++) {
    const next = nextDefaultCommand(state, playerId, `auto${counter++}`);
    if (!next) break;
    const result = dispatch(state, next);
    expect(result.ok).toBe(true);
    played.push(next);
  }
  return played;
}

describe('suggestion de défausse', () => {
  it('entame toujours la pile la plus fournie', () => {
    const hand = counts({ wood: 5, brick: 1, ore: 1 });
    const discard = suggestDiscard(hand, 3);
    expect(total(discard)).toBe(3);
    expect(amount(discard, 'wood')).toBe(3);
    expect(amount(discard, 'brick')).toBe(0);
  });

  // Perdre sa seule brique coûte bien plus cher que perdre un bois sur cinq.
  it('préserve la diversité de la main', () => {
    const hand = counts({ wood: 4, brick: 4, ore: 1 });
    const discard = suggestDiscard(hand, 4);
    expect(amount(discard, 'ore')).toBe(0);
    expect(amount(discard, 'wood') + amount(discard, 'brick')).toBe(4);
  });

  it('ne défausse jamais plus que la main', () => {
    expect(total(suggestDiscard(counts({ wood: 2 }), 5))).toBe(2);
  });

  it('renvoie une défausse vide pour un compte nul', () => {
    expect(suggestDiscard(counts({ wood: 3 }), 0)).toEqual({});
  });

  it('reste déterministe à main égale', () => {
    const hand = counts({ wood: 3, brick: 3, ore: 3 });
    expect(suggestDiscard(hand, 4)).toEqual(suggestDiscard(hand, 4));
  });
});

describe('cible du voleur par défaut', () => {
  // Décider à la place d'un absent qui il doit bloquer serait arbitraire et
  // pourrait changer l'issue de la partie.
  it('choisit un hexagone qui ne lèse personne', () => {
    const state = startedGame();
    const target = defaultRobberTarget(state);
    expect(target).toBeDefined();
    if (!target) return;

    const [q, r] = target.split(',').map(Number);
    expect(state.board.buildingsAroundHex({ q: q as number, r: r as number })).toHaveLength(0);
  });

  it('reste déterministe', () => {
    const a = startedGame(4, 'graine');
    const b = startedGame(4, 'graine');
    expect(defaultRobberTarget(a)).toBe(defaultRobberTarget(b));
  });
});

describe('tour joué par défaut', () => {
  it('lance les dés puis passe la main', () => {
    const state = startedGame();
    expect(state.phase).toBe('production');

    const played = autoPlay(state, 'p1');
    expect(played.map((c) => c.type)).toContain('ROLL_DICE');
    expect(played.map((c) => c.type)).toContain('END_TURN');
    expect(played.map((c) => c.type)).toContain('END_CYCLE');

    // La partie a bien avancé d'un cycle.
    expect(state.cycle).toBe(2);
    expect(state.activeIndex).toBe(1);
    expect(state.phase).toBe('production');
  });

  // Le tour par défaut débloque la partie, il ne joue pas à la place du joueur.
  it('ne construit rien et n achète rien', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) return;
    p1.hand = counts({ wood: 5, brick: 5, wool: 5, grain: 5, ore: 5 });

    const buildingsBefore = state.board.allBuildings().size;
    const roadsBefore = state.board.allRoutes().size;
    const deckBefore = state.deck.length;

    const played = autoPlay(state, 'p1');
    expect(played.every((c) => !c.type.startsWith('BUILD'))).toBe(true);
    expect(state.board.allBuildings().size).toBe(buildingsBefore);
    expect(state.board.allRoutes().size).toBe(roadsBefore);
    expect(state.deck.length).toBe(deckBefore);
  });

  it('règle une défausse due avant toute autre chose', () => {
    const state = startedGame();
    const p2 = playerOf(state, 'p2');
    if (!p2) return;
    p2.hand = counts({ wood: 8 });
    p2.mustDiscard = 4;

    const next = nextDefaultCommand(state, 'p2', 'x');
    expect(next?.type).toBe('DISCARD');
    expect(dispatch(state, next as Command).ok).toBe(true);
    expect(p2.mustDiscard).toBe(0);
    expect(total(p2.hand)).toBe(4);
  });

  it('déplace le voleur quand un sept l impose', () => {
    const state = startedGame();
    dispatch(state, cmd('ROLL_DICE', 'p1'));
    state.pendingRobber = true;
    for (const p of state.players) p.mustDiscard = 0;

    const next = nextDefaultCommand(state, 'p1', 'y');
    expect(next?.type).toBe('MOVE_ROBBER');
    expect(dispatch(state, next as Command).ok).toBe(true);
    expect(state.pendingRobber).toBe(false);
  });

  // L'associé n'a pas de tour obligatoire : son absence ne bloque rien.
  it('ne demande rien à un joueur qui n est pas actif', () => {
    const state = startedGame(6);
    expect(nextDefaultCommand(state, 'p4', 'z')).toBeUndefined();
    expect(nextDefaultCommand(state, 'p2', 'z')).toBeUndefined();
  });

  it('ne demande rien une fois la partie terminée', () => {
    const state = startedGame();
    state.phase = 'ended';
    expect(nextDefaultCommand(state, 'p1', 'z')).toBeUndefined();
  });

  it('enchaîne plusieurs tours d affilée sans jamais bloquer', () => {
    const state = startedGame(4);
    for (let i = 0; i < 4; i++) {
      const active = state.players[state.activeIndex]?.id as string;
      // Chaque joueur concerné règle d'abord sa défausse éventuelle.
      for (const p of state.players) autoPlay(state, p.id, 3);
      autoPlay(state, active);
    }
    expect(state.cycle).toBeGreaterThanOrEqual(5);
    expect(state.phase).toBe('production');
  });
});
