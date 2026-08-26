/**
 * Commandes et événements — le contrat entre le client et le moteur.
 *
 * Une commande est une *intention* : le client demande, le moteur dispose.
 * Le client n'applique jamais un effet lui-même, il attend les événements
 * en retour. C'est ce qui garantit qu'un client modifié ne peut pas tricher,
 * et que tous les joueurs voient le même déroulé.
 */

import type { PlayerId } from '../board/board.js';
import type { EdgeId, HexId, VertexId } from '../board/graph.js';
import type { DevCardKind } from '../devCards.js';
import type { Resource, ResourceCounts } from '../resources.js';
import type { Phase } from './state.js';
import type { IntentTarget } from './buildIntent.js';

/** Champs communs à toute commande. */
interface CommandBase {
  /**
   * Identifiant unique de l'action, choisi par le client.
   *
   * Un joueur dont le réseau ralentit clique deux fois : le serveur reçoit
   * deux commandes identiques et ne doit en exécuter qu'une. C'est cet
   * identifiant, et non l'horodatage, qui permet de les reconnaître.
   */
  readonly actionId: string;
  readonly playerId: PlayerId;
}

export type Command =
  | (CommandBase & { readonly type: 'PLACE_SETUP_SETTLEMENT'; readonly vertex: VertexId })
  | (CommandBase & { readonly type: 'PLACE_SETUP_ROAD'; readonly edge: EdgeId })
  | (CommandBase & { readonly type: 'ROLL_DICE' })
  | (CommandBase & { readonly type: 'DISCARD'; readonly resources: ResourceCounts })
  | (CommandBase & { readonly type: 'MOVE_ROBBER'; readonly from?: HexId; readonly to: HexId; readonly victim?: PlayerId })
  | (CommandBase & { readonly type: 'BUILD_ROAD'; readonly edge: EdgeId })
  | (CommandBase & { readonly type: 'BUILD_SETTLEMENT'; readonly vertex: VertexId })
  | (CommandBase & { readonly type: 'BUILD_CITY'; readonly vertex: VertexId })
  | (CommandBase & { readonly type: 'BUY_DEV_CARD' })
  | (CommandBase & { readonly type: 'PLAY_KNIGHT'; readonly from?: HexId; readonly to: HexId; readonly victim?: PlayerId })
  | (CommandBase & { readonly type: 'TRADE_WITH_BANK'; readonly give: ResourceCounts; readonly receive: ResourceCounts })
  | (CommandBase & { readonly type: 'DECLARE_BUILD'; readonly target: IntentTarget })
  | (CommandBase & { readonly type: 'CANCEL_BUILD'; readonly intentId: string })
  | (CommandBase & { readonly type: 'END_TURN' })
  | (CommandBase & { readonly type: 'END_CYCLE' });

export type CommandType = Command['type'];

/**
 * Événements de domaine : le récit de ce qui s'est réellement produit.
 *
 * Ils alimentent trois consommateurs — le journal de partie affiché aux
 * joueurs, la sauvegarde rejouable, et les métriques de playtest.
 */
export type DomainEvent =
  | { readonly type: 'GameStarted'; readonly players: readonly PlayerId[]; readonly seed: number | string }
  | { readonly type: 'SetupCompleted' }
  | { readonly type: 'SettlementPlaced'; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: 'RoadPlaced'; readonly player: PlayerId; readonly edge: EdgeId }
  | { readonly type: 'CityBuilt'; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: 'DiceRolled'; readonly player: PlayerId; readonly a: number; readonly b: number; readonly total: number }
  | { readonly type: 'ResourcesProduced'; readonly gains: ReadonlyMap<PlayerId, ResourceCounts> }
  | { readonly type: 'DiscardRequired'; readonly players: ReadonlyMap<PlayerId, number> }
  | { readonly type: 'ResourcesDiscarded'; readonly player: PlayerId; readonly resources: ResourceCounts }
  | { readonly type: 'RobberMoved'; readonly player: PlayerId; readonly from: HexId | undefined; readonly to: HexId }
  | { readonly type: 'ResourceStolen'; readonly thief: PlayerId; readonly victim: PlayerId; readonly resource: Resource }
  | { readonly type: 'DevCardBought'; readonly player: PlayerId; readonly card: DevCardKind }
  | { readonly type: 'DevCardPlayed'; readonly player: PlayerId; readonly card: DevCardKind }
  | { readonly type: 'BankTraded'; readonly player: PlayerId; readonly give: ResourceCounts; readonly receive: ResourceCounts }
  | { readonly type: 'TitleChanged'; readonly title: 'longestRoute' | 'largestArmy'; readonly from: PlayerId | undefined; readonly to: PlayerId | undefined }
  | { readonly type: 'PhaseChanged'; readonly from: Phase; readonly to: Phase }
  | { readonly type: 'TurnEnded'; readonly player: PlayerId; readonly cycle: number }
  | { readonly type: 'BuildDeclared'; readonly player: PlayerId; readonly intentId: string; readonly target: IntentTarget }
  | { readonly type: 'BuildCancelled'; readonly player: PlayerId; readonly intentId: string }
  | { readonly type: 'BuildResolved'; readonly player: PlayerId; readonly intentId: string; readonly target: IntentTarget }
  | { readonly type: 'BuildRefunded'; readonly player: PlayerId; readonly intentId: string; readonly reason: 'lost-conflict' | 'no-longer-legal' }
  | { readonly type: 'LocationFrozen'; readonly location: string }
  | { readonly type: 'CycleEnded'; readonly cycle: number }
  | { readonly type: 'GameWon'; readonly player: PlayerId; readonly points: number };

/** Pourquoi une commande a été refusée. */
export type RejectionReason =
  | 'unknown-player'
  | 'wrong-phase'
  | 'not-your-turn'
  | 'must-roll-first'
  | 'already-rolled'
  | 'must-discard-first'
  | 'not-enough-resources'
  | 'no-pieces-left'
  | 'empty-deck'
  | 'invalid-placement'
  | 'invalid-discard'
  | 'invalid-trade'
  | 'invalid-robber-move'
  | 'invalid-victim'
  | 'card-not-playable'
  | 'location-frozen'
  | 'already-declared'
  | 'unknown-intent'
  | 'game-over';

export type CommandResult =
  | { readonly ok: true; readonly events: readonly DomainEvent[]; readonly duplicate?: boolean }
  | { readonly ok: false; readonly reason: RejectionReason; readonly detail?: string };
