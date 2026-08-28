/**
 * Offres d'échange entre joueurs (§9, contrat §4).
 *
 * Le game design en fait le cœur du jeu à douze : c'est par la négociation
 * qu'un joueur qui n'agit qu'un cycle sur douze reste dans la partie.
 *
 * Une offre n'engage rien tant qu'elle n'est pas acceptée. Sa validation est
 * **atomique** : les deux inventaires, la phase et l'offre elle-même sont
 * vérifiés au moment de l'acceptation, jamais avant. Une offre dont l'auteur
 * a dépensé ses ressources entre-temps devient caduque plutôt que de
 * s'appliquer à moitié.
 */

import type { PlayerId } from '../board/board.js';
import { marketRate } from '../market.js';
import { portDiscount } from '../ports.js';
import { type Resource, type ResourceCounts, RESOURCES, amount, total } from '../resources.js';
import type { GameState } from './state.js';

/**
 * Combien de cartes donner à la banque pour en recevoir une.
 *
 * Deux systèmes s'y rencontrent, et l'ordre compte : le **marché** fixe le
 * cours de la ressource (§10), le **port** en retranche une remise (§11).
 * L'inverse — un port qui imposerait son taux — aurait rendu le marché
 * invisible à quiconque occupe un port, c'est-à-dire à tous les joueurs
 * installés.
 *
 * Le plancher est celui du marché lui-même : un port ne descend jamais
 * au-dessous du prix le plus bas que le cours puisse atteindre, sinon un
 * port spécialisé sur une ressource déjà rare finirait par donner du 1:1.
 */
export function bankRate(state: GameState, player: PlayerId, resource: Resource): number {
  const cours = marketRate(state.config.market, state.market, resource);
  const discount = portDiscount(state.board, player, resource);
  return Math.max(state.config.market.minimum, cours - discount);
}

export interface TradeOffer {
  readonly id: string;
  readonly from: PlayerId;
  /** Destinataire, ou `undefined` pour une offre ouverte à tous. */
  readonly to: PlayerId | undefined;
  readonly give: ResourceCounts;
  readonly receive: ResourceCounts;
  readonly cycle: number;
}

export type OfferProblem =
  | 'empty'            // rien donné ou rien demandé
  | 'self-directed'    // adressée à soi-même
  | 'same-resources';  // donne et demande exactement la même chose

/** Une offre est-elle bien formée ? Ne dit rien de sa faisabilité. */
export function checkOffer(
  from: PlayerId,
  to: PlayerId | undefined,
  give: ResourceCounts,
  receive: ResourceCounts,
): OfferProblem | undefined {
  if (total(give) === 0 || total(receive) === 0) return 'empty';
  if (to === from) return 'self-directed';

  const identical = RESOURCES.every((r) => amount(give, r) === amount(receive, r));
  if (identical) return 'same-resources';

  return undefined;
}

/** Le joueur peut-il recevoir cette offre ? */
export function isAddressedTo(offer: TradeOffer, player: PlayerId): boolean {
  if (offer.from === player) return false;
  return offer.to === undefined || offer.to === player;
}
