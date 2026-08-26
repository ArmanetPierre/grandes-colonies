/**
 * Plus long réseau commercial.
 *
 * C'est le calcul le plus délicat du moteur, et celui où les implémentations
 * de Catan se trompent le plus souvent. Trois pièges le rendent retors :
 *
 *   — ce n'est pas la taille du réseau mais la longueur du plus long chemin
 *     qu'on y trouve : un joueur avec quinze routes en étoile peut avoir un
 *     réseau plus court qu'un joueur avec six routes en ligne ;
 *   — une colonie adverse coupe le réseau : on peut y arriver, jamais la
 *     traverser ;
 *   — les cycles sont légaux tant qu'aucune route ne resert deux fois.
 *
 * L'algorithme est un parcours en profondeur depuis chaque extrémité, sans
 * réemploi d'arête. Le graphe hexagonal borne le degré d'un sommet à trois,
 * ce qui garde le coût négligeable aux tailles réelles — 15 routes, la
 * dotation d'un joueur, se traitent en moins d'une milliseconde.
 *
 * L'explosion combinatoire est néanmoins réelle au-delà : un plateau dont
 * les 72 arêtes appartiendraient au même joueur demande une minute de
 * calcul (mesuré). Aucune partie légale n'y parvient, mais le panneau maître
 * de jeu permet de poser des constructions arbitrairement, et un serveur
 * figé une minute avec douze joueurs connectés serait inacceptable. Un
 * budget de recherche borne donc le pire cas ; l'atteindre signale un état
 * anormal et la longueur renvoyée devient une borne inférieure.
 */

import type { Board, PlayerId } from './board/board.js';
import { type EdgeId, type VertexId, verticesOfEdge } from './board/graph.js';

export interface LongestRouteOptions {
  /** Longueur minimale pour revendiquer le titre. Catan : 5. */
  readonly minimum?: number;
  /** Les routes maritimes comptent-elles dans le réseau ? */
  readonly includeMaritime?: boolean;
  /**
   * Nombre maximal d'arêtes parcourues avant d'abandonner la recherche.
   * Le défaut est plusieurs ordres de grandeur au-dessus de toute partie
   * légale : il ne protège que des états impossibles.
   */
  readonly maxSteps?: number;
}

const DEFAULTS = { minimum: 5, includeMaritime: true, maxSteps: 200_000 } as const;

interface Step {
  readonly edge: EdgeId;
  readonly to: VertexId;
}

type Adjacency = ReadonlyMap<VertexId, readonly Step[]>;

/** Le réseau d'un joueur, vu comme un graphe de sommets reliés par ses routes. */
function buildAdjacency(board: Board, player: PlayerId, includeMaritime: boolean): Adjacency {
  const adjacency = new Map<VertexId, Step[]>();

  for (const [edge, route] of board.allRoutes()) {
    if (route.owner !== player) continue;
    if (!includeMaritime && route.kind === 'maritime') continue;

    const [a, b] = verticesOfEdge(edge);
    if (a === undefined || b === undefined) continue;

    for (const [from, to] of [[a, b], [b, a]] as const) {
      const steps = adjacency.get(from) ?? [];
      steps.push({ edge, to });
      adjacency.set(from, steps);
    }
  }

  return adjacency;
}

/**
 * Les sommets qu'on ne peut pas traverser : ceux qu'occupe un adversaire.
 * On peut y aboutir — la route qui y mène compte — mais pas continuer
 * au-delà.
 */
function blockedVertices(board: Board, player: PlayerId): ReadonlySet<VertexId> {
  const blocked = new Set<VertexId>();
  for (const [vertex, building] of board.allBuildings()) {
    if (building.owner !== player) blocked.add(vertex);
  }
  return blocked;
}

/** Compteur mutable partagé par la descente récursive. */
interface Budget {
  steps: number;
  readonly limit: number;
}

function explore(
  from: VertexId,
  adjacency: Adjacency,
  blocked: ReadonlySet<VertexId>,
  used: Set<EdgeId>,
  depth: number,
  budget: Budget,
): number {
  let best = depth;

  for (const { edge, to } of adjacency.get(from) ?? []) {
    if (used.has(edge)) continue;
    if (budget.steps >= budget.limit) return best;
    budget.steps++;

    used.add(edge);
    const reached = depth + 1;
    // Arriver sur une colonie adverse est permis ; la dépasser ne l'est pas.
    best = Math.max(
      best,
      blocked.has(to) ? reached : explore(to, adjacency, blocked, used, reached, budget),
    );
    used.delete(edge);
  }

  return best;
}

export interface RouteSearch {
  readonly length: number;
  /** Vrai si le budget a été épuisé : `length` n'est alors qu'une borne inférieure. */
  readonly truncated: boolean;
}

/** Recherche complète, avec l'information de troncature. */
export function searchLongestRoute(
  board: Board,
  player: PlayerId,
  options: LongestRouteOptions = {},
): RouteSearch {
  const includeMaritime = options.includeMaritime ?? DEFAULTS.includeMaritime;
  const adjacency = buildAdjacency(board, player, includeMaritime);
  if (adjacency.size === 0) return { length: 0, truncated: false };

  const blocked = blockedVertices(board, player);
  const budget: Budget = { steps: 0, limit: options.maxSteps ?? DEFAULTS.maxSteps };

  let best = 0;
  for (const start of adjacency.keys()) {
    best = Math.max(best, explore(start, adjacency, blocked, new Set(), 0, budget));
  }

  return { length: best, truncated: budget.steps >= budget.limit };
}

/** Longueur du plus long chemin continu dans le réseau d'un joueur. */
export function longestRouteFor(
  board: Board,
  player: PlayerId,
  options: LongestRouteOptions = {},
): number {
  return searchLongestRoute(board, player, options).length;
}

export interface RouteHolder {
  readonly player: PlayerId;
  readonly length: number;
}

/**
 * Qui détient le titre, en tenant compte du détenteur actuel.
 *
 * Règle officielle conservée : à égalité, le titre ne change pas de mains.
 * Il faut faire *strictement* mieux que le détenteur pour le lui prendre —
 * sans quoi le titre s'échangerait à chaque tour entre deux joueurs à
 * égalité, et les points de victoire deviendraient instables.
 */
export function longestRouteHolder(
  board: Board,
  players: readonly PlayerId[],
  currentHolder?: PlayerId,
  options: LongestRouteOptions = {},
): RouteHolder | undefined {
  const minimum = options.minimum ?? DEFAULTS.minimum;

  const lengths = new Map<PlayerId, number>();
  for (const player of players) lengths.set(player, longestRouteFor(board, player, options));

  const heldLength = currentHolder !== undefined ? (lengths.get(currentHolder) ?? 0) : 0;

  // Le détenteur garde le titre tant qu'il reste au seuil et que personne
  // ne fait strictement mieux.
  let bestPlayer = currentHolder !== undefined && heldLength >= minimum ? currentHolder : undefined;
  let bestLength = bestPlayer !== undefined ? heldLength : minimum - 1;

  for (const player of players) {
    const length = lengths.get(player) ?? 0;
    if (length < minimum) continue;
    if (length > bestLength) {
      bestPlayer = player;
      bestLength = length;
    }
  }

  return bestPlayer === undefined ? undefined : { player: bestPlayer, length: bestLength };
}
