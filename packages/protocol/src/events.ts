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

import type { DomainEvent, PlayerId, ResourceCounts } from '@grand-colonies/engine';

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
  | Exclude<DomainEvent, { type: 'ResourcesProduced' } | { type: 'DiscardRequired' }>
  | { readonly type: 'ResourcesProduced'; readonly gains: readonly Pair<ResourceCounts>[] }
  | { readonly type: 'DiscardRequired'; readonly players: readonly Pair<number>[] };

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
