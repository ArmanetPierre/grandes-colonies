import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import { archipelagoBoard, archipelagoOptionsFor } from '../src/board/presets.js';
import { SeededRandom } from '../src/rng.js';
import { Board, type HexData } from '../src/board/board.js';
import type { VertexId } from '../src/board/graph.js';
import type { Command } from '../src/game/commands.js';
import { defaultConfig } from '../src/game/config.js';
import { dispatch } from '../src/game/engine.js';
import { type GameState, createGame, playerOf } from '../src/game/state.js';
import { bankRate } from '../src/game/trade.js';
import { marketRate } from '../src/market.js';
import { PORT_KINDS, type Port, hasPort, portKindsOf } from '../src/ports.js';
import { settlementSpots } from '../src/placement.js';
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
  ({ actionId: `cp${counter++}`, playerId, type, ...extra } as Command);

/** Le premier sommet du plateau, celui sur lequel on plante le port testé. */
const firstVertex = (): VertexId => [...new Board(boardInit()).graph.vertices].sort()[0] as VertexId;

/** Une partie prête à commercer, avec un port du type demandé posé sur p1. */
function gameWithPort(kind: Port['kind'] | undefined, owner = 'p1'): GameState {
  const vertex = firstVertex();
  const ports = kind ? new Map<VertexId, Port>([[vertex, { kind }]]) : undefined;
  const players = Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const state = createGame({
    players, board: boardInit(ports), config: defaultConfig(4), seed: 'ports',
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
  if (kind) state.board.setBuilding(vertex, { kind: 'settlement', owner });
  return state;
}

describe('reconnaissance des ports', () => {
  it('ne voit un port qu à celui qui l occupe', () => {
    const state = gameWithPort('mining', 'p2');
    expect(hasPort(state.board, 'p2', 'mining')).toBe(true);
    expect(hasPort(state.board, 'p1', 'mining')).toBe(false);
  });

  it('énumère les types occupés, sans doublon', () => {
    const state = gameWithPort('commercial');
    expect(portKindsOf(state.board, 'p1')).toEqual(['commercial']);
    expect(portKindsOf(state.board, 'p3')).toEqual([]);
  });

  it('ne remise pas le cours', () => {
    const state = gameWithPort('mining');
    // Un port à contrat a son propre échange : il ne touche pas au marché.
    expect(bankRate(state, 'p1', 'ore')).toBe(marketRate(state.config.market, state.market, 'ore'));
  });
});

describe('port minier', () => {
  it('fond deux minerai en un or', () => {
    const state = gameWithPort('mining');
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.hand = counts({ ore: 2 });

    expect(dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'mining', give: counts({ ore: 2 }), receive: counts({ gold: 1 }),
    })).ok).toBe(true);
    expect(amount(p1.hand, 'gold')).toBe(1);
    expect(amount(p1.hand, 'ore')).toBe(0);
  });

  it('ne rend rien d autre que de l or', () => {
    const state = gameWithPort('mining');
    const p1 = playerOf(state, 'p1');
    if (p1) p1.hand = counts({ ore: 2 });

    expect(dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'mining', give: counts({ ore: 2 }), receive: counts({ brick: 1 }),
    }))).toMatchObject({ ok: false, reason: 'invalid-trade' });
  });

  it('n accepte que du minerai en paiement', () => {
    const state = gameWithPort('mining');
    const p1 = playerOf(state, 'p1');
    if (p1) p1.hand = counts({ wood: 2 });

    expect(dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'mining', give: counts({ wood: 2 }), receive: counts({ gold: 1 }),
    }))).toMatchObject({ ok: false, reason: 'invalid-trade' });
  });

  it('refuse le port à qui ne l occupe pas', () => {
    const state = gameWithPort('mining', 'p2');
    const p1 = playerOf(state, 'p1');
    if (p1) p1.hand = counts({ ore: 2 });

    expect(dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'mining', give: counts({ ore: 2 }), receive: counts({ gold: 1 }),
    }))).toMatchObject({ ok: false, reason: 'no-such-port' });
  });

  it('garde son prix quand le marché s emballe', () => {
    const state = gameWithPort('mining');
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');

    // On pousse le minerai au plafond du marché.
    for (let i = 0; i < 40; i++) state.market.flow.ore = (state.market.flow.ore ?? 0) + 1;
    expect(marketRate(state.config.market, state.market, 'ore')).toBe(state.config.market.maximum);

    // Le contrat, lui, n'a pas bougé : c'est là qu'il prend toute sa valeur.
    p1.hand = counts({ ore: 2 });
    expect(dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'mining', give: counts({ ore: 2 }), receive: counts({ gold: 1 }),
    })).ok).toBe(true);
  });
});

describe('port commercial', () => {
  it('convertit deux ressources différentes en une au choix', () => {
    const state = gameWithPort('commercial');
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.hand = counts({ wood: 1, wool: 1 });

    expect(dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'commercial', give: counts({ wood: 1, wool: 1 }), receive: counts({ ore: 1 }),
    })).ok).toBe(true);
    expect(amount(p1.hand, 'ore')).toBe(1);
  });

  it('refuse deux cartes de la même nature', () => {
    const state = gameWithPort('commercial');
    const p1 = playerOf(state, 'p1');
    if (p1) p1.hand = counts({ wood: 2 });

    // C'est tout ce qui le distingue d'un port ordinaire : on n'y écoule pas
    // un surplus, on y convertit une main éparpillée.
    expect(dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'commercial', give: counts({ wood: 2 }), receive: counts({ ore: 1 }),
    }))).toMatchObject({ ok: false, reason: 'invalid-trade' });
  });

  it('refuse de payer avec la ressource demandée', () => {
    const state = gameWithPort('commercial');
    const p1 = playerOf(state, 'p1');
    if (p1) p1.hand = counts({ wood: 1, ore: 1 });

    expect(dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'commercial', give: counts({ wood: 1, ore: 1 }), receive: counts({ ore: 1 }),
    }))).toMatchObject({ ok: false, reason: 'invalid-trade' });
  });

  it('refuse trois cartes', () => {
    const state = gameWithPort('commercial');
    const p1 = playerOf(state, 'p1');
    if (p1) p1.hand = counts({ wood: 1, wool: 1, grain: 1 });

    expect(dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'commercial', give: counts({ wood: 1, wool: 1, grain: 1 }), receive: counts({ ore: 1 }),
    }))).toMatchObject({ ok: false, reason: 'invalid-trade' });
  });
});

describe('les ports à contrat et le marché', () => {
  it('ne font jamais bouger le cours', () => {
    const state = gameWithPort('commercial');
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.hand = counts({ wood: 1, wool: 1 });

    dispatch(state, cmd('TRADE_AT_PORT', 'p1', {
      port: 'commercial', give: counts({ wood: 1, wool: 1 }), receive: counts({ ore: 1 }),
    }));

    // Deux cartes entrées pour une sortie : les compter aurait poussé deux
    // cours vers le haut pour un seul vers le bas, et fait dériver l'ensemble.
    expect(state.market.flow.wood).toBe(0);
    expect(state.market.flow.wool).toBe(0);
    expect(state.market.flow.ore).toBe(0);
  });
});

describe('semis des ports sur le plateau', () => {
  /** Combien de fois chaque type apparaît sur un plateau engendré. */
  function tally(board: { ports?: ReadonlyMap<VertexId, Port> }): Map<string, number> {
    const counts = new Map<string, number>();
    for (const [, port] of board.ports ?? []) {
      counts.set(port.kind, (counts.get(port.kind) ?? 0) + 1);
    }
    return counts;
  }

  it('ne pose jamais deux fois le même port particulier', () => {
    // Les grands plateaux portent plus de vingt ports : c'est là que le
    // repli cyclique en dupliquait.
    for (const scale of ['normal', 'grand', 'immense'] as const) {
      for (let seed = 0; seed < 12; seed++) {
        const board = archipelagoBoard(
          new SeededRandom(`semis-${scale}-${seed}`),
          archipelagoOptionsFor(12, scale),
        );
        const counts = tally(board);
        for (const kind of ['merchant', 'mining', 'commercial']) {
          expect(counts.get(kind) ?? 0).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('sème bien les trois particuliers sur un plateau de taille normale', () => {
    const board = archipelagoBoard(
      new SeededRandom('semis-complet'),
      archipelagoOptionsFor(12),
    );
    const counts = tally(board);
    expect(counts.get('merchant')).toBe(1);
    expect(counts.get('mining')).toBe(1);
    expect(counts.get('commercial')).toBe(1);
  });

  it('laisse la majorité des ports au commerce ordinaire', () => {
    const board = archipelagoBoard(new SeededRandom('semis-part'), archipelagoOptionsFor(12));
    const counts = tally(board);
    const particuliers = ['merchant', 'mining', 'commercial']
      .reduce((sum, k) => sum + (counts.get(k) ?? 0), 0);
    const total = [...counts.values()].reduce((a, b) => a + b, 0);
    expect(particuliers * 3).toBeLessThanOrEqual(total);
  });
});

/**
 * Le catalogue des types de ports.
 *
 * `PortKind` est un type : il ne se parcourt pas à l'exécution. Chaque
 * endroit qui doit traiter « tous les ports » — le semis, les panneaux du
 * plateau, ceux de l'écran de table — en tenait sa propre copie, et un type
 * ajouté sans mettre les autres à jour s'affichait sous son nom anglais.
 */
describe('catalogue des types de ports', () => {
  it('couvre tout ce que le semis peut poser', () => {
    const seen = new Set<string>();
    for (const scale of ['normal', 'grand', 'immense'] as const) {
      for (let seed = 0; seed < 12; seed++) {
        const board = archipelagoBoard(
          new SeededRandom(`catalogue-${scale}-${seed}`),
          archipelagoOptionsFor(12, scale),
        );
        for (const [, port] of board.ports ?? []) seen.add(port.kind);
      }
    }
    expect(seen.size).toBeGreaterThan(0);
    for (const kind of seen) expect(PORT_KINDS as readonly string[]).toContain(kind);
  });

  it('ne se répète pas', () => {
    expect(new Set(PORT_KINDS).size).toBe(PORT_KINDS.length);
  });
});
