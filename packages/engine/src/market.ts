/**
 * Marché dynamique (§10).
 *
 * Le game design demande « un indicateur de demande » par ressource, qui
 * baisse quand on en vend beaucoup et monte quand elle manque — et insiste
 * pour que le marché reste **simple**, sous peine de transformer la soirée en
 * simulation économique.
 *
 * La lecture retenue est la plus économe possible : cet indicateur est
 * exactement le taux d'échange avec la banque, celui qui existait déjà. Le
 * jeu avait un 4:1 figé ; il a maintenant un cours qui bouge. Rien de
 * nouveau à apprendre pour un joueur — c'est le même geste, à un prix qui
 * change.
 *
 * Les valeurs d'ouverture sont celles du §10, et elles disent déjà quelque
 * chose de la partie : le bois est partout et vaut peu (5:1), l'or est rare
 * et achète beaucoup (2:1).
 *
 * Le cours ne bouge **que** par le marché. Une production, un vol, un
 * monopole, un échange entre joueurs n'y touchent pas : sinon le cours
 * suivrait le hasard des dés plutôt que les décisions de la table, et plus
 * personne ne pourrait le lire.
 */

import { type Resource, RESOURCES } from './resources.js';

export interface MarketConfig {
  /** Cours de départ : combien de cartes donner pour en recevoir une. */
  readonly opening: Readonly<Record<Resource, number>>;
  /**
   * Ventes nettes qui font bouger le cours d'un cran.
   *
   * Un cran par transaction serait illisible — le cours sauterait à chaque
   * conversion et personne ne pourrait planifier. Quatre laisse le temps de
   * voir venir.
   */
  readonly step: number;
  /** Bornes du cours. En deçà de 2, la banque donnerait presque. */
  readonly minimum: number;
  readonly maximum: number;
}

/**
 * Le cours du §10.
 *
 * Ces six valeurs tournent autour du 4:1 classique, ce qui garde le marché
 * comparable à ce qu'un joueur de Catan connaît. Le poisson n'a pas de
 * terrain sur les plateaux actuels : sa valeur est là pour que le
 * dictionnaire soit complet, pas pour servir.
 */
export const GRAND_COLONIES_MARKET: MarketConfig = Object.freeze({
  opening: Object.freeze({
    wood: 5, brick: 4, wool: 4, grain: 3, ore: 3, gold: 2, fish: 4,
  }),
  step: 4,
  minimum: 2,
  maximum: 6,
});

/**
 * L'état du marché : le solde des transactions, ressource par ressource.
 *
 * On compte des **transactions** et non des cartes. Un échange donne toujours
 * `taux` cartes contre une seule : compter les cartes ferait monter le côté
 * vendu quatre fois plus vite que ne descend le côté acheté, et tous les
 * cours dériveraient vers le plafond en quelques dizaines d'échanges. À une
 * transaction par côté, ce qui monte quelque part descend ailleurs.
 */
export interface MarketState {
  /** Positif : la ressource a été vendue au marché, donc elle se déprécie. */
  flow: Record<Resource, number>;
}

/**
 * Jusqu'où le solde peut courir, dans un sens et dans l'autre.
 *
 * Sans cette borne, le solde s'accumulait sans fin : la mesure a montré le
 * bois vendu quatre cents fois de suite, un cours collé au plafond, et
 * surtout **quatre cents achats nécessaires pour l'en décoller**. Le cours
 * ne pouvait alors plus redescendre de toute la partie — un indicateur mort,
 * exactement ce que le marché devait éviter.
 *
 * Le solde est donc arrêté un cran au-delà de la borne du cours. Une
 * ressource saturée le reste tant qu'on la brade, et repart dès qu'on cesse :
 * il suffit d'un palier d'achats, pas d'une partie entière.
 */
function flowBounds(config: MarketConfig, resource: Resource): { low: number; high: number } {
  const opening = config.opening[resource] ?? 4;
  const margin = config.step - 1;
  return {
    high: config.step * (config.maximum - opening) + margin,
    low: -(config.step * (opening - config.minimum) + margin),
  };
}

export function createMarket(): MarketState {
  const flow = {} as Record<Resource, number>;
  for (const r of RESOURCES) flow[r] = 0;
  return { flow };
}

const clamp = (n: number, low: number, high: number): number =>
  Math.min(high, Math.max(low, n));

/**
 * Le cours d'une ressource : combien en donner pour recevoir une carte.
 *
 * `trunc` plutôt que `floor` : il faut le même nombre de transactions pour
 * faire monter un cours que pour le faire redescendre. Avec `floor`, une
 * seule vente aurait suffi à faire bouger un cours revenu de l'autre côté.
 */
export function marketRate(config: MarketConfig, market: MarketState, resource: Resource): number {
  const opening = config.opening[resource] ?? 4;
  const moved = Math.trunc((market.flow[resource] ?? 0) / config.step);
  return clamp(opening + moved, config.minimum, config.maximum);
}

/**
 * De combien de transactions le cours est-il éloigné de son prochain cran ?
 *
 * Signé : positif si la ressource se déprécie, négatif si elle se raréfie.
 * Zéro quand le cours est bloqué contre sa borne dans ce sens-là — sans quoi
 * l'écran promettrait un mouvement qui n'arrivera jamais.
 */
export function marketDrift(config: MarketConfig, market: MarketState, resource: Resource): number {
  const drift = (market.flow[resource] ?? 0) % config.step;
  if (drift === 0) return 0;

  const rate = marketRate(config, market, resource);
  if (drift > 0 && rate >= config.maximum) return 0;
  if (drift < 0 && rate <= config.minimum) return 0;
  return drift;
}

/**
 * Enregistre un échange avec la banque et rend les cours qui ont bougé.
 *
 * La ressource donnée afflue au marché et se déprécie ; celle qui en sort se
 * raréfie et se renchérit. Les mouvements sont rendus plutôt qu'annoncés ici :
 * c'est le moteur qui sait en faire des événements.
 */
export function recordMarketTrade(
  config: MarketConfig,
  market: MarketState,
  given: Resource,
  received: Resource,
): { resource: Resource; from: number; to: number }[] {
  const before = new Map<Resource, number>([
    [given, marketRate(config, market, given)],
    [received, marketRate(config, market, received)],
  ]);

  for (const [resource, delta] of [[given, 1], [received, -1]] as const) {
    const bounds = flowBounds(config, resource);
    market.flow[resource] = clamp((market.flow[resource] ?? 0) + delta, bounds.low, bounds.high);
  }

  const moves: { resource: Resource; from: number; to: number }[] = [];
  for (const [resource, from] of before) {
    const to = marketRate(config, market, resource);
    if (to !== from) moves.push({ resource, from, to });
  }
  return moves;
}
