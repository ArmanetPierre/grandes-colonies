/**
 * Sérialisation des événements de domaine.
 *
 * Le serveur diffusait les événements par `JSON.stringify` brut. Deux d'entre
 * eux portent une `Map` — la production et la défausse due — et un `Map`
 * passé à `JSON.stringify` devient `{}` : ces deux événements traversaient le
 * réseau **vides**, sans que rien ne le signale.
 *
 * Le piège était latent tant qu'aucun client ne les consommait. Il se serait
 * refermé au moment d'écrire le journal de partie, qui est précisément leur
 * destinataire prévu.
 *
 * Les paires sont donc converties en tableaux, ce qui traverse JSON sans
 * perte et se relit sans dictionnaire de reprise.
 */

import type { DevCardKind, DomainEvent, PlayerId, Resource, ResourceCounts } from '@grand-colonies/engine';

/** Une entrée de dictionnaire, sous une forme que JSON préserve. */
export interface Pair<T> {
  readonly player: PlayerId;
  readonly value: T;
}

/**
 * Les événements tels qu'ils circulent sur le réseau.
 *
 * Identiques aux événements du moteur, sauf pour les deux qui portaient une
 * `Map`.
 */
export type WireEvent =
  | Exclude<
      DomainEvent,
      { type: 'ResourcesProduced' } | { type: 'DiscardRequired' }
      | { type: 'DevCardBought' } | { type: 'ResourceStolen' }
    >
  | { readonly type: 'ResourcesProduced'; readonly gains: readonly Pair<ResourceCounts>[] }
  | { readonly type: 'DiscardRequired'; readonly players: readonly Pair<number>[] }
  /** `card` n'est présent que pour l'acheteur (voir `redactFor`). */
  | { readonly type: 'DevCardBought'; readonly player: PlayerId; readonly card?: DevCardKind }
  /**
   * `resource` est servi à tout le monde, comme les mains elles-mêmes.
   *
   * Le masquer ne protégeait plus rien depuis que la vue publique porte
   * l'inventaire détaillé : la carte manquante se lisait de toute façon en
   * comparant deux diffusions. Restait le seul effet du masque — un client
   * incapable d'annoncer ce qui venait d'être volé alors que le panneau d'à
   * côté l'affichait déjà.
   *
   * Optionnel encore dans le type : les journaux de parties déjà enregistrées
   * en sont dépourvus, et `fromWire` doit continuer à les relire.
   */
  | {
      readonly type: 'ResourceStolen';
      readonly thief: PlayerId;
      readonly victim: PlayerId;
      readonly resource?: Resource;
    };

const pairsOf = <T>(map: ReadonlyMap<PlayerId, T>): Pair<T>[] =>
  [...map].map(([player, value]) => ({ player, value }));

/** Convertit un événement du moteur en sa forme diffusable. */
export function toWire(event: DomainEvent): WireEvent {
  if (event.type === 'ResourcesProduced') {
    return { type: 'ResourcesProduced', gains: pairsOf(event.gains) };
  }
  if (event.type === 'DiscardRequired') {
    return { type: 'DiscardRequired', players: pairsOf(event.players) };
  }
  return event as WireEvent;
}

export function toWireAll(events: readonly DomainEvent[]): WireEvent[] {
  return events.map(toWire);
}

/**
 * Reconstruit un événement du moteur depuis sa forme réseau.
 *
 * Utile au rejeu d'une partie sauvegardée : le journal est stocké sous forme
 * réseau, mais le moteur attend ses `Map`.
 */
export function fromWire(event: WireEvent): DomainEvent {
  if (event.type === 'ResourcesProduced') {
    return {
      type: 'ResourcesProduced',
      gains: new Map(event.gains.map((p) => [p.player, p.value])),
    };
  }
  if (event.type === 'DiscardRequired') {
    return {
      type: 'DiscardRequired',
      players: new Map(event.players.map((p) => [p.player, p.value])),
    };
  }
  return event as DomainEvent;
}

/**
 * Retire d'un événement ce que ce destinataire n'a pas le droit de savoir.
 *
 * Le flux d'événements contournait entièrement les vues : il diffusait à tout
 * le monde la nature exacte de la carte développement que chacun venait
 * d'acheter. Toute l'étanchéité construite dans `publicView` tombait par
 * cette porte.
 *
 * Une carte développement achetée n'est connue que de son acheteur.
 *
 * Le vol, lui, n'est plus expurgé : les ressources sont publiques (voir
 * l'en-tête de `views.ts`), et cacher ici ce que la vue publique montre juste
 * après n'aurait masqué que l'annonce, jamais le fait.
 */
export function redactFor(event: WireEvent, viewer: PlayerId): WireEvent {
  if (event.type === 'DevCardBought' && event.player !== viewer) {
    return { type: 'DevCardBought', player: event.player };
  }
  return event;
}

export function redactAllFor(events: readonly WireEvent[], viewer: PlayerId): WireEvent[] {
  return events.map((event) => redactFor(event, viewer));
}
