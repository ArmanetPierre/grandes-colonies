/**
 * Configuration d'une partie.
 *
 * Tout ce qui pourrait faire l'objet d'un réglage y figure, pour qu'un
 * playtest puisse comparer deux variantes sans toucher au code — c'est
 * l'exigence du §14 du plan de développement.
 */

import type { ProductionConfig } from '../production.js';
import { GRAND_COLONIES_PRODUCTION } from '../production.js';
import type { DeckComposition } from '../devCards.js';
import { GRAND_COLONIES_DECK } from '../devCards.js';
import type { VictoryConfig } from '../victory.js';
import { GRAND_COLONIES_VICTORY } from '../victory.js';

export interface GameConfig {
  readonly victory: VictoryConfig;
  readonly production: ProductionConfig;
  readonly deck: DeckComposition;

  /** Limite de main au-delà de laquelle un 7 force la défausse. */
  readonly handLimit: number;
  /** Nombre de voleurs en jeu. Deux à 11–12 joueurs (§25). */
  readonly robberCount: number;
  /** Longueur minimale du réseau pour le titre. */
  readonly minimumRouteLength: number;
  /** Chevaliers joués minimum pour la puissance militaire. */
  readonly minimumKnights: number;

  /** Pièces dont dispose chaque joueur (§38). */
  readonly roadsPerPlayer: number;
  readonly settlementsPerPlayer: number;
  readonly citiesPerPlayer: number;

  /**
   * Durées en secondes. Le moteur ne les applique pas — il ignore le temps —
   * mais elles voyagent avec la configuration pour que le serveur, les
   * sauvegardes et les rejeux partagent un seul réglage.
   */
  readonly activeTurnSeconds: number;
  readonly pairedTurnSeconds: number;
  readonly tradingWindowSeconds: number;
}

/**
 * Limite de main selon le nombre de joueurs (§24).
 *
 * Elle monte avec l'effectif parce que les occasions de dépenser se
 * raréfient : à douze joueurs, chacun produit à chaque lancer mais n'agit
 * qu'un tour sur douze.
 */
export function handLimitFor(playerCount: number): number {
  if (playerCount <= 7) return 7;
  // 8 joueurs → 9, puis un de plus par joueur, plafonné à 13.
  return Math.min(13, playerCount + 1);
}

/** Deux voleurs à partir de onze joueurs, pour ne pas figer une région entière. */
export function robberCountFor(playerCount: number): number {
  return playerCount >= 11 ? 2 : 1;
}

export function defaultConfig(playerCount: number): GameConfig {
  return Object.freeze({
    victory: GRAND_COLONIES_VICTORY,
    production: GRAND_COLONIES_PRODUCTION,
    deck: GRAND_COLONIES_DECK,
    handLimit: handLimitFor(playerCount),
    robberCount: robberCountFor(playerCount),
    minimumRouteLength: 5,
    minimumKnights: 3,
    roadsPerPlayer: 15,
    settlementsPerPlayer: 5,
    citiesPerPlayer: 4,
    activeTurnSeconds: 90,
    pairedTurnSeconds: 90,
    tradingWindowSeconds: 30,
  });
}
