import { describe, expect, it } from 'vitest';

import {
  type GameState,
  type HexData,
  type VertexId,
  buyCard,
  counts,
  createGame,
  defaultConfig,
  dispatch,
  hexKey,
  hexesWithin,
  playerOf,
  settlementSpots,
} from '@grand-colonies/engine';

import { privateView, publicView, revealedObjectives } from '../src/views.js';

function boardInit() {
  const positions = hexesWithin({ q: 0, r: 0 }, 2);
  const hexes = new Map<string, HexData>();
  positions.forEach((p, i) => {
    hexes.set(hexKey(p), { terrain: 'forest', token: ([3, 4, 5, 6, 8, 9] as const)[i % 6] ?? 5 });
  });
  return { positions, hexes };
}

let counter = 0;
const cmd = (type: string, playerId: string, extra: Record<string, unknown> = {}) =>
  ({ actionId: `v${counter++}`, playerId, type, ...extra }) as never;

function startedGame(playerCount = 6): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const state = createGame({
    players, board: boardInit(), config: defaultConfig(playerCount), seed: 'views',
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
  return state;
}

describe('étanchéité de la vue publique', () => {
  /**
   * Le test qui compte. On donne à un joueur une main très reconnaissable,
   * puis on inspecte la vue publique SÉRIALISÉE : si une quantité privée
   * s'y trouve, elle apparaîtra dans le JSON.
   */
  it('ne laisse jamais fuir le contenu d une main', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.hand = counts({ wood: 41, ore: 37 });

    const json = JSON.stringify(publicView(state));

    // Les quantités exactes ne doivent apparaître nulle part.
    expect(json).not.toContain('41');
    expect(json).not.toContain('37');
    // En revanche, le nombre total de cartes est public : c'est lui qui
    // permet aux autres de juger d'une menace de défausse.
    expect(publicView(state).players[0]?.handSize).toBe(78);
  });

  it('ne laisse jamais fuir les objectifs secrets', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    expect(p1.offeredObjectives.length).toBeGreaterThan(0);

    const json = JSON.stringify(publicView(state));
    for (const objective of p1.offeredObjectives) {
      expect(json).not.toContain(objective);
    }
  });

  it('ne laisse jamais fuir l ordre de la pioche', () => {
    const state = startedGame();
    const view = publicView(state);
    // Seul le nombre de cartes restantes est public.
    expect(view.deckRemaining).toBe(state.deck.length);
    expect(JSON.stringify(view)).not.toContain('"knight"');
  });

  /**
   * Piège subtil : publier le score complet révélerait indirectement si
   * l'objectif secret est rempli, donc une partie de son contenu.
   */
  it('exclut l objectif secret du score public', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');

    // On force un objectif rempli : cinq colonies posées.
    p1.chosenObjective = 'settler';
    const free = [...state.board.graph.vertices].sort().filter((v) => !state.board.buildingAt(v));
    for (const v of free.slice(0, 5)) state.board.setBuilding(v, { kind: 'settlement', owner: 'p1' });

    const priv = privateView(state, 'p1');
    const pub = publicView(state).players.find((p) => p.id === 'p1');

    expect(priv?.objectiveComplete).toBe(true);
    // Le privé compte les deux points, le public non.
    expect((priv?.points ?? 0) - (pub?.publicPoints ?? 0)).toBe(2);
  });

  it('publie ce qui doit l être', () => {
    const state = startedGame();
    const view = publicView(state);

    expect(view.hexes.length).toBe(state.board.allHexData().size);
    expect(view.buildings.length).toBe(state.board.allBuildings().size);
    expect(view.players).toHaveLength(6);
    expect(view.activePlayer).toBe('p1');
    expect(view.pairedPlayer).toBe('p4');
    expect(view.victoryTarget).toBe(15);
  });

  it('signale les emplacements contestés sans dire par qui', () => {
    const state = startedGame();
    dispatch(state, cmd('ROLL_DICE', 'p1'));
    state.pendingRobber = false;
    for (const p of state.players) p.mustDiscard = 0;

    for (const id of ['p2', 'p3']) {
      const p = playerOf(state, id);
      if (p) p.hand = counts({ wood: 1, brick: 1 });
    }
    const edge = [...state.board.graph.edges].sort()[0] as string;
    dispatch(state, cmd('DECLARE_BUILD', 'p2', { target: { kind: 'road', edge } }));
    dispatch(state, cmd('DECLARE_BUILD', 'p3', { target: { kind: 'road', edge } }));

    const intents = publicView(state).intents;
    expect(intents).toHaveLength(2);
    expect(intents.every((i) => i.contested)).toBe(true);
  });

  it('marque les joueurs déconnectés', () => {
    const state = startedGame();
    const view = publicView(state, { isConnected: (id) => id !== 'p3' });
    expect(view.players.find((p) => p.id === 'p3')?.connected).toBe(false);
    expect(view.players.find((p) => p.id === 'p1')?.connected).toBe(true);
  });
});

describe('vue privée', () => {
  it('donne au joueur sa main et ses objectifs', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.hand = counts({ wood: 3 });

    const view = privateView(state, 'p1');
    expect(view?.hand).toEqual({ wood: 3 });
    expect(view?.offeredObjectives).toHaveLength(2);
  });

  it('distingue les cartes jouables de celles achetées ce tour', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.devCards = buyCard(p1.devCards, 'monopoly');

    const view = privateView(state, 'p1');
    expect(view?.pendingDevCards).toEqual(['monopoly']);
    expect(view?.playableDevCards).toEqual([]);
  });

  it('expose les capacités du moment', () => {
    const state = startedGame();
    expect(privateView(state, 'p1')?.capabilities).toContain('CAN_ROLL_DICE');
    // Un joueur qui n'est pas actif ne peut pas lancer.
    expect(privateView(state, 'p2')?.capabilities).not.toContain('CAN_ROLL_DICE');
  });

  it('ne renvoie rien pour un joueur inconnu', () => {
    expect(privateView(startedGame(), 'inconnu')).toBeUndefined();
  });
});

describe('révélation en fin de partie', () => {
  it('ne révèle rien tant que la partie dure', () => {
    expect(revealedObjectives(startedGame())).toHaveLength(0);
  });

  it('révèle tous les objectifs une fois la partie finie', () => {
    const state = startedGame();
    state.phase = 'ended';
    const revealed = revealedObjectives(state);
    expect(revealed).toHaveLength(6);
    expect(revealed.every((r) => r.objective !== undefined)).toBe(true);
  });
});
