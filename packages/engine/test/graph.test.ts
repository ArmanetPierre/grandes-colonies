import { describe, expect, it } from 'vitest';

import {
  type Axial,
  cornerHexes,
  distance,
  hexKey,
  hexesWithin,
  neighbors,
} from '../src/board/axial.js';
import {
  BoardGraph,
  adjacentVertices,
  commonNeighbors,
  edgeIdsOfHex,
  edgeKey,
  edgesOfVertex,
  verticesOfEdge,
  vertexIdsOfHex,
  vertexKey,
} from '../src/board/graph.js';

const ORIGIN: Axial = { q: 0, r: 0 };

/** Plateau hexagonal de rayon 2 : les 19 tuiles du Catan classique. */
const classicHexes = hexesWithin(ORIGIN, 2);

describe('coordonnées axiales', () => {
  it('donne six voisins distincts, tous à distance 1', () => {
    const ns = neighbors(ORIGIN);
    expect(ns).toHaveLength(6);
    expect(new Set(ns.map(hexKey)).size).toBe(6);
    for (const n of ns) expect(distance(ORIGIN, n)).toBe(1);
  });

  it('compte 19 hexagones dans un rayon de 2', () => {
    expect(classicHexes).toHaveLength(19);
  });

  it('encadre chaque coin par deux directions consécutives', () => {
    // Le coin 0 (nord) est partagé avec les voisins NO et NE.
    const [self, a, b] = cornerHexes(ORIGIN, 0);
    expect(self).toEqual(ORIGIN);
    expect(a).toEqual({ q: 0, r: -1 });
    expect(b).toEqual({ q: 1, r: -1 });
  });
});

describe('identité canonique des sommets', () => {
  it('donne la même clé au même point vu depuis deux hexagones différents', () => {
    // Le coin nord de l'origine est aussi un coin de son voisin nord-ouest.
    const fromOrigin = vertexKey(cornerHexes(ORIGIN, 0));
    const nw: Axial = { q: 0, r: -1 };

    const cornersOfNw = [0, 1, 2, 3, 4, 5].map((c) => vertexKey(cornerHexes(nw, c as never)));
    expect(cornersOfNw).toContain(fromOrigin);
  });

  it('ne dépend pas de l ordre des hexagones fournis', () => {
    const a: Axial = { q: 0, r: 0 };
    const b: Axial = { q: 1, r: 0 };
    const c: Axial = { q: 0, r: 1 };
    expect(vertexKey([a, b, c])).toBe(vertexKey([c, a, b]));
    expect(vertexKey([a, b, c])).toBe(vertexKey([b, c, a]));
  });

  it('ne dépend pas de l ordre pour les arêtes non plus', () => {
    const a: Axial = { q: 0, r: 0 };
    const b: Axial = { q: 1, r: 0 };
    expect(edgeKey(a, b)).toBe(edgeKey(b, a));
  });
});

describe('topologie locale', () => {
  it('donne six sommets et six arêtes distincts par hexagone', () => {
    expect(new Set(vertexIdsOfHex(ORIGIN)).size).toBe(6);
    expect(new Set(edgeIdsOfHex(ORIGIN)).size).toBe(6);
  });

  it('fait partager exactement deux sommets et une arête à deux hexagones voisins', () => {
    const a = ORIGIN;
    const b = { q: 1, r: 0 };

    const va = new Set(vertexIdsOfHex(a));
    const shared = vertexIdsOfHex(b).filter((v) => va.has(v));
    expect(shared).toHaveLength(2);

    const ea = new Set(edgeIdsOfHex(a));
    expect(edgeIdsOfHex(b).filter((e) => ea.has(e))).toHaveLength(1);
  });

  it('donne exactement deux hexagones communs à deux voisins', () => {
    expect(commonNeighbors(ORIGIN, { q: 1, r: 0 })).toHaveLength(2);
  });

  it('relie chaque sommet à trois arêtes et trois sommets', () => {
    const v = vertexKey(cornerHexes(ORIGIN, 0));
    expect(new Set(edgesOfVertex(v)).size).toBe(3);
    expect(new Set(adjacentVertices(v)).size).toBe(3);
  });

  it('donne deux extrémités à chaque arête', () => {
    for (const e of edgeIdsOfHex(ORIGIN)) {
      expect(new Set(verticesOfEdge(e)).size).toBe(2);
    }
  });

  it('rend la relation sommet-arête symétrique', () => {
    const v = vertexKey(cornerHexes(ORIGIN, 0));
    for (const e of edgesOfVertex(v)) {
      expect(verticesOfEdge(e)).toContain(v);
    }
  });

  it('rend l adjacence entre sommets symétrique', () => {
    const v = vertexKey(cornerHexes(ORIGIN, 2));
    for (const other of adjacentVertices(v)) {
      expect(adjacentVertices(other)).toContain(v);
    }
  });

  it('relie deux sommets adjacents par une arête commune', () => {
    const v = vertexKey(cornerHexes(ORIGIN, 0));
    for (const other of adjacentVertices(v)) {
      const shared = edgesOfVertex(v).filter((e) => edgesOfVertex(other).includes(e));
      expect(shared).toHaveLength(1);
    }
  });
});

describe('plateau du Catan classique', () => {
  const board = new BoardGraph(classicHexes);

  // Le contrôle décisif : ces deux nombres sont ceux du jeu physique.
  // Les retrouver par simple dérivation valide toute la construction.
  it('produit 54 emplacements de colonie', () => {
    expect(board.vertices.size).toBe(54);
  });

  it('produit 72 emplacements de route', () => {
    expect(board.edges.size).toBe(72);
  });

  it('contient les 19 tuiles', () => {
    expect(board.hexes.size).toBe(19);
  });

  it('ne référence que des sommets réellement sur le plateau', () => {
    for (const v of board.vertices) {
      expect(board.boardHexesOfVertex(v).length).toBeGreaterThan(0);
    }
  });

  it('donne trois hexagones aux sommets intérieurs, moins sur le pourtour', () => {
    const counts = [...board.vertices].map((v) => board.boardHexesOfVertex(v).length);
    expect(Math.max(...counts)).toBe(3);
    expect(Math.min(...counts)).toBe(1);
  });

  it('borne à trois les voisins d un sommet, y compris sur le pourtour', () => {
    for (const v of board.vertices) {
      expect(board.adjacentVerticesOnBoard(v).length).toBeLessThanOrEqual(3);
    }
  });

  it('rattache chaque arête du plateau à deux sommets du plateau', () => {
    for (const e of board.edges) {
      expect(board.verticesOfEdgeOnBoard(e)).toHaveLength(2);
    }
  });

  it('garde la relation sommet-arête cohérente sur tout le plateau', () => {
    for (const v of board.vertices) {
      for (const e of board.edgesOfVertexOnBoard(v)) {
        expect(board.verticesOfEdgeOnBoard(e)).toContain(v);
      }
    }
  });
});

describe('plateau XXL de Grand Colonies', () => {
  // Le game design prévoit 44 à 52 hexagones ; un rayon de 4 en donne 61,
  // de quoi tailler un archipel dedans.
  const big = new BoardGraph(hexesWithin(ORIGIN, 4));

  it('monte en taille sans perdre ses invariants', () => {
    expect(big.hexes.size).toBe(61);
    // Formule d un plateau hexagonal de rayon N : 6(N+1)^2 sommets.
    expect(big.vertices.size).toBe(6 * 25);
    for (const e of big.edges) {
      expect(big.verticesOfEdgeOnBoard(e)).toHaveLength(2);
    }
  });

  it('accepte un plateau non convexe, comme un archipel', () => {
    // Deux îles disjointes : la topologie doit rester saine.
    const island = [...hexesWithin({ q: 0, r: 0 }, 1), ...hexesWithin({ q: 10, r: 0 }, 1)];
    const archipelago = new BoardGraph(island);
    expect(archipelago.hexes.size).toBe(14);
    for (const v of archipelago.vertices) {
      expect(archipelago.boardHexesOfVertex(v).length).toBeGreaterThan(0);
    }
  });
});
