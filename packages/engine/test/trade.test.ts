import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import { Board, type HexData } from '../src/board/board.js';
import type { VertexId } from '../src/board/graph.js';
import type { Command } from '../src/game/commands.js';
import { defaultConfig } from '../src/game/config.js';
import { dispatch } from '../src/game/engine.js';
import { type GameState, createGame, playerOf } from '../src/game/state.js';
import { checkOffer, isAddressedTo, type TradeOffer } from '../src/game/trade.js';
import { settlementSpots } from '../src/placement.js';
import { BASE_RATE, type Port, tradeRate } from '../src/ports.js';
import { amount, counts } from '../src/resources.js';

const ORIGIN: Axial = { q: 0, r: 0 };

function boardInit(ports?: Map<VertexId, Port>) {
  const positions = hexesWithin(ORIGIN, 2);
  const hexes = new Map<string, HexData>();
  positions.forEach((p, i) => {
    hexes.set(hexKey(p), { terrain: 'forest', token: ([3, 4, 5, 6, 8, 9] as const)[i % 6] ?? 5 });
  });
  return ports ? { positions, hexes, ports } : { positions, hexes };
}

let counter = 0;
const cmd = (type: Command['type'], playerId: string, extra: Record<string, unknown> = {}): Command =>
  ({ actionId: `tr${counter++}`, playerId, type, ...extra } as Command);

function startedGame(playerCount = 4, ports?: Map<VertexId, Port>): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const state = createGame({
    players, board: boardInit(ports), config: defaultConfig(playerCount), seed: 'trade',
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
  dispatch(state, cmd('ROLL_DICE', 'p1'));
  state.pendingRobber = false;
  for (const p of state.players) p.mustDiscard = 0;
  return state;
}

describe('taux de change et ports', () => {
  it('applique quatre contre une sans port', () => {
    const board = new Board(boardInit());
    expect(tradeRate(board, 'p1', 'wood')).toBe(BASE_RATE);
  });

  it('applique trois contre une sur un port générique', () => {
    const board = new Board(boardInit());
    const vertex = [...board.graph.vertices].sort()[0] as VertexId;
    board.setBuilding(vertex, { kind: 'settlement', owner: 'p1' });

    const ports = new Map<VertexId, Port>([[vertex, { kind: 'generic' }]]);
    const withPort = new Board(boardInit(ports));
    withPort.setBuilding(vertex, { kind: 'settlement', owner: 'p1' });
    expect(tradeRate(withPort, 'p1', 'wood')).toBe(3);
  });

  it('applique deux contre une sur le port spécialisé correspondant', () => {
    const vertex = [...new Board(boardInit()).graph.vertices].sort()[0] as VertexId;
    const board = new Board(boardInit(new Map([[vertex, { kind: 'wood' } as Port]])));
    board.setBuilding(vertex, { kind: 'settlement', owner: 'p1' });

    expect(tradeRate(board, 'p1', 'wood')).toBe(2);
    // Les autres ressources n'en profitent pas.
    expect(tradeRate(board, 'p1', 'ore')).toBe(BASE_RATE);
  });

  it('applique deux contre une sur tout au port marchand', () => {
    const vertex = [...new Board(boardInit()).graph.vertices].sort()[0] as VertexId;
    const board = new Board(boardInit(new Map([[vertex, { kind: 'merchant' } as Port]])));
    board.setBuilding(vertex, { kind: 'settlement', owner: 'p1' });
    expect(tradeRate(board, 'p1', 'ore')).toBe(2);
  });

  it('ne profite pas d un port occupé par un autre joueur', () => {
    const vertex = [...new Board(boardInit()).graph.vertices].sort()[0] as VertexId;
    const board = new Board(boardInit(new Map([[vertex, { kind: 'generic' } as Port]])));
    board.setBuilding(vertex, { kind: 'settlement', owner: 'p2' });
    expect(tradeRate(board, 'p1', 'wood')).toBe(BASE_RATE);
  });

  it('retient le meilleur taux quand plusieurs ports se cumulent', () => {
    const base = new Board(boardInit());
    const [a, b] = [...base.graph.vertices].sort();
    const ports = new Map<VertexId, Port>([
      [a as VertexId, { kind: 'generic' }],
      [b as VertexId, { kind: 'ore' }],
    ]);
    const board = new Board(boardInit(ports));
    board.setBuilding(a as VertexId, { kind: 'settlement', owner: 'p1' });
    board.setBuilding(b as VertexId, { kind: 'city', owner: 'p1' });

    expect(tradeRate(board, 'p1', 'ore')).toBe(2);
    // Le port générique reste utile pour les autres ressources.
    expect(tradeRate(board, 'p1', 'wood')).toBe(3);
  });

  it('fait suivre le taux à la banque dans le moteur', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.hand = counts({ wood: 4 });

    // Sans port, trois cartes ne suffisent pas.
    expect(dispatch(state, cmd('TRADE_WITH_BANK', 'p1', {
      give: counts({ wood: 3 }), receive: counts({ ore: 1 }),
    }))).toMatchObject({ ok: false, reason: 'invalid-trade' });

    expect(dispatch(state, cmd('TRADE_WITH_BANK', 'p1', {
      give: counts({ wood: 4 }), receive: counts({ ore: 1 }),
    })).ok).toBe(true);
  });
});

describe('validité d une offre', () => {
  it('refuse une offre vide', () => {
    expect(checkOffer('p1', 'p2', counts({}), counts({ ore: 1 }))).toBe('empty');
    expect(checkOffer('p1', 'p2', counts({ wood: 1 }), counts({}))).toBe('empty');
  });

  it('refuse une offre adressée à soi-même', () => {
    expect(checkOffer('p1', 'p1', counts({ wood: 1 }), counts({ ore: 1 }))).toBe('self-directed');
  });

  it('refuse un échange sans effet', () => {
    expect(checkOffer('p1', 'p2', counts({ wood: 2 }), counts({ wood: 2 }))).toBe('same-resources');
  });

  it('accepte une offre bien formée', () => {
    expect(checkOffer('p1', undefined, counts({ wood: 2 }), counts({ ore: 1 }))).toBeUndefined();
  });

  it('adresse une offre ouverte à tous sauf à son auteur', () => {
    const offer: TradeOffer = {
      id: 't0', from: 'p1', to: undefined,
      give: counts({ wood: 1 }), receive: counts({ ore: 1 }), cycle: 1,
    };
    expect(isAddressedTo(offer, 'p2')).toBe(true);
    expect(isAddressedTo(offer, 'p1')).toBe(false);
  });

  it('réserve une offre nominative à son destinataire', () => {
    const offer: TradeOffer = {
      id: 't0', from: 'p1', to: 'p2',
      give: counts({ wood: 1 }), receive: counts({ ore: 1 }), cycle: 1,
    };
    expect(isAddressedTo(offer, 'p2')).toBe(true);
    expect(isAddressedTo(offer, 'p3')).toBe(false);
  });
});

describe('commerce entre joueurs', () => {
  function funded(state: GameState) {
    const p1 = playerOf(state, 'p1');
    const p2 = playerOf(state, 'p2');
    if (!p1 || !p2) throw new Error('joueurs absents');
    p1.hand = counts({ wood: 3 });
    p2.hand = counts({ ore: 2 });
    return { p1, p2 };
  }

  it('échange les ressources des deux côtés', () => {
    const state = startedGame();
    const { p1, p2 } = funded(state);

    dispatch(state, cmd('CREATE_TRADE', 'p1', {
      to: 'p2', give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    }));
    const offerId = state.offers[0]?.id as string;
    expect(dispatch(state, cmd('ACCEPT_TRADE', 'p2', { offerId })).ok).toBe(true);

    expect(amount(p1.hand, 'wood')).toBe(1);
    expect(amount(p1.hand, 'ore')).toBe(1);
    expect(amount(p2.hand, 'wood')).toBe(2);
    expect(amount(p2.hand, 'ore')).toBe(1);
    expect(state.offers).toHaveLength(0);
  });

  it('refuse une offre destinée à quelqu un d autre', () => {
    const state = startedGame();
    funded(state);
    dispatch(state, cmd('CREATE_TRADE', 'p1', {
      to: 'p2', give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    }));
    const offerId = state.offers[0]?.id as string;
    expect(dispatch(state, cmd('ACCEPT_TRADE', 'p3', { offerId })))
      .toEqual({ ok: false, reason: 'offer-not-for-you' });
  });

  // Le point délicat : l'inventaire du proposant peut changer entre-temps.
  it('déclare caduque une offre que le proposant ne peut plus honorer', () => {
    const state = startedGame();
    const { p1 } = funded(state);

    dispatch(state, cmd('CREATE_TRADE', 'p1', {
      to: 'p2', give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    }));
    const offerId = state.offers[0]?.id as string;

    // p1 dépense son bois avant que p2 n'accepte.
    p1.hand = counts({});

    expect(dispatch(state, cmd('ACCEPT_TRADE', 'p2', { offerId })))
      .toMatchObject({ ok: false, reason: 'offer-stale' });
    // L'offre disparaît plutôt que de traîner.
    expect(state.offers).toHaveLength(0);
  });

  it('refuse si l accepteur n a pas de quoi payer', () => {
    const state = startedGame();
    const { p2 } = funded(state);
    dispatch(state, cmd('CREATE_TRADE', 'p1', {
      to: 'p2', give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    }));
    const offerId = state.offers[0]?.id as string;
    p2.hand = counts({});

    expect(dispatch(state, cmd('ACCEPT_TRADE', 'p2', { offerId })))
      .toEqual({ ok: false, reason: 'not-enough-resources' });
  });

  it('laisse l auteur retirer son offre', () => {
    const state = startedGame();
    funded(state);
    dispatch(state, cmd('CREATE_TRADE', 'p1', {
      give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    }));
    const offerId = state.offers[0]?.id as string;
    expect(dispatch(state, cmd('CANCEL_TRADE', 'p1', { offerId })).ok).toBe(true);
    expect(state.offers).toHaveLength(0);
  });

  it('empêche un tiers de retirer une offre', () => {
    const state = startedGame();
    funded(state);
    dispatch(state, cmd('CREATE_TRADE', 'p1', {
      give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    }));
    const offerId = state.offers[0]?.id as string;
    expect(dispatch(state, cmd('CANCEL_TRADE', 'p3', { offerId })).ok).toBe(false);
  });

  // Le joueur associé construit et commerce avec la banque, mais négocier lui
  // donnerait le double avantage d'agir hors tour ET de peser sur le marché.
  it('interdit la négociation au joueur associé pendant le tour', () => {
    const state = startedGame(6);
    const paired = state.players[(state.activeIndex + 3) % 6];
    if (!paired) throw new Error('associé absent');
    paired.hand = counts({ wood: 3 });

    expect(dispatch(state, cmd('CREATE_TRADE', paired.id, {
      give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    }))).toEqual({ ok: false, reason: 'wrong-phase' });
  });

  it('ouvre la négociation à tous pendant la fenêtre de commerce', () => {
    const state = startedGame(6);
    dispatch(state, cmd('END_TURN', 'p1'));
    expect(state.phase).toBe('freeTrade');

    const p5 = playerOf(state, 'p5');
    if (!p5) throw new Error('joueur absent');
    p5.hand = counts({ wood: 3 });

    expect(dispatch(state, cmd('CREATE_TRADE', 'p5', {
      give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    })).ok).toBe(true);
  });

  it('vide les offres à la fin du cycle', () => {
    const state = startedGame();
    funded(state);
    dispatch(state, cmd('CREATE_TRADE', 'p1', {
      give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    }));
    expect(state.offers).toHaveLength(1);

    dispatch(state, cmd('END_TURN', 'p1'));
    const result = dispatch(state, cmd('END_CYCLE', 'p1'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(state.offers).toHaveLength(0);
    expect(result.events.some((e) => e.type === 'TradeExpired')).toBe(true);
  });
});
