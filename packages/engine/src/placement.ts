/**
 * Règles de placement des constructions.
 *
 * Chaque refus est motivé plutôt que booléen : le brief d'interface impose
 * qu'une action indisponible dise pourquoi elle l'est (SPEC_ECRANS §5.6).
 * C'est ce qui permet d'apprendre les règles sans explication permanente,
 * et c'est un critère de sortie du projet — la raison doit donc remonter du
 * moteur, pas être devinée par le client.
 */

import type { Board, PlayerId } from './board/board.js';
import { mainIsland } from './board/islands.js';
import {
  type EdgeId,
  type VertexId,
  adjacentVertices,
  edgesOfVertex,
  hexesOfEdge,
  verticesOfEdge,
} from './board/graph.js';
import { isProductive } from './resources.js';
import type { Terrain } from './resources.js';

export type PlacementError =
  | 'off-board'          // l'emplacement n'existe pas sur ce plateau
  | 'occupied'           // déjà pris
  | 'too-close'          // un sommet voisin porte déjà une construction
  | 'not-connected'      // aucune route ni bâtiment à soi n'y touche
  | 'not-owner'          // la construction appartient à un autre joueur
  | 'not-a-settlement'   // on ne peut améliorer qu'une colonie
  | 'not-a-city'         // la métropole et le monument exigent une cité
  | 'unbuildable-land'   // que de la mer ou de l'inexploré autour
  | 'needs-water'        // une route maritime doit longer la mer
  | 'off-main-island';   // la mise en place se fait sur l'île centrale

export type Placement = { readonly ok: true } | { readonly ok: false; readonly reason: PlacementError };

const OK: Placement = Object.freeze({ ok: true });
const fail = (reason: PlacementError): Placement => Object.freeze({ ok: false, reason });

export interface PlacementOptions {
  /**
   * Pendant la mise en place initiale, les colonies se posent sans être
   * reliées à une route — c'est la seule exception à la connexité.
   */
  readonly setupPhase?: boolean;
}

/**
 * Un sommet est constructible s'il touche au moins un terrain ferme. Les
 * sommets entourés uniquement de mer ou de brouillard n'accueillent rien.
 */
function touchesBuildableLand(board: Board, vertex: VertexId): boolean {
  for (const hex of board.graph.boardHexesOfVertex(vertex)) {
    const terrain: Terrain | undefined = board.terrainAt(hex);
    if (terrain === undefined) continue;
    if (terrain === 'sea' || terrain === 'unexplored') continue;
    // Le désert ne produit rien mais reste constructible.
    if (terrain === 'desert' || isProductive(terrain)) return true;
  }
  return false;
}

/** L'arête longe-t-elle de la terre constructible ? */
function edgeTouchesLand(board: Board, edge: EdgeId): boolean {
  for (const hex of hexesOfEdge(edge)) {
    const terrain = board.terrainAt(hex);
    if (terrain === undefined || terrain === 'sea' || terrain === 'unexplored') continue;
    return true;
  }
  return false;
}

/** L'arête longe-t-elle la mer ? */
function edgeTouchesWater(board: Board, edge: EdgeId): boolean {
  for (const hex of hexesOfEdge(edge)) {
    // Hors plateau compte comme large : le pourtour est de l'eau.
    if (!board.graph.has(hex)) return true;
    if (board.terrainAt(hex) === 'sea') return true;
  }
  return false;
}

/**
 * Le réseau du joueur atteint-il cette arête ?
 *
 * Commun aux deux sortes de routes : terrestres et maritimes forment un seul
 * réseau commercial (§12), on passe donc de l'une à l'autre sans rupture.
 */
function connectsToNetwork(board: Board, edge: EdgeId, player: PlayerId): boolean {
  for (const vertex of verticesOfEdge(edge)) {
    const building = board.buildingAt(vertex);
    if (building?.owner === player) return true;

    // Un bâtiment adverse coupe le réseau : on ne traverse pas chez l'autre.
    if (building && building.owner !== player) continue;

    for (const other of edgesOfVertex(vertex)) {
      if (other !== edge && board.roadAt(other) === player) return true;
    }
  }
  return false;
}

/** Le sommet touche-t-il l'île centrale ? */
function touchesMainIsland(board: Board, vertex: VertexId): boolean {
  const main = mainIsland(board);
  if (!main) return true;
  const hexes = new Set(main.hexes);
  return vertex.split('|').some((hex) => hexes.has(hex));
}

/** Le joueur possède-t-il une route touchant ce sommet ? */
function hasOwnRoadAtVertex(board: Board, vertex: VertexId, player: PlayerId): boolean {
  return board.graph
    .edgesOfVertexOnBoard(vertex)
    .some((edge) => board.roadAt(edge) === player);
}

export function canPlaceSettlement(
  board: Board,
  vertex: VertexId,
  player: PlayerId,
  options: PlacementOptions = {},
): Placement {
  if (!board.graph.hasVertex(vertex)) return fail('off-board');
  if (board.buildingAt(vertex)) return fail('occupied');
  if (!touchesBuildableLand(board, vertex)) return fail('unbuildable-land');

  // La mise en place reste sur l'île centrale (contrat §9). Commencer sur une
  // île secondaire donnerait un point d'exploration gratuit et priverait la
  // partie de la course qui en fait l'intérêt.
  if (options.setupPhase && !touchesMainIsland(board, vertex)) return fail('off-main-island');

  // Règle de distance : jamais deux constructions sur des sommets voisins,
  // quel que soit leur propriétaire.
  for (const neighbour of adjacentVertices(vertex)) {
    if (board.buildingAt(neighbour)) return fail('too-close');
  }

  if (!options.setupPhase && !hasOwnRoadAtVertex(board, vertex, player)) {
    return fail('not-connected');
  }

  return OK;
}

export function canPlaceRoad(board: Board, edge: EdgeId, player: PlayerId): Placement {
  if (!board.graph.hasEdge(edge)) return fail('off-board');
  if (board.roadAt(edge)) return fail('occupied');

  // Une route terrestre longe forcément de la terre. Rien ne le vérifiait :
  // on pouvait tracer une route sur la mer ouverte, du moment qu'elle
  // touchait son propre réseau.
  if (!edgeTouchesLand(board, edge)) return fail('unbuildable-land');

  // Une route doit partir de quelque chose à soi : un bâtiment ou une autre
  // route, à l'une ou l'autre extrémité.
  return connectsToNetwork(board, edge, player) ? OK : fail('not-connected');
}

/**
 * Une route maritime peut-elle être posée ici ?
 *
 * Elle longe la mer là où la route terrestre longe la terre. Une arête
 * côtière — une face de mer, une face de terre — accepte les deux : c'est
 * elle qui fait le lien entre les deux réseaux.
 */
export function canPlaceMaritimeRoute(board: Board, edge: EdgeId, player: PlayerId): Placement {
  if (!board.graph.hasEdge(edge)) return fail('off-board');
  if (board.roadAt(edge)) return fail('occupied');
  if (!edgeTouchesWater(board, edge)) return fail('needs-water');

  return connectsToNetwork(board, edge, player) ? OK : fail('not-connected');
}

/** Toutes les arêtes où ce joueur pourrait poser une route maritime. */
export function maritimeSpots(board: Board, player: PlayerId): EdgeId[] {
  return [...board.graph.edges].filter((e) => canPlaceMaritimeRoute(board, e, player).ok);
}

export function canUpgradeToCity(board: Board, vertex: VertexId, player: PlayerId): Placement {
  if (!board.graph.hasVertex(vertex)) return fail('off-board');

  const building = board.buildingAt(vertex);
  if (!building) return fail('not-a-settlement');
  if (building.owner !== player) return fail('not-owner');
  if (building.kind !== 'settlement') return fail('not-a-settlement');

  return OK;
}

/**
 * Une cité peut-elle devenir métropole ?
 *
 * La rareté — trois pour toute la partie — n'est pas vérifiée ici : elle
 * relève de l'état de la partie, pas du plateau. Le moteur s'en charge.
 */
export function canUpgradeToMetropolis(board: Board, vertex: VertexId, player: PlayerId): Placement {
  if (!board.graph.hasVertex(vertex)) return fail('off-board');

  const building = board.buildingAt(vertex);
  if (!building) return fail('not-a-city');
  if (building.owner !== player) return fail('not-owner');
  if (building.kind !== 'city') return fail('not-a-city');

  return OK;
}

/**
 * Un monument peut-il s'élever ici ?
 *
 * Il demande une cité ou une métropole : le monument couronne un
 * investissement, il ne se pose pas sur un terrain nu.
 */
export function canRaiseMonument(board: Board, vertex: VertexId, player: PlayerId): Placement {
  if (!board.graph.hasVertex(vertex)) return fail('off-board');

  const building = board.buildingAt(vertex);
  if (!building) return fail('not-a-city');
  if (building.owner !== player) return fail('not-owner');
  if (building.kind === 'settlement') return fail('not-a-city');

  return OK;
}

/** Tous les sommets où ce joueur pourrait poser une colonie. */
export function settlementSpots(
  board: Board,
  player: PlayerId,
  options: PlacementOptions = {},
): VertexId[] {
  return [...board.graph.vertices].filter(
    (v) => canPlaceSettlement(board, v, player, options).ok,
  );
}

/** Toutes les arêtes où ce joueur pourrait poser une route. */
export function roadSpots(board: Board, player: PlayerId): EdgeId[] {
  return [...board.graph.edges].filter((e) => canPlaceRoad(board, e, player).ok);
}
