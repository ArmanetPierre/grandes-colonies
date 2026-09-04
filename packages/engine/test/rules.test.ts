import { describe, expect, it } from 'vitest';

import { type Axial, cornerHexes, hexKey, hexesWithin } from '../src/board/axial.js';
import { Board, type HexData, type Token } from '../src/board/board.js';
import { type VertexId, adjacentVertices, edgeKey, vertexKey } from '../src/board/graph.js';
import { canPlaceRoad, canPlaceSettlement, canUpgradeToCity } from '../src/placement.js';
import {
  CLASSIC_PRODUCTION,
  GRAND_COLONIES_PRODUCTION,
  applyBankLimits,
  computeProduction,
} from '../src/production.js';
import { type ResourceCounts, COSTS, addCounts, amount, canAfford, counts, missingFor, subtractCounts, total } from '../src/resources.js';

const ORIGIN: Axial = { q: 0, r: 0 };

/** Petit plateau maîtrisé : une tuile centrale et sa couronne. */
function makeBoard(overrides: Record<string, HexData> = {}): Board {
  const positions = hexesWithin(ORIGIN, 1);
  const hexes = new Map<string, HexData>();
  for (const p of positions) {
    hexes.set(hexKey(p), overrides[hexKey(p)] ?? { terrain: 'forest', token: 5 });
  }
  return new Board({ positions, hexes });
}

const NORTH_OF_ORIGIN = (): VertexId => vertexKey(cornerHexes(ORIGIN, 0));

describe('inventaire', () => {
  it('additionne et retranche sans muter', () => {
    const a = counts({ wood: 2, brick: 1 });
    const b = counts({ wood: 1 });
    expect(addCounts(a, b)).toEqual({ wood: 3, brick: 1 });
    expect(subtractCounts(a, b)).toEqual({ wood: 1, brick: 1 });
    expect(a).toEqual({ wood: 2, brick: 1 });
  });

  it('refuse un retrait qui rendrait un compte négatif', () => {
    expect(() => subtractCounts(counts({ wood: 1 }), counts({ wood: 2 }))).toThrow();
  });

  it('compte les cartes en main, toutes ressources confondues', () => {
    expect(total(counts({ wood: 3, ore: 2, gold: 1 }))).toBe(6);
  });

  it('dit ce qui manque pour payer', () => {
    const have = counts({ wood: 1, brick: 1, wool: 1 });
    expect(canAfford(have, COSTS.settlement)).toBe(false);
    expect(missingFor(have, COSTS.settlement)).toEqual({ grain: 1 });
  });

  it('accepte un paiement exactement couvert', () => {
    expect(canAfford(counts({ ore: 3, grain: 2 }), COSTS.city)).toBe(true);
  });
});

describe('placement des colonies', () => {
  it('accepte un sommet libre pendant la mise en place', () => {
    const board = makeBoard();
    expect(canPlaceSettlement(board, NORTH_OF_ORIGIN(), 'p1', { setupPhase: true }).ok).toBe(true);
  });

  it('refuse un sommet déjà occupé', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    board.setBuilding(v, { kind: 'settlement', owner: 'p1' });
    const r = canPlaceSettlement(board, v, 'p2', { setupPhase: true });
    expect(r).toEqual({ ok: false, reason: 'occupied' });
  });

  it('applique la règle de distance, y compris entre joueurs différents', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    board.setBuilding(v, { kind: 'settlement', owner: 'p1' });

    for (const neighbour of adjacentVertices(v)) {
      if (!board.graph.hasVertex(neighbour)) continue;
      const r = canPlaceSettlement(board, neighbour, 'p2', { setupPhase: true });
      expect(r).toEqual({ ok: false, reason: 'too-close' });
    }
  });

  it('exige une route à soi hors mise en place', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    expect(canPlaceSettlement(board, v, 'p1')).toEqual({ ok: false, reason: 'not-connected' });

    const edge = board.graph.edgesOfVertexOnBoard(v)[0];
    expect(edge).toBeDefined();
    board.setRoad(edge as string, 'p1');
    expect(canPlaceSettlement(board, v, 'p1').ok).toBe(true);
  });

  it('ne compte pas la route d un adversaire comme une connexion', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    const edge = board.graph.edgesOfVertexOnBoard(v)[0];
    board.setRoad(edge as string, 'p2');
    expect(canPlaceSettlement(board, v, 'p1')).toEqual({ ok: false, reason: 'not-connected' });
  });

  it('refuse un sommet hors plateau', () => {
    const board = makeBoard();
    const far = vertexKey(cornerHexes({ q: 40, r: 40 }, 0));
    expect(canPlaceSettlement(board, far, 'p1', { setupPhase: true })).toEqual({
      ok: false, reason: 'off-board',
    });
  });

  it('refuse un sommet entouré uniquement de mer', () => {
    const sea: Record<string, HexData> = {};
    for (const p of hexesWithin(ORIGIN, 1)) sea[hexKey(p)] = { terrain: 'sea' };
    const board = new Board({
      positions: hexesWithin(ORIGIN, 1),
      hexes: new Map(Object.entries(sea)),
    });
    expect(canPlaceSettlement(board, NORTH_OF_ORIGIN(), 'p1', { setupPhase: true })).toEqual({
      ok: false, reason: 'unbuildable-land',
    });
  });

  it('autorise la construction sur un désert, qui ne produit pourtant rien', () => {
    const board = makeBoard({ [hexKey(ORIGIN)]: { terrain: 'desert' } });
    expect(canPlaceSettlement(board, NORTH_OF_ORIGIN(), 'p1', { setupPhase: true }).ok).toBe(true);
  });
});

describe('placement des routes', () => {
  it('accepte une arête partant d un bâtiment à soi', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    board.setBuilding(v, { kind: 'settlement', owner: 'p1' });
    const edge = board.graph.edgesOfVertexOnBoard(v)[0] as string;
    expect(canPlaceRoad(board, edge, 'p1').ok).toBe(true);
  });

  it('refuse une arête isolée', () => {
    const board = makeBoard();
    const edge = [...board.graph.edges][0] as string;
    expect(canPlaceRoad(board, edge, 'p1')).toEqual({ ok: false, reason: 'not-connected' });
  });

  it('prolonge un réseau existant', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    board.setBuilding(v, { kind: 'settlement', owner: 'p1' });
    const [first, second] = board.graph.edgesOfVertexOnBoard(v);
    board.setRoad(first as string, 'p1');
    expect(canPlaceRoad(board, second as string, 'p1').ok).toBe(true);
  });

  it('empêche de traverser une colonie adverse', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    const edges = board.graph.edgesOfVertexOnBoard(v);
    const [entering, leaving] = edges;

    board.setRoad(entering as string, 'p1');
    board.setBuilding(v, { kind: 'settlement', owner: 'p2' });

    // p1 arrive au sommet, mais p2 y est installé : le réseau s'arrête là.
    expect(canPlaceRoad(board, leaving as string, 'p1')).toEqual({
      ok: false, reason: 'not-connected',
    });
  });

  it('refuse une arête déjà occupée', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    board.setBuilding(v, { kind: 'settlement', owner: 'p1' });
    const edge = board.graph.edgesOfVertexOnBoard(v)[0] as string;
    board.setRoad(edge, 'p2');
    expect(canPlaceRoad(board, edge, 'p1')).toEqual({ ok: false, reason: 'occupied' });
  });
});

describe('amélioration en ville', () => {
  it('accepte sa propre colonie', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    board.setBuilding(v, { kind: 'settlement', owner: 'p1' });
    expect(canUpgradeToCity(board, v, 'p1').ok).toBe(true);
  });

  it('refuse la colonie d un autre', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    board.setBuilding(v, { kind: 'settlement', owner: 'p2' });
    expect(canUpgradeToCity(board, v, 'p1')).toEqual({ ok: false, reason: 'not-owner' });
  });

  it('refuse une ville déjà construite', () => {
    const board = makeBoard();
    const v = NORTH_OF_ORIGIN();
    board.setBuilding(v, { kind: 'city', owner: 'p1' });
    expect(canUpgradeToCity(board, v, 'p1')).toEqual({ ok: false, reason: 'not-a-settlement' });
  });
});

describe('production', () => {
  function boardWithSettlement(token: Token, terrain: HexData['terrain'] = 'forest') {
    const board = makeBoard({ [hexKey(ORIGIN)]: { terrain, token } });
    // On isole la tuile centrale : les voisines ne produiront pas.
    for (const p of hexesWithin(ORIGIN, 1)) {
      if (hexKey(p) !== hexKey(ORIGIN)) board.placeRobber(p);
    }
    board.setBuilding(NORTH_OF_ORIGIN(), { kind: 'settlement', owner: 'p1' });
    return board;
  }

  it('donne une ressource par colonie', () => {
    const board = boardWithSettlement(5);
    expect(computeProduction(board, 5).get('p1')).toEqual({ wood: 1 });
  });

  it('donne le double pour une ville', () => {
    const board = boardWithSettlement(5);
    board.setBuilding(NORTH_OF_ORIGIN(), { kind: 'city', owner: 'p1' });
    expect(computeProduction(board, 5).get('p1')).toEqual({ wood: 2 });
  });

  it('ne produit rien sur un lancer qui ne correspond pas', () => {
    const board = boardWithSettlement(5);
    expect(computeProduction(board, 6).size).toBe(0);
  });

  it('ne produit rien sur un 7', () => {
    const board = boardWithSettlement(7 as unknown as Token);
    expect(computeProduction(board, 7).size).toBe(0);
  });

  it('ne produit rien sous un voleur', () => {
    const board = boardWithSettlement(5);
    board.placeRobber(ORIGIN);
    expect(computeProduction(board, 5).size).toBe(0);
  });

  it('ne produit rien sur un désert', () => {
    const board = boardWithSettlement(5, 'desert');
    expect(computeProduction(board, 5).size).toBe(0);
  });

  // Règle propre à Grandes Colonies (§6) : les emplacements rares valent cher.
  it('double la production sur un 2 et un 12', () => {
    for (const roll of [2, 12] as const) {
      const board = boardWithSettlement(roll);
      expect(computeProduction(board, roll, GRAND_COLONIES_PRODUCTION).get('p1')).toEqual({ wood: 2 });
      expect(computeProduction(board, roll, CLASSIC_PRODUCTION).get('p1')).toEqual({ wood: 1 });
    }
  });

  it('ne double pas les autres valeurs', () => {
    const board = boardWithSettlement(6);
    expect(computeProduction(board, 6, GRAND_COLONIES_PRODUCTION).get('p1')).toEqual({ wood: 1 });
  });
});

describe('pénurie de banque', () => {
  const production = new Map<string, ResourceCounts>([
    ['p1', counts({ wood: 2 })],
    ['p2', counts({ wood: 2 })],
  ]);

  it('sert tout le monde quand le stock suffit', () => {
    const { granted, bank } = applyBankLimits(production, counts({ wood: 10 }));
    expect(granted.get('p1')).toEqual({ wood: 2 });
    expect(granted.get('p2')).toEqual({ wood: 2 });
    expect(amount(bank, 'wood')).toBe(6);
  });

  it('ne sert personne quand plusieurs joueurs se disputent un stock trop court', () => {
    const { granted, bank } = applyBankLimits(production, counts({ wood: 3 }));
    expect(granted.size).toBe(0);
    expect(amount(bank, 'wood')).toBe(3);
  });

  it('sert le reste au joueur unique quand il est seul demandeur', () => {
    const solo = new Map<string, ResourceCounts>([['p1', counts({ wood: 5 })]]);
    const { granted, bank } = applyBankLimits(solo, counts({ wood: 2 }));
    expect(granted.get('p1')).toEqual({ wood: 2 });
    expect(amount(bank, 'wood')).toBe(0);
  });

  it('ne bloque que la ressource en pénurie', () => {
    const mixed = new Map<string, ResourceCounts>([
      ['p1', counts({ wood: 2, ore: 1 })],
      ['p2', counts({ wood: 2 })],
    ]);
    const { granted } = applyBankLimits(mixed, counts({ wood: 1, ore: 5 }));
    expect(granted.get('p1')).toEqual({ ore: 1 });
    expect(granted.has('p2')).toBe(false);
  });
});
