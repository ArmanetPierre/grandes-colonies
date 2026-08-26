/**
 * Plus grande puissance militaire.
 *
 * Ce sont les chevaliers *joués* qui comptent, jamais ceux tenus en main :
 * un joueur peut accumuler des cartes sans jamais accéder au titre.
 */

import type { PlayerId } from './board/board.js';
import { titleHolder } from './titles.js';

/** Nombre de chevaliers à jouer avant de pouvoir revendiquer le titre. */
export const DEFAULT_MINIMUM_KNIGHTS = 3;

export interface ArmyHolder {
  readonly player: PlayerId;
  readonly knights: number;
}

export function largestArmyHolder(
  knightsPlayed: ReadonlyMap<PlayerId, number>,
  currentHolder?: PlayerId,
  minimum: number = DEFAULT_MINIMUM_KNIGHTS,
): ArmyHolder | undefined {
  const winner = titleHolder(knightsPlayed, currentHolder, minimum);
  return winner === undefined ? undefined : { player: winner.player, knights: winner.value };
}
