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
import type { ContractPort } from '../ports.js';
import type { Resource, ResourceCounts } from '../resources.js';
import type { Phase } from './state.js';
import type { IntentTarget } from './buildIntent.js';
import type { ObjectiveId } from '../objectives.js';

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
  | (CommandBase & { readonly type: 'BUILD_MARITIME_ROUTE'; readonly edge: EdgeId })
  | (CommandBase & { readonly type: 'BUILD_SETTLEMENT'; readonly vertex: VertexId })
  | (CommandBase & { readonly type: 'BUILD_CITY'; readonly vertex: VertexId })
  | (CommandBase & { readonly type: 'BUILD_METROPOLIS'; readonly vertex: VertexId })
  | (CommandBase & { readonly type: 'BUILD_MONUMENT'; readonly vertex: VertexId })
  | (CommandBase & { readonly type: 'BUY_DEV_CARD' })
  | (CommandBase & { readonly type: 'PLAY_KNIGHT'; readonly from?: HexId; readonly to: HexId; readonly victim?: PlayerId })
  | (CommandBase & { readonly type: 'PLAY_ROAD_BUILDING'; readonly edges: readonly EdgeId[] })
  | (CommandBase & { readonly type: 'PLAY_INVENTION'; readonly resources: ResourceCounts })
  | (CommandBase & { readonly type: 'PLAY_MONOPOLY'; readonly resource: Resource })
  | (CommandBase & { readonly type: 'PLAY_FREE_BUILD'; readonly target: IntentTarget })
  | (CommandBase & { readonly type: 'TRADE_WITH_BANK'; readonly give: ResourceCounts; readonly receive: ResourceCounts })
  /**
   * Échange à un port à contrat (§11).
   *
   * Le type de port voyage avec la commande plutôt que d'être deviné : deux
   * minerai contre un or peuvent venir du port minier comme du cours
   * ordinaire, et le moteur doit savoir lequel valider.
   */
  | (CommandBase & { readonly type: 'TRADE_AT_PORT'; readonly port: ContractPort; readonly give: ResourceCounts; readonly receive: ResourceCounts })
  | (CommandBase & { readonly type: 'DECLARE_BUILD'; readonly target: IntentTarget })
  | (CommandBase & { readonly type: 'CANCEL_BUILD'; readonly intentId: string })
  | (CommandBase & { readonly type: 'END_TURN' })
  | (CommandBase & { readonly type: 'CHOOSE_OBJECTIVE'; readonly objective: ObjectiveId })
  | (CommandBase & { readonly type: 'CREATE_TRADE'; readonly to?: PlayerId; readonly give: ResourceCounts; readonly receive: ResourceCounts })
  | (CommandBase & { readonly type: 'CANCEL_TRADE'; readonly offerId: string })
  | (CommandBase & { readonly type: 'ACCEPT_TRADE'; readonly offerId: string })
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
  | { readonly type: 'MaritimeRoutePlaced'; readonly player: PlayerId; readonly edge: EdgeId }
  | { readonly type: 'IslandReached'; readonly player: PlayerId; readonly island: string }
  | { readonly type: 'CityBuilt'; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: 'MetropolisBuilt'; readonly player: PlayerId; readonly vertex: VertexId; readonly remaining: number }
  | { readonly type: 'MonumentRaised'; readonly player: PlayerId; readonly vertex: VertexId }
  | { readonly type: 'DiceRolled'; readonly player: PlayerId; readonly a: number; readonly b: number; readonly total: number }
  | { readonly type: 'ResourcesProduced'; readonly gains: ReadonlyMap<PlayerId, ResourceCounts> }
  | { readonly type: 'DiscardRequired'; readonly players: ReadonlyMap<PlayerId, number> }
  | { readonly type: 'ResourcesDiscarded'; readonly player: PlayerId; readonly resources: ResourceCounts }
  | { readonly type: 'RobberMoved'; readonly player: PlayerId; readonly from: HexId | undefined; readonly to: HexId }
  | { readonly type: 'ResourceStolen'; readonly thief: PlayerId; readonly victim: PlayerId; readonly resource: Resource }
  | { readonly type: 'DevCardBought'; readonly player: PlayerId; readonly card: DevCardKind }
  | { readonly type: 'DevCardPlayed'; readonly player: PlayerId; readonly card: DevCardKind }
  | { readonly type: 'MonopolyResolved'; readonly player: PlayerId; readonly resource: Resource; readonly taken: readonly { readonly from: PlayerId; readonly count: number }[] }
  | { readonly type: 'ResourcesGranted'; readonly player: PlayerId; readonly resources: ResourceCounts }
  | { readonly type: 'BankTraded'; readonly player: PlayerId; readonly give: ResourceCounts; readonly receive: ResourceCounts }
  /** Échange à un port à contrat — hors marché, donc sans MarketMoved. */
  | { readonly type: 'PortTraded'; readonly player: PlayerId; readonly port: ContractPort; readonly give: ResourceCounts; readonly receive: ResourceCounts }
  /** Le cours d'une ressource a franchi un cran (§10). Public : tout le monde commerce dessus. */
  | { readonly type: 'MarketMoved'; readonly resource: Resource; readonly from: number; readonly to: number }
  | { readonly type: 'TitleChanged'; readonly title: 'longestRoute' | 'largestArmy'; readonly from: PlayerId | undefined; readonly to: PlayerId | undefined }
  | { readonly type: 'PhaseChanged'; readonly from: Phase; readonly to: Phase }
  | { readonly type: 'TurnEnded'; readonly player: PlayerId; readonly cycle: number }
  | { readonly type: 'BuildDeclared'; readonly player: PlayerId; readonly intentId: string; readonly target: IntentTarget }
  | { readonly type: 'BuildCancelled'; readonly player: PlayerId; readonly intentId: string }
  | { readonly type: 'BuildResolved'; readonly player: PlayerId; readonly intentId: string; readonly target: IntentTarget }
  | { readonly type: 'BuildRefunded'; readonly player: PlayerId; readonly intentId: string; readonly reason: 'lost-conflict' | 'no-longer-legal' }
  | { readonly type: 'LocationFrozen'; readonly location: string }
  | { readonly type: 'TradeCreated'; readonly offerId: string; readonly from: PlayerId; readonly to: PlayerId | undefined; readonly give: ResourceCounts; readonly receive: ResourceCounts }
  | { readonly type: 'TradeCancelled'; readonly offerId: string; readonly by: PlayerId }
  | { readonly type: 'TradeAccepted'; readonly offerId: string; readonly from: PlayerId; readonly to: PlayerId }
  | { readonly type: 'TradeExpired'; readonly offerId: string }
  | { readonly type: 'ObjectiveChosen'; readonly player: PlayerId }
  | { readonly type: 'ObjectiveRevealed'; readonly player: PlayerId; readonly objective: ObjectiveId; readonly complete: boolean }
  | { readonly type: 'CycleEnded'; readonly cycle: number }
  /** La piste de menace avance d'une case (§16). */
  | { readonly type: 'BarbariansAdvanced'; readonly progress: number; readonly trackLength: number }
  /**
   * Les barbares attaquent. Tout y est dit d'un coup — force, défense, issue,
   * et qui paie ou qui gagne — parce que c'est un seul événement de table :
   * le raconter en morceaux le rendrait illisible dans le journal comme à
   * l'écran.
   */
  | {
      readonly type: 'BarbariansAttacked';
      readonly strength: number;
      readonly defence: number;
      readonly repelled: boolean;
      readonly champion: PlayerId | undefined;
      /** Absent si l'attaque est repoussée : personne ne perd rien. */
      readonly victim: PlayerId | undefined;
      readonly lostCity: VertexId | undefined;
    }
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
  | 'no-such-port'
  | 'invalid-robber-move'
  | 'invalid-victim'
  | 'card-not-playable'
  | 'location-frozen'
  | 'already-declared'
  | 'unknown-intent'
  | 'not-offered'
  | 'unknown-offer'
  | 'invalid-offer'
  | 'offer-not-for-you'
  | 'unknown-command'
  | 'invalid-selection'
  | 'none-left'
  | 'offer-stale'
  | 'game-over';

export type CommandResult =
  | { readonly ok: true; readonly events: readonly DomainEvent[]; readonly duplicate?: boolean }
  | { readonly ok: false; readonly reason: RejectionReason; readonly detail?: string };
