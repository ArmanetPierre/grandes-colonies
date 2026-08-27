/**
 * Objectifs secrets (§21).
 *
 * Chaque joueur en reçoit deux au début de la partie et n'en conserve qu'un,
 * qui lui rapporte 2 points s'il est rempli. Il reste caché jusqu'à la fin :
 * c'est une information privée, jamais envoyée aux autres clients.
 *
 * Le game design en propose six, mais quatre dépendent de systèmes qui
 * n'existent pas encore — ports, exploration, barbares, contrats. Seuls ceux
 * réellement mesurables aujourd'hui sont proposés en jeu ; les autres sont
 * déclarés mais désactivés, pour qu'il suffise de les rendre disponibles le
 * jour où leur système arrivera.
 */

import type { Board, PlayerId } from './board/board.js';
import { type DevCardHolding, knightsPlayed } from './devCards.js';

export const OBJECTIVE_IDS = [
  'architect',    // 8 bâtiments
  'urbanist',     // 4 villes
  'settler',      // 5 colonies simultanées
  'roadNetwork',  // 12 routes posées
  'warlord',      // 3 chevaliers joués
  'explorer',     // 5 territoires découverts — nécessite l'exploration
  'magnate',      // 12 or — nécessite l'or
  'diplomat',     // 3 contrats honorés — nécessite les contrats
] as const;

export type ObjectiveId = (typeof OBJECTIVE_IDS)[number];

/** Ce dont un objectif a besoin pour se vérifier. */
export interface ObjectiveContext {
  readonly board: Board;
  readonly player: PlayerId;
  readonly devCards: DevCardHolding;
  /** Routes posées, déduites de la réserve initiale. */
  readonly roadsPlaced: number;
  readonly gold: number;
  readonly territoriesExplored: number;
  readonly contractsHonoured: number;
}

export interface Objective {
  readonly id: ObjectiveId;
  readonly title: string;
  readonly description: string;
  /**
   * Faux tant que le système dont dépend l'objectif n'existe pas. Un objectif
   * indisponible n'est jamais distribué : sans cela un joueur pourrait tirer
   * une carte impossible à remplir.
   */
  readonly available: boolean;
  isComplete(context: ObjectiveContext): boolean;
}

function countBuildings(board: Board, player: PlayerId, kind?: 'settlement' | 'city'): number {
  let count = 0;
  for (const building of board.allBuildings().values()) {
    if (building.owner !== player) continue;
    if (kind === undefined || building.kind === kind) count++;
  }
  return count;
}

export const OBJECTIVES: Readonly<Record<ObjectiveId, Objective>> = Object.freeze({
  architect: {
    id: 'architect',
    title: 'Architecte',
    description: 'Posséder 8 bâtiments',
    available: true,
    isComplete: (c) => countBuildings(c.board, c.player) >= 8,
  },
  urbanist: {
    id: 'urbanist',
    title: 'Bâtisseur de cités',
    description: 'Posséder 4 villes',
    available: true,
    isComplete: (c) => countBuildings(c.board, c.player, 'city') >= 4,
  },
  settler: {
    id: 'settler',
    title: 'Colonisateur',
    description: 'Posséder 5 colonies en même temps',
    available: true,
    isComplete: (c) => countBuildings(c.board, c.player, 'settlement') >= 5,
  },
  roadNetwork: {
    id: 'roadNetwork',
    title: 'Grand bâtisseur',
    description: 'Poser 12 routes',
    available: true,
    isComplete: (c) => c.roadsPlaced >= 12,
  },
  warlord: {
    id: 'warlord',
    title: 'Seigneur militaire',
    description: 'Jouer 3 chevaliers',
    available: true,
    isComplete: (c) => knightsPlayed(c.devCards) >= 3,
  },

  // Déclarés mais indisponibles : leur système n'existe pas encore.
  explorer: {
    id: 'explorer',
    title: 'Explorateur',
    description: 'Découvrir 5 territoires',
    available: false,
    isComplete: (c) => c.territoriesExplored >= 5,
  },
  magnate: {
    id: 'magnate',
    title: 'Magnat',
    description: 'Accumuler 12 or',
    available: false,
    isComplete: (c) => c.gold >= 12,
  },
  diplomat: {
    id: 'diplomat',
    title: 'Diplomate',
    description: 'Honorer 3 contrats',
    available: false,
    isComplete: (c) => c.contractsHonoured >= 3,
  },
});

/** Les objectifs réellement distribuables aujourd'hui. */
export function availableObjectives(): ObjectiveId[] {
  return OBJECTIVE_IDS.filter((id) => OBJECTIVES[id].available);
}

export function isObjectiveComplete(id: ObjectiveId, context: ObjectiveContext): boolean {
  return OBJECTIVES[id].isComplete(context);
}
