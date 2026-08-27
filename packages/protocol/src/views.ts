/**
 * Vues publique et privée — la frontière du secret.
 *
 * Règle absolue : **une information privée ne quitte jamais le serveur.**
 * Il ne suffit pas de compter sur le client pour ne pas l'afficher — un
 * client modifié lirait tout ce qu'on lui envoie. La séparation est donc
 * faite ici, à la source, et le serveur n'a le droit d'envoyer qu'une vue.
 *
 * Concrètement, la vue publique dit *combien* de cartes tient un joueur,
 * jamais lesquelles. Elle ignore les objectifs secrets et le contenu de la
 * pioche.
 */

import {
  type Capability,
  type EdgeId,
  type GameState,
  type HexId,
  type ObjectiveId,
  type PlayerId,
  type PlayerRole,
  type ResourceCounts,
  type Terrain,
  type VertexId,
  activeObjective,
  getCapabilities,
  heldCount,
  knightsPlayed,
  RESOURCES,
  canPlaceRoad,
  canUpgradeToCity,
  playerPoints,
  roadSpots,
  roleOf,
  settlementSpots,
  total,
  tradeRate,
} from '@grand-colonies/engine';

export interface PublicPlayer {
  readonly id: PlayerId;
  readonly name: string;
  readonly role: PlayerRole;
  /** Points visibles de tous. L'objectif secret n'y est pas compté. */
  readonly publicPoints: number;
  /** Nombre de cartes, jamais leur nature. */
  readonly handSize: number;
  readonly devCardCount: number;
  readonly knightsPlayed: number;
  readonly roadsLeft: number;
  readonly settlementsLeft: number;
  readonly citiesLeft: number;
  readonly mustDiscard: number;
  readonly connected: boolean;
}

export interface PublicHex {
  readonly id: HexId;
  readonly terrain: Terrain;
  readonly token: number | undefined;
  readonly blocked: boolean;
}

export interface PublicOffer {
  readonly id: string;
  readonly from: PlayerId;
  readonly to: PlayerId | undefined;
  readonly give: ResourceCounts;
  readonly receive: ResourceCounts;
}

export interface PublicIntent {
  readonly id: string;
  readonly player: PlayerId;
  readonly location: string;
  readonly contested: boolean;
}

export interface PublicGameView {
  readonly phase: GameState['phase'];
  readonly cycle: number;
  readonly activePlayer: PlayerId | undefined;
  readonly pairedPlayer: PlayerId | undefined;
  readonly lastRoll: { readonly a: number; readonly b: number; readonly total: number } | undefined;
  readonly hexes: readonly PublicHex[];
  readonly buildings: readonly { vertex: VertexId; kind: string; owner: PlayerId }[];
  readonly roads: readonly { edge: EdgeId; owner: PlayerId; kind: string }[];
  readonly ports: readonly { vertex: VertexId; kind: string }[];
  readonly players: readonly PublicPlayer[];
  readonly offers: readonly PublicOffer[];
  readonly intents: readonly PublicIntent[];
  readonly frozenLocations: readonly string[];
  readonly longestRouteHolder: PlayerId | undefined;
  readonly largestArmyHolder: PlayerId | undefined;
  readonly deckRemaining: number;
  readonly winner: PlayerId | undefined;
  readonly handLimit: number;
  readonly victoryTarget: number;
  /**
   * La partie a-t-elle été lancée par l'hôte ?
   *
   * Faux pendant le salon d'attente : le client montre alors qui est arrivé
   * plutôt qu'un plateau sur lequel personne ne peut encore agir.
   */
  readonly started: boolean;
  /**
   * Classement final, révélé seulement quand la partie est finie.
   *
   * Les objectifs secrets y figurent : ils cessent d'être secrets au moment
   * où le décompte est arrêté, et c'est le moment de jeu où l'on veut
   * comprendre d'où venaient les points de chacun.
   */
  readonly standings: readonly {
    readonly player: PlayerId;
    readonly points: number;
    readonly objective: ObjectiveId | undefined;
    readonly objectiveDone: boolean;
  }[];
}

export interface PrivatePlayerView {
  readonly id: PlayerId;
  readonly hand: ResourceCounts;
  readonly playableDevCards: readonly string[];
  readonly pendingDevCards: readonly string[];
  /** Les deux objectifs proposés, et celui retenu. */
  readonly offeredObjectives: readonly ObjectiveId[];
  readonly chosenObjective: ObjectiveId | undefined;
  readonly objectiveComplete: boolean;
  /** Points réels, objectif secret compris — connus du seul intéressé. */
  readonly points: number;
  readonly capabilities: readonly Capability[];

  /**
   * Emplacements où ce joueur peut effectivement construire, calculés par le
   * serveur.
   *
   * Les laisser au client obligerait à y dupliquer les règles de placement,
   * et un client modifié pourrait en proposer d'illégaux. Ils ne sont
   * calculés que lorsque le joueur a la capacité correspondante : à douze
   * joueurs, les recalculer pour tout le monde à chaque diffusion serait du
   * gaspillage.
   */
  readonly spots: {
    readonly settlements: readonly VertexId[];
    readonly cities: readonly VertexId[];
    readonly roads: readonly EdgeId[];
    readonly robber: readonly HexId[];
  };

  /**
   * Combien de cartes donner pour en recevoir une, ressource par ressource.
   *
   * Le taux dépend des ports que ce joueur occupe : il lui est donc propre et
   * n'a rien à faire dans la vue publique. Le client en a besoin pour
   * proposer un échange au bon prix plutôt que de supposer 4:1.
   */
  readonly bankRates: Readonly<Record<string, number>>;

  /** Nombre de cartes à défausser, zéro le reste du temps. */
  readonly mustDiscard: number;
}

export interface Connectivity {
  isConnected(playerId: PlayerId): boolean;
  /** Par défaut vrai : le moteur seul ne connaît pas le salon d'attente. */
  readonly started?: boolean;
}

/** L'état vu par tout le monde. */
export function publicView(state: GameState, connectivity?: Connectivity): PublicGameView {
  const active = state.phase === 'setup' || state.phase === 'ended'
    ? undefined
    : state.players[state.activeIndex]?.id;

  const paired = state.players.length >= 4 && active !== undefined
    ? state.players[(state.activeIndex + 3) % state.players.length]?.id
    : undefined;

  // Un emplacement est contesté dès que deux annonces le visent.
  const perLocation = new Map<string, number>();
  for (const intent of state.intents) {
    const key = intent.target.kind === 'road' ? `e:${intent.target.edge}` : `v:${intent.target.vertex}`;
    perLocation.set(key, (perLocation.get(key) ?? 0) + 1);
  }

  return {
    phase: state.phase,
    cycle: state.cycle,
    activePlayer: active,
    pairedPlayer: paired,
    lastRoll: state.lastRoll,
    hexes: [...state.board.allHexData()].map(([id, data]) => ({
      id,
      terrain: data.terrain,
      token: data.token,
      blocked: state.board.isBlocked(id),
    })),
    buildings: [...state.board.allBuildings()].map(([vertex, b]) => ({
      vertex, kind: b.kind, owner: b.owner,
    })),
    roads: [...state.board.allRoutes()].map(([edge, r]) => ({
      edge, owner: r.owner, kind: r.kind,
    })),
    ports: [...state.board.allPorts()].map(([vertex, p]) => ({ vertex, kind: p.kind })),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      role: roleOf(state, p.id),
      // Le total public exclut l'objectif secret : le révéler par le score
      // reviendrait à ne plus avoir de secret du tout.
      publicPoints: publicPointsOf(state, p.id),
      handSize: total(p.hand),
      devCardCount: heldCount(p.devCards),
      knightsPlayed: knightsPlayed(p.devCards),
      roadsLeft: p.roadsLeft,
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
      mustDiscard: p.mustDiscard,
      connected: connectivity?.isConnected(p.id) ?? true,
    })),
    offers: state.offers.map((o) => ({
      id: o.id, from: o.from, to: o.to, give: o.give, receive: o.receive,
    })),
    intents: state.intents.map((i) => {
      const key = i.target.kind === 'road' ? `e:${i.target.edge}` : `v:${i.target.vertex}`;
      return {
        id: i.id,
        player: i.player,
        location: key,
        contested: (perLocation.get(key) ?? 0) > 1,
      };
    }),
    frozenLocations: [...state.frozenLocations],
    longestRouteHolder: state.longestRouteHolder,
    largestArmyHolder: state.largestArmyHolder,
    deckRemaining: state.deck.length,
    winner: state.winner,
    handLimit: state.config.handLimit,
    victoryTarget: state.config.victory.target,
    started: connectivity?.started ?? true,
    standings: finalStandings(state),
  };
}

/** Vide tant que la partie dure : rien ne doit fuir avant la fin. */
function finalStandings(state: GameState): PublicGameView['standings'] {
  if (state.phase !== 'ended') return [];

  return state.players
    .map((player) => {
      const breakdown = playerPoints(state, player.id);
      return {
        player: player.id,
        points: breakdown?.total ?? 0,
        objective: activeObjective(player),
        objectiveDone: (breakdown?.secretObjectives ?? 0) > 0,
      };
    })
    .sort((a, b) => b.points - a.points);
}

/** Le score visible : tout sauf l'objectif secret. */
function publicPointsOf(state: GameState, playerId: PlayerId): number {
  const breakdown = playerPoints(state, playerId);
  if (!breakdown) return 0;
  return breakdown.total - breakdown.secretObjectives;
}

/** Ce que seul l'intéressé reçoit. */
export function privateView(state: GameState, playerId: PlayerId): PrivatePlayerView | undefined {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return undefined;

  const breakdown = playerPoints(state, playerId);
  const capabilities = [...getCapabilities(state, playerId)];

  const bankRates: Record<string, number> = {};
  for (const resource of RESOURCES) bankRates[resource] = tradeRate(state.board, playerId, resource);

  return {
    id: playerId,
    spots: buildableSpots(state, playerId, capabilities),
    bankRates,
    mustDiscard: player.mustDiscard,
    hand: player.hand,
    playableDevCards: [...player.devCards.playable],
    pendingDevCards: [...player.devCards.pending],
    offeredObjectives: [...player.offeredObjectives],
    chosenObjective: player.chosenObjective,
    objectiveComplete: (breakdown?.secretObjectives ?? 0) > 0,
    points: breakdown?.total ?? 0,
    capabilities,
  };
}

/**
 * Où ce joueur peut poser quelque chose, maintenant.
 *
 * Chaque liste n'est remplie que si la capacité correspondante est acquise,
 * ce qui évite de parcourir les cent cinquante sommets d'un plateau XXL pour
 * douze joueurs à chaque diffusion.
 */
function buildableSpots(
  state: GameState,
  playerId: PlayerId,
  capabilities: readonly Capability[],
): PrivatePlayerView['spots'] {
  const has = (capability: Capability): boolean => capabilities.includes(capability);
  const empty = { settlements: [], cities: [], roads: [], robber: [] };

  if (has('CAN_PLACE_SETUP')) {
    // Pendant la mise en place, la colonie précède sa route.
    const pending = state.setupPendingVertex;
    return pending === undefined
      ? { ...empty, settlements: settlementSpots(state.board, playerId, { setupPhase: true }) }
      : {
          ...empty,
          roads: state.board.graph
            .edgesOfVertexOnBoard(pending)
            .filter((edge) => canPlaceRoad(state.board, edge, playerId).ok),
        };
  }

  // Cibles du voleur : pour le déplacement dû comme pour un chevalier en
  // main, qui a besoin des mêmes hexagones avant même le lancer de dés.
  const robber = has('CAN_MOVE_ROBBER') || has('CAN_PLAY_KNIGHT')
    ? [...state.board.allHexData().keys()].filter((id) => !state.board.isBlocked(id))
    : [];

  // Un déplacement dû bloque tout le reste : inutile de proposer autre chose.
  if (has('CAN_MOVE_ROBBER')) return { ...empty, robber };

  /**
   * Les cartes Construction de routes et Bâtisseur sont gratuites.
   *
   * Sans ce troisième cas, un joueur à la main vide n'aurait ni `CAN_BUILD`
   * ni `CAN_DECLARE_BUILD` — les deux exigent de pouvoir payer — et recevrait
   * des listes vides : sa carte serait jouable sans aucun endroit où cliquer.
   */
  if (!has('CAN_BUILD') && !has('CAN_DECLARE_BUILD') && !has('CAN_PLAY_DEV_CARD')) {
    return { ...empty, robber };
  }

  return {
    settlements: settlementSpots(state.board, playerId),
    cities: [...state.board.allBuildings().entries()]
      .filter(([vertex, b]) => b.owner === playerId && canUpgradeToCity(state.board, vertex, playerId).ok)
      .map(([vertex]) => vertex),
    roads: roadSpots(state.board, playerId),
    robber,
  };
}

/** Les objectifs, révélés à tous une fois la partie finie. */
export function revealedObjectives(state: GameState): { player: PlayerId; objective: ObjectiveId | undefined }[] {
  if (state.phase !== 'ended') return [];
  return state.players.map((p) => ({ player: p.id, objective: activeObjective(p) }));
}
