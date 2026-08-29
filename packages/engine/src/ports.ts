/**
 * Ports et remise sur le cours du marché (§11).
 *
 * La simulation a montré que l'accès au commerce conditionne l'expansion
 * bien plus à douze joueurs qu'à quatre : une main de dix cartes réparties
 * sur cinq types ne contient presque jamais les trois minerais d'une ville.
 * Les ports pèsent donc ici nettement plus lourd que dans un Catan classique.
 *
 * Un port ne fixe pas un prix, il **remise celui du marché** : le cours dit
 * combien coûte une ressource, le port dit de combien son occupant en est
 * dispensé. C'est ce qui permet aux deux systèmes de coexister sans que l'un
 * annule l'autre — le taux final se lit dans `bankRate` (game/trade.ts).
 */

import type { Board, PlayerId } from './board/board.js';
import type { VertexId } from './board/graph.js';
import type { Resource } from './resources.js';

export type PortKind =
  | 'generic'   // remise d'une carte sur n'importe quelle ressource
  | 'wood' | 'brick' | 'wool' | 'grain' | 'ore'   // remise de deux sur une ressource
  | 'merchant'   // port marchand : remise de deux sur n'importe laquelle
  | 'mining'     // port minier : 2 minerai contre 1 or, hors marché
  | 'commercial'; // port commercial : 2 ressources différentes contre 1 au choix

/**
 * Tous les types de ports, à l'exécution.
 *
 * Le type union seul ne se parcourt pas : sans cette liste, chaque endroit
 * qui doit traiter « tous les ports » — le semis, les panneaux du plateau,
 * ceux de l'écran de table — en tenait sa propre copie, et un type ajouté
 * ici s'affichait ailleurs sous son nom anglais sans que rien ne le signale.
 */
export const PORT_KINDS = [
  'generic', 'wood', 'brick', 'wool', 'grain', 'ore',
  'merchant', 'mining', 'commercial',
] as const satisfies readonly PortKind[];

export interface Port {
  readonly kind: PortKind;
}

/**
 * Les deux ports à contrat du §11.
 *
 * Ils ne remisent pas le cours, ils s'y **soustraient** : leur taux est écrit
 * une fois pour toutes et ne bouge pas de la partie. C'est ce qui les rend
 * utiles là où un port ordinaire ne l'est plus — quand le marché a fait
 * monter une ressource à six, un contrat à deux vaut soudain très cher.
 *
 * Sans cette exemption, le port minier serait mort-né : un port spécialisé
 * minerai donne déjà deux contre une sur *tout*, y compris l'or, donc un
 * minier soumis au même plancher n'aurait jamais rien apporté.
 */
export const CONTRACT_PORTS = ['mining', 'commercial'] as const;
export type ContractPort = (typeof CONTRACT_PORTS)[number];

export function isContractPort(kind: PortKind): kind is ContractPort {
  return kind === 'mining' || kind === 'commercial';
}

/** Ce que le port minier consomme et rend, invariablement (§11). */
export const MINING_PORT_TRADE = Object.freeze({ give: 2, from: 'ore', to: 'gold' } as const);

/** Cartes à donner au port commercial : deux, de natures différentes (§11). */
export const COMMERCIAL_PORT_GIVE = 2;

/** Taux de base, quand rien ne le fait bouger : le 4:1 de Catan. */
export const BASE_RATE = 4;

/** Ce qu'un port retranche au cours, en cartes. */
const GENERIC_DISCOUNT = 1;
const SPECIFIC_DISCOUNT = 2;

/**
 * De combien de cartes les ports de ce joueur allègent le cours.
 *
 * On retient toujours la meilleure remise dont dispose le joueur : posséder
 * un port spécialisé n'annule jamais l'avantage d'un port générique.
 */
export function portDiscount(board: Board, player: PlayerId, resource: Resource): number {
  let best = 0;

  for (const [vertex, port] of board.allPorts()) {
    const building = board.buildingAt(vertex);
    if (building?.owner !== player) continue;

    const discount = discountOf(port, resource);
    if (discount > best) best = discount;
  }

  return best;
}

function discountOf(port: Port, resource: Resource): number {
  // Les ports à contrat n'entrent pas dans le calcul du cours : ils ont leur
  // propre échange, et cumuler les deux reviendrait à les payer deux fois.
  if (isContractPort(port.kind)) return 0;
  if (port.kind === 'merchant') return SPECIFIC_DISCOUNT;
  if (port.kind === 'generic') return GENERIC_DISCOUNT;
  return port.kind === resource ? SPECIFIC_DISCOUNT : 0;
}

/** Ce joueur tient-il un port de ce type ? */
export function hasPort(board: Board, player: PlayerId, kind: PortKind): boolean {
  for (const [vertex, port] of board.allPorts()) {
    if (port.kind === kind && board.buildingAt(vertex)?.owner === player) return true;
  }
  return false;
}

/** Les types de ports que ce joueur contrôle, sans doublon et triés. */
export function portKindsOf(board: Board, player: PlayerId): PortKind[] {
  const kinds = new Set<PortKind>();
  for (const { port } of portsOf(board, player)) kinds.add(port.kind);
  return [...kinds].sort();
}

/** Les ports qu'un joueur contrôle, pour l'affichage et les objectifs. */
export function portsOf(board: Board, player: PlayerId): { vertex: VertexId; port: Port }[] {
  const out: { vertex: VertexId; port: Port }[] = [];
  for (const [vertex, port] of board.allPorts()) {
    if (board.buildingAt(vertex)?.owner === player) out.push({ vertex, port });
  }
  return out;
}
