/**
 * Le plateau de jeu : la topologie du graphe, plus ce qui la peuple —
 * terrains, jetons de production, voleurs, constructions.
 */

import { type Axial, hexKey } from './axial.js';
import {
  BoardGraph,
  type EdgeId,
  type HexId,
  type VertexId,
  vertexIdsOfHex,
} from './graph.js';
import { type Terrain, isProductive } from '../resources.js';

export type PlayerId = string;

/** Les valeurs de jeton possibles. Le 7 n'en est pas un : il appelle le voleur. */
export type Token = 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 11 | 12;

export interface HexData {
  readonly terrain: Terrain;
  /** Absent sur les terrains stériles : désert, mer, tuile inexplorée. */
  readonly token?: Token;
}

export type BuildingKind = 'settlement' | 'city';

export interface Building {
  readonly kind: BuildingKind;
  readonly owner: PlayerId;
}

export interface BoardInit {
  readonly hexes: ReadonlyMap<HexId, HexData>;
  readonly positions: readonly Axial[];
}

/**
 * Nombre de ressources produites par une construction. Une ville rapporte
 * le double d'une colonie.
 */
const YIELD_PER_BUILDING: Readonly<Record<BuildingKind, number>> = {
  settlement: 1,
  city: 2,
};

export function buildingYield(kind: BuildingKind): number {
  return YIELD_PER_BUILDING[kind];
}

export class Board {
  readonly graph: BoardGraph;
  private readonly data: Map<HexId, HexData>;
  private readonly robbers: Set<HexId>;
  private readonly buildings: Map<VertexId, Building>;
  private readonly roads: Map<EdgeId, PlayerId>;

  constructor(init: BoardInit) {
    this.graph = new BoardGraph(init.positions);
    this.data = new Map(init.hexes);
    this.robbers = new Set();
    this.buildings = new Map();
    this.roads = new Map();
  }

  // ── terrain ──────────────────────────────────────────────────────────

  hexData(h: Axial | HexId): HexData | undefined {
    return this.data.get(typeof h === 'string' ? h : hexKey(h));
  }

  terrainAt(h: Axial | HexId): Terrain | undefined {
    return this.hexData(h)?.terrain;
  }

  /** Tous les hexagones du plateau avec leur terrain et leur jeton. */
  allHexData(): ReadonlyMap<HexId, HexData> {
    return this.data;
  }

  /** Les hexagones portant ce jeton, quel que soit leur terrain. */
  hexesWithToken(token: Token): HexId[] {
    const out: HexId[] = [];
    for (const [id, d] of this.data) if (d.token === token) out.push(id);
    return out;
  }

  // ── voleurs ──────────────────────────────────────────────────────────
  // Grand Colonies en autorise deux à 11–12 joueurs (§25), pour éviter
  // qu'un seul hexagone puisse bloquer toute une région.

  placeRobber(h: Axial | HexId): void {
    this.robbers.add(typeof h === 'string' ? h : hexKey(h));
  }

  removeRobber(h: Axial | HexId): void {
    this.robbers.delete(typeof h === 'string' ? h : hexKey(h));
  }

  isBlocked(h: Axial | HexId): boolean {
    return this.robbers.has(typeof h === 'string' ? h : hexKey(h));
  }

  robberPositions(): HexId[] {
    return [...this.robbers];
  }

  // ── constructions ────────────────────────────────────────────────────

  buildingAt(v: VertexId): Building | undefined {
    return this.buildings.get(v);
  }

  setBuilding(v: VertexId, building: Building): void {
    this.buildings.set(v, building);
  }

  roadAt(e: EdgeId): PlayerId | undefined {
    return this.roads.get(e);
  }

  setRoad(e: EdgeId, owner: PlayerId): void {
    this.roads.set(e, owner);
  }

  allBuildings(): ReadonlyMap<VertexId, Building> {
    return this.buildings;
  }

  allRoads(): ReadonlyMap<EdgeId, PlayerId> {
    return this.roads;
  }

  /** Les constructions posées sur les sommets d'un hexagone. */
  buildingsAroundHex(h: Axial): { vertex: VertexId; building: Building }[] {
    const out: { vertex: VertexId; building: Building }[] = [];
    for (const v of vertexIdsOfHex(h)) {
      const b = this.buildings.get(v);
      if (b) out.push({ vertex: v, building: b });
    }
    return out;
  }

  /** Un hexagone produit-il sur ce lancer ? */
  producesOn(h: Axial | HexId, roll: number): boolean {
    const d = this.hexData(h);
    if (!d || d.token !== roll) return false;
    if (!isProductive(d.terrain)) return false;
    return !this.isBlocked(h);
  }
}
