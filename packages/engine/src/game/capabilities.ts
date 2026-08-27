/**
 * Ce qu'un joueur peut faire à cet instant.
 *
 * Un seul endroit répond à cette question, plutôt que des dizaines de
 * `if (phase === …)` dispersés dans le serveur et le client. Les rôles —
 * actif, associé, passif — s'y traduisent en capacités, et l'interface s'en
 * sert pour griser un bouton **et dire pourquoi**.
 *
 * Le client ne fait qu'afficher : le serveur reste seul autoritaire, et
 * revalide tout à la réception de la commande.
 */

import { COSTS, canAfford, total } from '../resources.js';
import { type DevCardKind, canPlayCard } from '../devCards.js';

/** Les cartes autres que le chevalier, qui a ses propres règles de phase. */
const OTHER_CARDS: readonly DevCardKind[] = ['roadBuilding', 'invention', 'monopoly', 'freeBuild'];
import { type GameState, activePlayer, pairedPlayer, playerOf } from './state.js';

export const CAPABILITIES = [
  'CAN_ROLL_DICE',
  'CAN_TRADE_BANK',
  'CAN_TRADE_PLAYER',
  'CAN_BUILD',
  'CAN_DECLARE_BUILD',
  'CAN_BUY_DEV_CARD',
  'CAN_PLAY_KNIGHT',
  'CAN_PLAY_DEV_CARD',
  'CAN_MOVE_ROBBER',
  'CAN_DISCARD',
  'CAN_END_TURN',
  'CAN_END_CYCLE',
  'CAN_PLACE_SETUP',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export type PlayerRole = 'active' | 'paired' | 'idle';

export function roleOf(state: GameState, playerId: string): PlayerRole {
  if (state.phase === 'setup' || state.phase === 'ended') return 'idle';
  if (activePlayer(state).id === playerId) return 'active';
  if (pairedPlayer(state)?.id === playerId) return 'paired';
  return 'idle';
}

/**
 * Les capacités d'un joueur, dans l'état courant.
 *
 * Une capacité absente signifie « pas maintenant », pas « jamais ». Le détail
 * du refus — pas assez de brique, emplacement gelé — reste porté par les
 * validations du moteur, qui seules connaissent la cible visée.
 */
export function getCapabilities(state: GameState, playerId: string): Set<Capability> {
  const caps = new Set<Capability>();
  const player = playerOf(state, playerId);
  if (!player || state.phase === 'ended') return caps;

  // Une défausse due prime sur tout le reste, pour tout le monde.
  if (player.mustDiscard > 0) {
    caps.add('CAN_DISCARD');
    return caps;
  }
  // Tant qu'un joueur doit défausser, la partie attend.
  const waiting = state.players.some((p) => p.mustDiscard > 0);

  if (state.phase === 'setup') {
    if (state.setupQueue[0] === playerId) caps.add('CAN_PLACE_SETUP');
    return caps;
  }

  const role = roleOf(state, playerId);
  const affordsAny = canAfford(player.hand, COSTS.road)
    || canAfford(player.hand, COSTS.settlement)
    || canAfford(player.hand, COSTS.city);

  if (state.phase === 'production') {
    if (role === 'active' && !waiting) caps.add('CAN_ROLL_DICE');
    // Le chevalier se joue avant le lancer, pour déplacer le voleur d'abord.
    if (role === 'active' && !waiting && canPlayCard(player.devCards, 'knight').ok) {
      caps.add('CAN_PLAY_KNIGHT');
    }
  }

  if (state.phase === 'activeTurn' && !waiting) {
    if (role === 'active' && state.pendingRobber) {
      // Le voleur bloque le joueur actif et lui seul.
      caps.add('CAN_MOVE_ROBBER');
      return caps;
    }

    if (role === 'active' || role === 'paired') {
      if (affordsAny) caps.add('CAN_BUILD');
      caps.add('CAN_TRADE_BANK');
      if (state.deck.length > 0 && canAfford(player.hand, COSTS.devCard)) caps.add('CAN_BUY_DEV_CARD');
      if (canPlayCard(player.devCards, 'knight').ok) caps.add('CAN_PLAY_KNIGHT');
      // Les autres cartes ne se jouent que pendant le tour actif, et par le
      // seul joueur actif : l'associé construit et commerce, il ne joue pas
      // de cartes. La vue privée dit *lesquelles* sont jouables.
      if (role === 'active' && OTHER_CARDS.some((c) => canPlayCard(player.devCards, c).ok)) {
        caps.add('CAN_PLAY_DEV_CARD');
      }
    }
    // Seul l'actif négocie pendant son tour (contrat §1).
    if (role === 'active') {
      caps.add('CAN_TRADE_PLAYER');
      caps.add('CAN_END_TURN');
    }
  }

  if (state.phase === 'freeTrade' && !waiting) {
    caps.add('CAN_TRADE_PLAYER');
    if (role === 'active') caps.add('CAN_END_CYCLE');
  }

  // Annoncer une construction est ouvert à tous, à tout moment (contrat §3).
  const canPay = affordsAny && total(player.hand) > 0;
  if ((state.phase === 'activeTurn' || state.phase === 'freeTrade') && canPay && !waiting) {
    caps.add('CAN_DECLARE_BUILD');
  }

  return caps;
}
