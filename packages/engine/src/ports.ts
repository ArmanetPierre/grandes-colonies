/**
 * Ports et taux d'échange avec la banque (§11).
 *
 * La simulation a montré que l'accès au commerce conditionne l'expansion
 * bien plus à douze joueurs qu'à quatre : une main de dix cartes réparties
 * sur cinq types ne contient presque jamais les trois minerais d'une ville.
 * Les ports pèsent donc ici nettement plus lourd que dans un Catan classique.
 */

import type { Board, PlayerId } from './board/board.js';
import type { VertexId } from './board/graph.js';
import type { Resource } from './resources.js';

export type PortKind =
  | 'generic'   // 3:1 sur n'importe quelle ressource
  | 'wood' | 'brick' | 'wool' | 'grain' | 'ore'   // 2:1 sur une ressource
  | 'merchant'; // port marchand : 2:1 sur n'importe quelle ressource

export interface Port {
  readonly kind: PortKind;
}

/** Taux de base, sans aucun port. */
export const BASE_RATE = 4;

const GENERIC_RATE = 3;
const SPECIFIC_RATE = 2;

/**
 * Combien de cartes il faut donner pour en recevoir une.
 *
 * On retient toujours le meilleur taux dont dispose le joueur : posséder un
 * port spécialisé n'annule jamais l'avantage d'un port générique.
 */
export function tradeRate(board: Board, player: PlayerId, resource: Resource): number {
  let best = BASE_RATE;

  for (const [vertex, port] of board.allPorts()) {
    const building = board.buildingAt(vertex);
    if (building?.owner !== player) continue;

    const rate = rateOf(port, resource);
    if (rate < best) best = rate;
  }

  return best;
}

function rateOf(port: Port, resource: Resource): number {
  if (port.kind === 'merchant') return SPECIFIC_RATE;
  if (port.kind === 'generic') return GENERIC_RATE;
  return port.kind === resource ? SPECIFIC_RATE : BASE_RATE;
}

/** Les ports qu'un joueur contrôle, pour l'affichage et les objectifs. */
export function portsOf(board: Board, player: PlayerId): { vertex: VertexId; port: Port }[] {
  const out: { vertex: VertexId; port: Port }[] = [];
  for (const [vertex, port] of board.allPorts()) {
    if (board.buildingAt(vertex)?.owner === player) out.push({ vertex, port });
  }
  return out;
}

/** Le meilleur taux dont dispose le joueur, toutes ressources confondues. */
export function bestRate(board: Board, player: PlayerId, resources: readonly Resource[]): number {
  return Math.min(...resources.map((r) => tradeRate(board, player, r)));
}
