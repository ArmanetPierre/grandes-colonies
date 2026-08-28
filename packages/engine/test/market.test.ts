import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import type { HexData } from '../src/board/board.js';
import type { VertexId } from '../src/board/graph.js';
import type { Command, DomainEvent } from '../src/game/commands.js';
import { defaultConfig } from '../src/game/config.js';
import { dispatch } from '../src/game/engine.js';
import { type GameState, createGame, playerOf } from '../src/game/state.js';
import { bankRate } from '../src/game/trade.js';
import {
  GRAND_COLONIES_MARKET,
  createMarket,
  marketDrift,
  marketRate,
  recordMarketTrade,
} from '../src/market.js';
import { settlementSpots } from '../src/placement.js';
import { counts } from '../src/resources.js';

const ORIGIN: Axial = { q: 0, r: 0 };
const CONFIG = GRAND_COLONIES_MARKET;

function boardInit() {
  const positions = hexesWithin(ORIGIN, 2);
  const hexes = new Map<string, HexData>();
  positions.forEach((p, i) => {
    hexes.set(hexKey(p), { terrain: 'forest', token: ([3, 4, 5, 6, 8, 9] as const)[i % 6] ?? 5 });
  });
  return { positions, hexes };
}

let counter = 0;
const cmd = (type: Command['type'], playerId: string, extra: Record<string, unknown> = {}): Command =>
  ({ actionId: `mk${counter++}`, playerId, type, ...extra } as Command);

/** Une partie prête à commercer : mise en place jouée, dés lancés. */
function startedGame(playerCount = 4): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const state = createGame({
    players, board: boardInit(), config: defaultConfig(playerCount), seed: 'marche',
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

describe('cours d ouverture', () => {
  it('ouvre sur les valeurs du §10', () => {
    const market = createMarket();
    expect(marketRate(CONFIG, market, 'wood')).toBe(5);
    expect(marketRate(CONFIG, market, 'brick')).toBe(4);
    expect(marketRate(CONFIG, market, 'wool')).toBe(4);
    expect(marketRate(CONFIG, market, 'grain')).toBe(3);
    expect(marketRate(CONFIG, market, 'ore')).toBe(3);
    expect(marketRate(CONFIG, market, 'gold')).toBe(2);
  });

  it('n a encore penché nulle part', () => {
    const market = createMarket();
    expect(marketDrift(CONFIG, market, 'wood')).toBe(0);
  });
});

describe('mouvement du cours', () => {
  it('déprécie la ressource vendue au bout d un palier complet', () => {
    const market = createMarket();

    // Trois ventes ne suffisent pas : le cours tient jusqu'au quatrième.
    for (let i = 0; i < CONFIG.step - 1; i++) recordMarketTrade(CONFIG, market, 'wood', 'ore');
    expect(marketRate(CONFIG, market, 'wood')).toBe(5);
    expect(marketDrift(CONFIG, market, 'wood')).toBe(CONFIG.step - 1);

    const moves = recordMarketTrade(CONFIG, market, 'wood', 'ore');
    expect(marketRate(CONFIG, market, 'wood')).toBe(6);
    expect(moves).toContainEqual({ resource: 'wood', from: 5, to: 6 });
  });

  it('renchérit la ressource achetée', () => {
    const market = createMarket();
    for (let i = 0; i < CONFIG.step; i++) recordMarketTrade(CONFIG, market, 'wood', 'ore');
    // Le minerai est sorti quatre fois du marché : il se raréfie.
    expect(marketRate(CONFIG, market, 'ore')).toBe(2);
  });

  it('compte les transactions et non les cartes', () => {
    // Un échange donne cinq cartes contre une : si l'on comptait les cartes,
    // le bois bougerait cinq fois plus vite que le minerai et tous les cours
    // dériveraient vers le plafond. Un mouvement de chaque côté, donc.
    const market = createMarket();
    recordMarketTrade(CONFIG, market, 'wood', 'ore');
    expect(market.flow.wood).toBe(1);
    expect(market.flow.ore).toBe(-1);
  });

  it('revient exactement sur ses pas', () => {
    const market = createMarket();
    for (let i = 0; i < CONFIG.step; i++) recordMarketTrade(CONFIG, market, 'wood', 'ore');
    expect(marketRate(CONFIG, market, 'wood')).toBe(6);

    for (let i = 0; i < CONFIG.step; i++) recordMarketTrade(CONFIG, market, 'ore', 'wood');
    expect(marketRate(CONFIG, market, 'wood')).toBe(5);
    expect(marketRate(CONFIG, market, 'ore')).toBe(3);
  });

  it('reste borné, quel que soit l acharnement', () => {
    const market = createMarket();
    for (let i = 0; i < 200; i++) recordMarketTrade(CONFIG, market, 'wood', 'gold');
    expect(marketRate(CONFIG, market, 'wood')).toBe(CONFIG.maximum);
    expect(marketRate(CONFIG, market, 'gold')).toBe(CONFIG.minimum);
  });

  it('décolle d une borne en un seul palier', () => {
    const market = createMarket();
    for (let i = 0; i < 200; i++) recordMarketTrade(CONFIG, market, 'wood', 'gold');
    expect(marketRate(CONFIG, market, 'wood')).toBe(CONFIG.maximum);

    // Le solde est borné, donc le cours redescend au bout d'un palier — et
    // non au bout des deux cents achats qu'il aurait fallu sans cela.
    for (let i = 0; i < CONFIG.step; i++) recordMarketTrade(CONFIG, market, 'gold', 'wood');
    expect(marketRate(CONFIG, market, 'wood')).toBe(CONFIG.maximum - 1);
  });

  it('cesse de promettre un mouvement contre une borne', () => {
    const market = createMarket();
    for (let i = 0; i < 200; i++) recordMarketTrade(CONFIG, market, 'wood', 'gold');
    // Le bois est au plafond : la bande ne doit plus annoncer de hausse.
    expect(marketDrift(CONFIG, market, 'wood')).toBe(0);
    expect(marketDrift(CONFIG, market, 'gold')).toBe(0);
  });
});

describe('le marché dans le moteur', () => {
  it('facture au cours du jour', () => {
    const state = startedGame();
    // Le blé ouvre à 3, pas au 4:1 classique.
    expect(bankRate(state, 'p1', 'grain')).toBe(3);
  });

  it('rend l échange plus cher à force de vendre la même chose', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');

    for (let i = 0; i < CONFIG.step; i++) {
      p1.hand = counts({ grain: 3 });
      const result = dispatch(state, cmd('TRADE_WITH_BANK', 'p1', {
        give: counts({ grain: 3 }), receive: counts({ brick: 1 }),
      }));
      expect(result.ok).toBe(true);
    }

    expect(bankRate(state, 'p1', 'grain')).toBe(4);
    // L'ancien prix n'est plus recevable : le moteur refuse trois cartes.
    p1.hand = counts({ grain: 4 });
    expect(dispatch(state, cmd('TRADE_WITH_BANK', 'p1', {
      give: counts({ grain: 3 }), receive: counts({ brick: 1 }),
    }))).toMatchObject({ ok: false, reason: 'invalid-trade' });
  });

  it('annonce le franchissement à toute la table', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');

    let moved: DomainEvent[] = [];
    for (let i = 0; i < CONFIG.step; i++) {
      p1.hand = counts({ grain: 3 });
      const result = dispatch(state, cmd('TRADE_WITH_BANK', 'p1', {
        give: counts({ grain: 3 }), receive: counts({ brick: 1 }),
      }));
      if (result.ok) moved = [...moved, ...result.events.filter((e) => e.type === 'MarketMoved')];
    }

    expect(moved).toContainEqual({ type: 'MarketMoved', resource: 'grain', from: 3, to: 4 });
    expect(moved).toContainEqual({ type: 'MarketMoved', resource: 'brick', from: 4, to: 3 });
  });

  it('ne bouge pas sur un échange refusé', () => {
    const state = startedGame();
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.hand = counts({ grain: 1 });

    dispatch(state, cmd('TRADE_WITH_BANK', 'p1', {
      give: counts({ grain: 3 }), receive: counts({ brick: 1 }),
    }));

    expect(state.market.flow.grain).toBe(0);
    expect(state.market.flow.brick).toBe(0);
  });

  it('ne bouge pas sur un échange entre joueurs', () => {
    const state = startedGame();
    const [p1, p2] = [playerOf(state, 'p1'), playerOf(state, 'p2')];
    if (!p1 || !p2) throw new Error('joueur absent');
    p1.hand = counts({ grain: 2 });
    p2.hand = counts({ ore: 1 });

    const created = dispatch(state, cmd('CREATE_TRADE', 'p1', {
      to: 'p2', give: counts({ grain: 2 }), receive: counts({ ore: 1 }),
    }));
    expect(created.ok).toBe(true);
    const offerId = state.offers[0]?.id as string;
    expect(dispatch(state, cmd('ACCEPT_TRADE', 'p2', { offerId })).ok).toBe(true);

    // La négociation directe échappe au marché : c'est ce qui lui garde son
    // intérêt face à la banque.
    expect(state.market.flow.grain).toBe(0);
    expect(state.market.flow.ore).toBe(0);
  });
});
