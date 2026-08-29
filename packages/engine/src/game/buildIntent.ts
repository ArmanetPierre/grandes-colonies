/**
 * Annonces de construction — la mécanique semi-simultanée du §8.
 *
 * Une annonce n'est pas une construction : c'est une intention datée, dont
 * les ressources sont immédiatement réservées. Elle ne devient un bâtiment
 * qu'à la résolution, en fin de phase de commerce.
 *
 * Toutes les règles appliquées ici sont fixées par RULES_CONTRACT.md §3.
 */

import type { PlayerId } from '../board/board.js';
import type { EdgeId, VertexId } from '../board/graph.js';
import type { ResourceCounts } from '../resources.js';

export type IntentTarget =
  | { readonly kind: 'road'; readonly edge: EdgeId }
  | { readonly kind: 'settlement'; readonly vertex: VertexId }
  | { readonly kind: 'city'; readonly vertex: VertexId };

export interface BuildIntent {
  readonly id: string;
  readonly player: PlayerId;
  readonly target: IntentTarget;
  /** Ressources bloquées : ni échangeables, ni réutilisables. */
  readonly reserved: ResourceCounts;
  readonly cycle: number;
  /**
   * Rang d'arrivée au serveur. C'est lui, et non un horodatage, qui départage
   * deux annonces : une horloge peut reculer, un compteur non.
   */
  readonly order: number;
}

/** L'emplacement visé, sous forme comparable. */
export function locationOf(target: IntentTarget): string {
  return target.kind === 'road' ? `e:${target.edge}` : `v:${target.vertex}`;
}

export interface Resolution {
  /** Annonces qui deviennent des constructions. */
  readonly built: readonly BuildIntent[];
  /** Annonces perdues ; leurs ressources sont à rendre. */
  readonly refunded: readonly BuildIntent[];
  /** Emplacements gelés jusqu'à la fin du cycle. */
  readonly frozen: readonly string[];
}

/**
 * Départage les annonces d'un cycle.
 *
 * Règle du contrat §3, désormais complète : le joueur actif l'emporte ;
 * sinon celui qui a le plus d'Influence ; sinon la plus ancienne annonce.
 *
 * L'Influence s'insère **entre** les deux règles existantes, exactement où
 * le contrat l'avait prévue. Elle ne remplace pas l'ancienneté : la garder en
 * dernier recours est ce qui fait que la résolution désigne toujours un
 * vainqueur, et donc que le gel reste inatteignable. Le §8 du game design le
 * prévoyait pour une égalité d'Influence, mais deux joueurs à zéro sont le
 * cas ordinaire en début de partie — geler à chaque fois aurait fait de
 * l'exception la règle.
 *
 * `influenceOf` est passée en fonction plutôt que lue sur les annonces : une
 * annonce est datée à son arrivée, et l'Influence peut avoir bougé entre
 * l'annonce et la résolution. C'est celle du moment où l'on tranche qui compte.
 */
export function resolveIntents(
  intents: readonly BuildIntent[],
  activePlayer: PlayerId,
  influenceOf: (player: PlayerId) => number = () => 0,
): Resolution {
  const byLocation = new Map<string, BuildIntent[]>();
  for (const intent of intents) {
    const key = locationOf(intent.target);
    const group = byLocation.get(key) ?? [];
    group.push(intent);
    byLocation.set(key, group);
  }

  const built: BuildIntent[] = [];
  const refunded: BuildIntent[] = [];
  const frozen: string[] = [];

  for (const [location, group] of byLocation) {
    const winner = pickWinner(group, activePlayer, influenceOf);

    if (winner === undefined) {
      // Aucune départition possible : personne ne construit ici ce cycle.
      frozen.push(location);
      refunded.push(...group);
      continue;
    }

    built.push(winner);
    refunded.push(...group.filter((i) => i.id !== winner.id));
  }

  // L'ordre d'arrivée dicte l'ordre de construction : deux annonces
  // adjacentes peuvent s'exclure, et la plus ancienne doit passer d'abord.
  built.sort((a, b) => a.order - b.order);
  return { built, refunded, frozen };
}

function pickWinner(
  group: readonly BuildIntent[],
  activePlayer: PlayerId,
  influenceOf: (player: PlayerId) => number,
): BuildIntent | undefined {
  if (group.length === 0) return undefined;

  // 1. Le joueur actif l'emporte, quelle que soit son Influence.
  const fromActive = group.filter((i) => i.player === activePlayer);
  if (fromActive.length > 0) {
    return [...fromActive].sort((a, b) => a.order - b.order)[0];
  }

  // 2. Sinon la plus forte Influence — et seuls ceux qui l'égalent restent
  //    en lice, pour que l'ancienneté ne tranche qu'entre égaux.
  const best = Math.max(...group.map((i) => influenceOf(i.player)));
  const contenders = group.filter((i) => influenceOf(i.player) === best);

  // 3. À Influence égale, la plus ancienne annonce.
  return [...contenders].sort((a, b) => a.order - b.order)[0];
}
