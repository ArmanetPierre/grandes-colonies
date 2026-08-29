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
import type { MarketConfig } from '../market.js';
import { GRAND_COLONIES_MARKET } from '../market.js';
import type { VictoryConfig } from '../victory.js';
import { GRAND_COLONIES_VICTORY } from '../victory.js';
import type { InfluenceConfig } from '../influence.js';
import { GRAND_COLONIES_INFLUENCE } from '../influence.js';
import type { BarbarianConfig } from '../barbarians.js';
import { GRAND_COLONIES_BARBARIANS } from '../barbarians.js';

export interface GameConfig {
  readonly victory: VictoryConfig;
  readonly production: ProductionConfig;
  readonly deck: DeckComposition;
  /**
   * Cours d'ouverture et amplitude du marché dynamique (§10).
   *
   * Réglable comme le reste : c'est le seul moyen de comparer deux barèmes
   * en playtest sans recompiler.
   */
  readonly market: MarketConfig;
  /** Ce que rapporte chaque source d'Influence (§17). */
  readonly influence: InfluenceConfig;
  /** Cadence et force des invasions barbares (§16). */
  readonly barbarians: BarbarianConfig;

  /** Limite de main au-delà de laquelle un 7 force la défausse. */
  readonly handLimit: number;
  /** Nombre de voleurs en jeu. Deux à 11–12 joueurs (§25). */
  readonly robberCount: number;
  /** Longueur minimale du réseau pour le titre. */
  readonly minimumRouteLength: number;
  /** Chevaliers joués minimum pour la puissance militaire. */
  readonly minimumKnights: number;

  /**
   * Pièces dont dispose chaque joueur (§38).
   *
   * La dotation de routes a été portée de 15 à 20 après mesure : à 15, un
   * joueur finit avec quatre colonies en réserve et aucune route pour
   * atteindre un emplacement légal. Voir SIMULATION_FINDINGS.md.
   */
  readonly roadsPerPlayer: number;
  readonly settlementsPerPlayer: number;
  readonly citiesPerPlayer: number;
  /**
   * Métropoles disponibles pour toute la partie, tous joueurs confondus.
   *
   * C'est un prix de course, comme la route la plus longue : une
   * amélioration accessible à tous gonflerait tous les scores sans rien
   * départager (contrat §8).
   */
  readonly metropolisesTotal: number;

  /**
   * Durées en secondes. Le moteur ne les applique pas — il ignore le temps —
   * mais elles voyagent avec la configuration pour que le serveur, les
   * sauvegardes et les rejeux partagent un seul réglage.
   */
  /**
   * Délai laissé à un joueur pour poser, pendant la mise en place.
   *
   * Elle n'en avait aucun : un joueur connecté qui s'absentait bloquait la
   * table indéfiniment, sans recours. À douze, quelqu'un ira chercher à boire.
   */
  readonly setupSeconds: number;
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
    market: GRAND_COLONIES_MARKET,
    influence: GRAND_COLONIES_INFLUENCE,
    barbarians: GRAND_COLONIES_BARBARIANS,
    handLimit: handLimitFor(playerCount),
    robberCount: robberCountFor(playerCount),
    minimumRouteLength: 5,
    minimumKnights: 3,
    roadsPerPlayer: 20,
    settlementsPerPlayer: 5,
    citiesPerPlayer: 4,
    metropolisesTotal: 3,
    setupSeconds: 60,
    activeTurnSeconds: 90,
    pairedTurnSeconds: 90,
    tradingWindowSeconds: 30,
  });
}
