import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import { Board, type HexData } from '../src/board/board.js';
import { type EdgeId, type VertexId, edgeIdsOfHex, edgesOfVertex } from '../src/board/graph.js';
import { longestRouteFor, longestRouteHolder } from '../src/longestRoute.js';

const ORIGIN: Axial = { q: 0, r: 0 };

function makeBoard(radius = 3): Board {
  const positions = hexesWithin(ORIGIN, radius);
  const hexes = new Map<string, HexData>();
  for (const p of positions) hexes.set(hexKey(p), { terrain: 'forest', token: 5 });
  return new Board({ positions, hexes });
}

/** L'arête qui relie deux sommets voisins. */
function edgeBetween(a: VertexId, b: VertexId): EdgeId {
  const shared = edgesOfVertex(a).find((e) => edgesOfVertex(b).includes(e));
  if (!shared) throw new Error('Sommets non voisins');
  return shared;
}

/**
 * Pose un chemin simple de `length` routes depuis `start`, sans repasser par
 * un sommet déjà visité. Renvoie les sommets traversés, dans l'ordre.
 */
function layPath(
  board: Board,
  player: string,
  start: VertexId,
  length: number,
  kind: 'land' | 'maritime' = 'land',
): VertexId[] {
  const path: VertexId[] = [start];
  const visited = new Set<VertexId>([start]);
  let current = start;

  for (let i = 0; i < length; i++) {
    const next = board.graph
      .adjacentVerticesOnBoard(current)
      .find((v) => !visited.has(v) && board.roadAt(edgeBetween(current, v)) === undefined);
    if (next === undefined) break;

    board.setRoad(edgeBetween(current, next), player, kind);
    visited.add(next);
    path.push(next);
    current = next;
  }

  return path;
}

const someVertex = (board: Board): VertexId => [...board.graph.vertices].sort()[0] as VertexId;

describe('longueur du réseau', () => {
  it('vaut zéro sans aucune route', () => {
    expect(longestRouteFor(makeBoard(), 'p1')).toBe(0);
  });

  it('vaut un pour une route isolée', () => {
    const board = makeBoard();
    const edge = [...board.graph.edges].sort()[0] as EdgeId;
    board.setRoad(edge, 'p1');
    expect(longestRouteFor(board, 'p1')).toBe(1);
  });

  it('suit une ligne droite sur toute sa longueur', () => {
    const board = makeBoard();
    const path = layPath(board, 'p1', someVertex(board), 6);
    expect(path).toHaveLength(7);
    expect(longestRouteFor(board, 'p1')).toBe(6);
  });

  it('ignore les routes des autres joueurs', () => {
    const board = makeBoard();
    layPath(board, 'p1', someVertex(board), 5);
    expect(longestRouteFor(board, 'p2')).toBe(0);
  });

  // Le piège classique : compter le réseau plutôt que le chemin.
  it('ne compte pas les embranchements, seulement le plus long chemin', () => {
    const board = makeBoard();
    const trunk = layPath(board, 'p1', someVertex(board), 4);

    // Greffe une branche au milieu du tronc.
    const middle = trunk[2] as VertexId;
    const free = board.graph
      .adjacentVerticesOnBoard(middle)
      .filter((v) => board.roadAt(edgeBetween(middle, v)) === undefined);
    expect(free.length).toBeGreaterThan(0);
    board.setRoad(edgeBetween(middle, free[0] as VertexId), 'p1');

    // Cinq routes posées, mais le plus long chemin en traverse quatre.
    expect(board.allRoutes().size).toBe(5);
    expect(longestRouteFor(board, 'p1')).toBe(4);
  });

  it('accepte un cycle et le parcourt entièrement', () => {
    const board = makeBoard();
    for (const edge of edgeIdsOfHex(ORIGIN)) board.setRoad(edge, 'p1');
    // Les six côtés d'un hexagone forment une boucle fermée.
    expect(longestRouteFor(board, 'p1')).toBe(6);
  });

  it('prolonge un cycle par sa queue', () => {
    const board = makeBoard();
    for (const edge of edgeIdsOfHex(ORIGIN)) board.setRoad(edge, 'p1');

    // Accroche une antenne à un sommet de la boucle.
    const onLoop = [...board.graph.vertices]
      .filter((v) => board.graph.edgesOfVertexOnBoard(v).some((e) => board.roadAt(e) === 'p1'))
      .sort()[0] as VertexId;
    const outside = board.graph
      .adjacentVerticesOnBoard(onLoop)
      .find((v) => board.roadAt(edgeBetween(onLoop, v)) === undefined);
    board.setRoad(edgeBetween(onLoop, outside as VertexId), 'p1');

    expect(longestRouteFor(board, 'p1')).toBe(7);
  });

  it('ne cumule pas deux réseaux séparés', () => {
    const board = makeBoard(4);
    layPath(board, 'p1', someVertex(board), 3);

    // Un second réseau, à l'autre bout du plateau.
    const far = [...board.graph.vertices]
      .filter((v) => board.graph.edgesOfVertexOnBoard(v).every((e) => board.roadAt(e) === undefined))
      .sort()
      .reverse()[0] as VertexId;
    layPath(board, 'p1', far, 4);

    expect(longestRouteFor(board, 'p1')).toBe(4);
  });
});

describe('coupure par une colonie adverse', () => {
  it('scinde un chemin en deux', () => {
    const board = makeBoard();
    const path = layPath(board, 'p1', someVertex(board), 6);
    expect(longestRouteFor(board, 'p1')).toBe(6);

    board.setBuilding(path[3] as VertexId, { kind: 'settlement', owner: 'p2' });
    expect(longestRouteFor(board, 'p1')).toBe(3);
  });

  it('compte la route qui mène à la colonie adverse', () => {
    const board = makeBoard();
    const path = layPath(board, 'p1', someVertex(board), 4);
    // Bloquer l'avant-dernier sommet laisse trois routes d'un côté.
    board.setBuilding(path[3] as VertexId, { kind: 'settlement', owner: 'p2' });
    expect(longestRouteFor(board, 'p1')).toBe(3);
  });

  it('ne coupe pas sur ses propres constructions', () => {
    const board = makeBoard();
    const path = layPath(board, 'p1', someVertex(board), 6);
    board.setBuilding(path[3] as VertexId, { kind: 'city', owner: 'p1' });
    expect(longestRouteFor(board, 'p1')).toBe(6);
  });

  it('coupe aussi sur une ville adverse', () => {
    const board = makeBoard();
    const path = layPath(board, 'p1', someVertex(board), 6);
    board.setBuilding(path[2] as VertexId, { kind: 'city', owner: 'p2' });
    expect(longestRouteFor(board, 'p1')).toBe(4);
  });
});

describe('routes maritimes', () => {
  it('les compte dans le réseau par défaut', () => {
    const board = makeBoard();
    const path = layPath(board, 'p1', someVertex(board), 3);
    layPath(board, 'p1', path[3] as VertexId, 2, 'maritime');
    expect(longestRouteFor(board, 'p1')).toBe(5);
  });

  it('peut les exclure sur demande', () => {
    const board = makeBoard();
    const path = layPath(board, 'p1', someVertex(board), 3);
    layPath(board, 'p1', path[3] as VertexId, 2, 'maritime');
    expect(longestRouteFor(board, 'p1', { includeMaritime: false })).toBe(3);
  });
});

describe('attribution du titre', () => {
  function boardWith(lengths: Record<string, number>): Board {
    const board = makeBoard(4);
    const starts = [...board.graph.vertices].sort();
    let cursor = 0;
    for (const [player, length] of Object.entries(lengths)) {
      // Espacer les réseaux pour qu'ils ne se rejoignent pas.
      const start = starts[cursor] as VertexId;
      cursor += 40;
      layPath(board, player, start, length);
    }
    return board;
  }

  it('n attribue rien sous le seuil de cinq', () => {
    const board = boardWith({ p1: 4 });
    expect(longestRouteHolder(board, ['p1'])).toBeUndefined();
  });

  it('attribue le titre au seuil atteint', () => {
    const board = boardWith({ p1: 5 });
    expect(longestRouteHolder(board, ['p1'])).toEqual({ player: 'p1', length: 5 });
  });

  it('laisse le titre au détenteur en cas d égalité', () => {
    const board = boardWith({ p1: 5, p2: 5 });
    expect(longestRouteHolder(board, ['p1', 'p2'], 'p1')?.player).toBe('p1');
    expect(longestRouteHolder(board, ['p1', 'p2'], 'p2')?.player).toBe('p2');
  });

  it('transfère le titre à qui fait strictement mieux', () => {
    const board = boardWith({ p1: 5, p2: 6 });
    expect(longestRouteHolder(board, ['p1', 'p2'], 'p1')).toEqual({ player: 'p2', length: 6 });
  });

  it('retire le titre au détenteur retombé sous le seuil', () => {
    const board = boardWith({ p1: 3 });
    expect(longestRouteHolder(board, ['p1'], 'p1')).toBeUndefined();
  });

  it('respecte un seuil configuré autrement', () => {
    const board = boardWith({ p1: 3 });
    expect(longestRouteHolder(board, ['p1'], undefined, { minimum: 3 })).toEqual({
      player: 'p1', length: 3,
    });
  });
});
