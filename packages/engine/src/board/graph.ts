/**
 * Le plateau comme graphe explicite : hexagones, sommets, arêtes.
 *
 * Choix structurant — un sommet et une arête ne possèdent pas de système de
 * coordonnées propre : ils sont identifiés par l'ENSEMBLE des hexagones
 * qu'ils touchent. Un sommet est le trio d'hexagones qui s'y rejoignent, une
 * arête la paire d'hexagones qu'elle sépare.
 *
 * L'intérêt est que l'identité devient canonique par construction. Le coin
 * nord de l'hexagone A et le coin sud-ouest de son voisin B sont le même
 * point, et produisent naturellement la même clé — sans table de
 * déduplication, sans arbitrage, sans risque de créer deux fois le même
 * emplacement de colonie.
 *
 * Les hexagones cités peuvent être hors plateau : le coin d'une tuile de bord
 * touche des positions qui n'existent pas. La clé reste valide et stable, ce
 * qui évite tout cas particulier sur le pourtour.
 */

import {
  type Axial,
  type Direction,
  cornerHexes,
  hexKey,
  neighbor,
  neighbors,
  parseHexKey,
} from './axial.js';

export type HexId = string;
export type VertexId = string;
export type EdgeId = string;

/** Clé canonique d'un sommet : les trois hexagones, triés. */
export function vertexKey(hexes: readonly [Axial, Axial, Axial]): VertexId {
  return hexes.map(hexKey).sort().join('|');
}

/** Clé canonique d'une arête : les deux hexagones, triés. */
export function edgeKey(a: Axial, b: Axial): EdgeId {
  return [hexKey(a), hexKey(b)].sort().join('|');
}

export function hexesOfVertex(id: VertexId): Axial[] {
  return id.split('|').map(parseHexKey);
}

export function hexesOfEdge(id: EdgeId): [Axial, Axial] {
  const [a, b] = id.split('|');
  if (a === undefined || b === undefined) throw new Error(`Clé d'arête invalide : ${id}`);
  return [parseHexKey(a), parseHexKey(b)];
}

/** Les six sommets d'un hexagone. */
export function vertexIdsOfHex(h: Axial): VertexId[] {
  return [0, 1, 2, 3, 4, 5].map((c) => vertexKey(cornerHexes(h, c as Direction)));
}

/** Les six arêtes d'un hexagone. */
export function edgeIdsOfHex(h: Axial): EdgeId[] {
  return neighbors(h).map((n) => edgeKey(h, n));
}

/**
 * Les deux hexagones qui touchent à la fois `a` et `b`.
 *
 * Pour deux hexagones voisins il y en a toujours exactement deux : ce sont
 * eux qui complètent les deux sommets situés aux extrémités de leur arête
 * commune.
 */
export function commonNeighbors(a: Axial, b: Axial): Axial[] {
  const inB = new Set(neighbors(b).map(hexKey));
  return neighbors(a).filter((n) => inB.has(hexKey(n)));
}

/** Les deux sommets aux extrémités d'une arête. */
export function verticesOfEdge(id: EdgeId): VertexId[] {
  const [a, b] = hexesOfEdge(id);
  return commonNeighbors(a, b).map((c) => vertexKey([a, b, c]));
}

/** Les trois arêtes qui partent d'un sommet. */
export function edgesOfVertex(id: VertexId): EdgeId[] {
  const [a, b, c] = hexesOfVertex(id);
  if (a === undefined || b === undefined || c === undefined) {
    throw new Error(`Clé de sommet invalide : ${id}`);
  }
  return [edgeKey(a, b), edgeKey(b, c), edgeKey(a, c)];
}

/**
 * Les trois sommets voisins d'un sommet.
 *
 * C'est la brique de la règle de distance entre colonies : deux colonies ne
 * peuvent jamais occuper deux sommets voisins.
 */
export function adjacentVertices(id: VertexId): VertexId[] {
  const hexes = hexesOfVertex(id);
  const [a, b, c] = hexes;
  if (a === undefined || b === undefined || c === undefined) {
    throw new Error(`Clé de sommet invalide : ${id}`);
  }

  const out: VertexId[] = [];
  for (const [p, q, third] of [
    [a, b, c],
    [b, c, a],
    [a, c, b],
  ] as const) {
    // Des deux hexagones qui complètent la paire, l'un est le troisième
    // sommet de départ : l'autre donne le sommet voisin.
    const other = commonNeighbors(p, q).find((n) => hexKey(n) !== hexKey(third));
    if (other) out.push(vertexKey([p, q, other]));
  }
  return out;
}

/** Les deux sommets d'une arête sont-ils bien ceux attendus ? Aide au test. */
export function edgeTouchesVertex(edge: EdgeId, vertex: VertexId): boolean {
  return verticesOfEdge(edge).includes(vertex);
}

/**
 * Un plateau : un ensemble d'hexagones, plus les sommets et arêtes qui en
 * découlent. Aucune donnée de jeu ici — seulement la topologie.
 */
export class BoardGraph {
  readonly hexes: ReadonlyMap<HexId, Axial>;
  readonly vertices: ReadonlySet<VertexId>;
  readonly edges: ReadonlySet<EdgeId>;

  constructor(hexes: readonly Axial[]) {
    const hexMap = new Map<HexId, Axial>();
    for (const h of hexes) hexMap.set(hexKey(h), h);

    const vertices = new Set<VertexId>();
    const edges = new Set<EdgeId>();
    for (const h of hexMap.values()) {
      for (const v of vertexIdsOfHex(h)) vertices.add(v);
      for (const e of edgeIdsOfHex(h)) edges.add(e);
    }

    this.hexes = hexMap;
    this.vertices = vertices;
    this.edges = edges;
  }

  has(h: Axial): boolean {
    return this.hexes.has(hexKey(h));
  }

  /** Les hexagones du plateau qui touchent ce sommet — un à trois. */
  boardHexesOfVertex(id: VertexId): Axial[] {
    return hexesOfVertex(id).filter((h) => this.has(h));
  }

  /** Un sommet appartient au plateau s'il touche au moins un hexagone. */
  hasVertex(id: VertexId): boolean {
    return this.vertices.has(id);
  }

  hasEdge(id: EdgeId): boolean {
    return this.edges.has(id);
  }

  /** Voisins d'un sommet restreints au plateau. */
  adjacentVerticesOnBoard(id: VertexId): VertexId[] {
    return adjacentVertices(id).filter((v) => this.vertices.has(v));
  }

  /** Arêtes partant d'un sommet, restreintes au plateau. */
  edgesOfVertexOnBoard(id: VertexId): EdgeId[] {
    return edgesOfVertex(id).filter((e) => this.edges.has(e));
  }

  /** Sommets d'une arête, restreints au plateau. */
  verticesOfEdgeOnBoard(id: EdgeId): VertexId[] {
    return verticesOfEdge(id).filter((v) => this.vertices.has(v));
  }

  /** Le voisin d'un hexagone dans une direction, s'il est sur le plateau. */
  neighborOnBoard(h: Axial, direction: Direction): Axial | undefined {
    const n = neighbor(h, direction);
    return this.has(n) ? n : undefined;
  }
}
