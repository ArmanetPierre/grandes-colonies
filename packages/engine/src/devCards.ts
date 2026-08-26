/**
 * Cartes développement.
 *
 * Deux règles classiques sont conservées, et toutes deux comptent davantage
 * ici qu'à quatre joueurs :
 *
 *   — une carte ne se joue pas le tour où elle est achetée, sans quoi on
 *     pourrait convertir des ressources en chevalier au moment précis où
 *     l'on en a besoin ;
 *   — une seule carte par tour, sinon un joueur qui a thésaurisé viderait sa
 *     main d'un coup et emporterait la partie hors de toute réaction.
 *
 * La pioche est mélangée par le générateur seedé : à graine égale, la même
 * partie distribue les mêmes cartes dans le même ordre.
 */

import type { SeededRandom } from './rng.js';

export const DEV_CARD_KINDS = [
  'knight',        // déplace le voleur, compte pour la puissance militaire
  'roadBuilding',  // deux routes gratuites
  'invention',     // deux ressources au choix
  'monopoly',      // tous les joueurs cèdent une ressource
  'freeBuild',     // combinaison de construction offerte
] as const;

export type DevCardKind = (typeof DEV_CARD_KINDS)[number];

export type DeckComposition = Readonly<Record<DevCardKind, number>>;

/** Composition du Catan classique, hors cartes de points de victoire. */
export const CLASSIC_DECK: DeckComposition = Object.freeze({
  knight: 14,
  roadBuilding: 2,
  invention: 2,
  monopoly: 2,
  freeBuild: 0,
});

/**
 * Soixante cartes, comme le prévoit le prototype (§38). Les chevaliers
 * dominent parce qu'ils servent deux fois : puissance militaire et défense
 * contre les barbares.
 */
export const GRAND_COLONIES_DECK: DeckComposition = Object.freeze({
  knight: 30,
  roadBuilding: 8,
  invention: 8,
  monopoly: 7,
  freeBuild: 7,
});

/** Une pioche mélangée, prête à distribuer. */
export function buildDeck(composition: DeckComposition, rng: SeededRandom): DevCardKind[] {
  const cards: DevCardKind[] = [];
  for (const kind of DEV_CARD_KINDS) {
    for (let i = 0; i < composition[kind]; i++) cards.push(kind);
  }
  return rng.shuffle(cards);
}

export function deckSize(composition: DeckComposition): number {
  return DEV_CARD_KINDS.reduce((sum, kind) => sum + composition[kind], 0);
}

/**
 * Les cartes d'un joueur.
 *
 * `pending` isole les cartes achetées durant le tour courant : c'est ce qui
 * implémente l'interdiction de jouer une carte le jour de son achat, sans
 * avoir à dater chaque carte individuellement.
 */
export interface DevCardHolding {
  readonly playable: readonly DevCardKind[];
  readonly pending: readonly DevCardKind[];
  readonly played: readonly DevCardKind[];
  readonly playedThisTurn: number;
}

export const EMPTY_HOLDING: DevCardHolding = Object.freeze({
  playable: Object.freeze([]),
  pending: Object.freeze([]),
  played: Object.freeze([]),
  playedThisTurn: 0,
});

export function buyCard(holding: DevCardHolding, card: DevCardKind): DevCardHolding {
  return Object.freeze({
    ...holding,
    pending: Object.freeze([...holding.pending, card]),
  });
}

/**
 * Ouverture du tour : les cartes achetées au tour précédent deviennent
 * jouables, et le quota d'une carte par tour se réarme.
 */
export function beginTurn(holding: DevCardHolding): DevCardHolding {
  return Object.freeze({
    playable: Object.freeze([...holding.playable, ...holding.pending]),
    pending: Object.freeze([]),
    played: holding.played,
    playedThisTurn: 0,
  });
}

export type PlayError = 'not-held' | 'bought-this-turn' | 'already-played-this-turn';

export type PlayCheck = { readonly ok: true } | { readonly ok: false; readonly reason: PlayError };

const PLAY_OK: PlayCheck = Object.freeze({ ok: true });
const playFail = (reason: PlayError): PlayCheck => Object.freeze({ ok: false, reason });

export function canPlayCard(holding: DevCardHolding, card: DevCardKind): PlayCheck {
  if (holding.playedThisTurn > 0) return playFail('already-played-this-turn');
  if (holding.playable.includes(card)) return PLAY_OK;
  // Distinguer « pas en main » de « achetée à l'instant » permet à
  // l'interface de dire laquelle des deux règles bloque le joueur.
  if (holding.pending.includes(card)) return playFail('bought-this-turn');
  return playFail('not-held');
}

export function playCard(holding: DevCardHolding, card: DevCardKind): DevCardHolding {
  const check = canPlayCard(holding, card);
  if (!check.ok) throw new Error(`Carte injouable : ${check.reason}`);

  const remaining = [...holding.playable];
  remaining.splice(remaining.indexOf(card), 1);

  return Object.freeze({
    playable: Object.freeze(remaining),
    pending: holding.pending,
    played: Object.freeze([...holding.played, card]),
    playedThisTurn: holding.playedThisTurn + 1,
  });
}

/** Chevaliers joués — c'est ce compte, et non les cartes en main, qui donne la puissance militaire. */
export function knightsPlayed(holding: DevCardHolding): number {
  return holding.played.filter((card) => card === 'knight').length;
}

/** Nombre total de cartes détenues, jouables ou non. */
export function heldCount(holding: DevCardHolding): number {
  return holding.playable.length + holding.pending.length;
}
