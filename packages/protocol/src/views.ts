/**
 * Vues publique et privée — la frontière du secret.
 *
 * Règle de fond : **ce qui reste secret ne quitte jamais le serveur.** Il ne
 * suffit pas de compter sur le client pour ne pas l'afficher — un client
 * modifié lirait tout ce qu'on lui envoie. La séparation est donc faite ici,
 * à la source, et le serveur n'a le droit d'envoyer qu'une vue.
 *
 * **Les ressources, elles, sont publiques.** La vue publique dit non
 * seulement *combien* de cartes tient un joueur, mais lesquelles. C'est un
 * choix de jeu assumé et non un oubli : à douze joueurs, une négociation à
 * l'aveugle tourne à la devinette et fait traîner chaque tour, alors qu'un
 * inventaire ouvert laisse proposer un échange qui a une chance d'aboutir.
 * Le prix payé est réel — le bluff sur ce qu'on possède disparaît — et il est
 * payé sciemment.
 *
 * Restent secrets : les cartes développement en main, les objectifs secrets
 * et le contenu de la pioche. Eux ne sont pas des ressources et rien ici ne
 * les révèle.
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
  bankRate,
  getCapabilities,
  heldCount,
  knightsPlayed,
  RESOURCES,
  canPlaceRoad,
  canAcceptTrade,
  canRaiseMonument,
  isAddressedTo,
  canUpgradeToCity,
  canUpgradeToMetropolis,
  metropolisesBuilt,
  robberVictims,
  playerOf,
  playerPoints,
  maritimeSpots,
  roadSpots,
  marketDrift,
  marketRate,
  portKindsOf,
  roleOf,
  settlementSpots,
  total,
} from '@grand-colonies/engine';

export interface PublicPlayer {
  readonly id: PlayerId;
  readonly name: string;
  readonly role: PlayerRole;
  /** Points visibles de tous. L'objectif secret n'y est pas compté. */
  readonly publicPoints: number;
  /** Nombre total de cartes ressource. Redondant avec `hand`, gardé parce
   * que c'est lui qu'on affiche quand la place manque — une pastille, une
   * ligne de tableau — sans avoir à resommer sept quantités à chaque rendu. */
  readonly handSize: number;
  /**
   * L'inventaire détaillé, ressource par ressource.
   *
   * Public, contrairement à l'usage de Catan : voir l'en-tête du fichier. Les
   * quantités nulles sont absentes plutôt que mises à zéro, comme partout
   * ailleurs dans le moteur (`counts` élague), ce qui évite d'envoyer sept
   * champs par joueur à chaque diffusion — à douze joueurs et plusieurs
   * diffusions par seconde, ce n'est pas rien.
   */
  readonly hand: ResourceCounts;
  readonly devCardCount: number;
  readonly knightsPlayed: number;
  readonly roadsLeft: number;
  readonly settlementsLeft: number;
  readonly citiesLeft: number;
  /**
   * Monument élevé ? Public, comme la construction elle-même.
   *
   * Sans lui, le score d'un joueur bondirait de deux points sans cause
   * visible sur le plateau : le monument n'occupe pas de sommet à lui.
   */
  readonly hasMonument: boolean;
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

/**
 * Le cours du marché, vu de la table (§10).
 *
 * Public par nécessité : un marché que chacun découvrirait en cliquant ne
 * serait pas un marché. C'est justement de le voir monter qu'on décide de
 * vendre son bois maintenant plutôt qu'au prochain cycle.
 */
export interface PublicMarket {
  /** Cours nu, avant la remise des ports : le prix affiché à tous. */
  readonly rates: Readonly<Record<string, number>>;
  /**
   * Transactions accumulées vers le prochain cran, signées.
   *
   * Positif : la ressource s'abîme et coûtera bientôt une carte de plus.
   * Zéro quand le cours est bloqué contre sa borne — mieux vaut ne rien
   * promettre que d'annoncer un mouvement qui n'aura jamais lieu.
   */
  readonly drift: Readonly<Record<string, number>>;
  /** Transactions nettes qu'il faut pour bouger d'un cran. */
  readonly step: number;
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
  readonly market: PublicMarket;
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
   * La partie est-elle suspendue par l'hôte ?
   *
   * Public et non déduit du chronomètre arrêté : un client qui verrait
   * seulement le compte à rebours figé ne saurait pas dire si l'hôte a mis en
   * pause ou si sa connexion a lâché — et ces deux situations n'appellent
   * pas du tout le même geste de la part du joueur.
   */
  readonly paused: boolean;
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
   * Offres que ce joueur peut accepter à cet instant.
   *
   * Calculée par le serveur : la règle dépend de la phase et de qui est
   * actif, et la dupliquer côté client l'aurait fait diverger. C'est elle qui
   * permet d'afficher le commerce à un joueur passif, à qui le joueur actif
   * adresse une offre.
   */
  readonly acceptableOffers: readonly string[];

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
    /** Cités améliorables, tant qu'il reste une métropole à prendre. */
    readonly metropolises: readonly VertexId[];
    /** Cités et métropoles où élever son unique monument. */
    readonly monuments: readonly VertexId[];
    readonly roads: readonly EdgeId[];
    /** Arêtes maritimes praticables — le long de la mer. */
    readonly maritime: readonly EdgeId[];
    readonly robber: readonly HexId[];
    /**
     * Victimes possibles, par hexagone visé.
     *
     * Sans elle le client déplaçait le voleur sans jamais désigner personne,
     * et le vol — la moitié de l'intérêt du voleur — n'avait jamais lieu.
     */
    readonly robberVictims: Readonly<Record<HexId, readonly PlayerId[]>>;
  };

  /**
   * Combien de cartes donner pour en recevoir une, ressource par ressource.
   *
   * Le taux dépend des ports que ce joueur occupe : il lui est donc propre et
   * n'a rien à faire dans la vue publique. Le client en a besoin pour
   * proposer un échange au bon prix plutôt que de supposer 4:1.
   */
  readonly bankRates: Readonly<Record<string, number>>;

  /**
   * Les types de ports que ce joueur occupe.
   *
   * `bankRates` suffit pour les ports qui remisent le cours — la remise y est
   * déjà fondue. Les ports à contrat du §11, eux, ont leur propre échange :
   * sans cette liste, le client n'aurait aucun moyen de savoir qu'il doit en
   * proposer le bouton.
   */
  readonly ports: readonly string[];

  /** Nombre de cartes à défausser, zéro le reste du temps. */
  readonly mustDiscard: number;
}

export interface Connectivity {
  isConnected(playerId: PlayerId): boolean;
  /** Par défaut vrai : le moteur seul ne connaît pas le salon d'attente. */
  readonly started?: boolean;
  /** Par défaut faux : la pause est une décision d'hôte, pas un état de jeu. */
  readonly paused?: boolean;
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
      hand: p.hand,
      devCardCount: heldCount(p.devCards),
      knightsPlayed: knightsPlayed(p.devCards),
      roadsLeft: p.roadsLeft,
      settlementsLeft: p.settlementsLeft,
      citiesLeft: p.citiesLeft,
      hasMonument: p.hasMonument,
      mustDiscard: p.mustDiscard,
      connected: connectivity?.isConnected(p.id) ?? true,
    })),
    offers: state.offers.map((o) => ({
      id: o.id, from: o.from, to: o.to, give: o.give, receive: o.receive,
    })),
    market: marketView(state),
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
    paused: connectivity?.paused ?? false,
    standings: finalStandings(state),
  };
}

/** Le cours de chaque ressource, et vers où il penche. */
function marketView(state: GameState): PublicMarket {
  const rates: Record<string, number> = {};
  const drift: Record<string, number> = {};
  for (const resource of RESOURCES) {
    rates[resource] = marketRate(state.config.market, state.market, resource);
    drift[resource] = marketDrift(state.config.market, state.market, resource);
  }
  return { rates, drift, step: state.config.market.step };
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
  for (const resource of RESOURCES) bankRates[resource] = bankRate(state, playerId, resource);

  return {
    id: playerId,
    spots: buildableSpots(state, playerId, capabilities),
    bankRates,
    ports: portKindsOf(state.board, playerId),
    mustDiscard: player.mustDiscard,
    hand: player.hand,
    playableDevCards: [...player.devCards.playable],
    pendingDevCards: [...player.devCards.pending],
    offeredObjectives: [...player.offeredObjectives],
    chosenObjective: player.chosenObjective,
    objectiveComplete: (breakdown?.secretObjectives ?? 0) > 0,
    points: breakdown?.total ?? 0,
    capabilities,
    acceptableOffers: state.offers
      .filter((offer) => offer.from !== playerId
        && isAddressedTo(offer, playerId)
        && canAcceptTrade(state, playerId, offer))
      .map((offer) => offer.id),
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
  const empty = {
    settlements: [], cities: [], roads: [], maritime: [], robber: [],
    metropolises: [], monuments: [], robberVictims: {},
  };

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

  // Calculées seulement pour les hexagones réellement proposés : les recenser
  // toutes à chaque diffusion, pour douze joueurs, serait du gaspillage.
  const victims: Record<HexId, readonly PlayerId[]> = {};
  for (const hex of robber) {
    const candidates = robberVictims(state, hex, playerId);
    if (candidates.length > 0) victims[hex] = candidates;
  }

  // Un déplacement dû bloque tout le reste : inutile de proposer autre chose.
  if (has('CAN_MOVE_ROBBER')) return { ...empty, robber, robberVictims: victims };

  /**
   * Les cartes Construction de routes et Bâtisseur sont gratuites.
   *
   * Sans ce troisième cas, un joueur à la main vide n'aurait ni `CAN_BUILD`
   * ni `CAN_DECLARE_BUILD` — les deux exigent de pouvoir payer — et recevrait
   * des listes vides : sa carte serait jouable sans aucun endroit où cliquer.
   */
  if (!has('CAN_BUILD') && !has('CAN_DECLARE_BUILD') && !has('CAN_PLAY_DEV_CARD')) {
    return { ...empty, robber, robberVictims: victims };
  }

  const player = playerOf(state, playerId);
  const mine = [...state.board.allBuildings().entries()]
    .filter(([, b]) => b.owner === playerId);

  // Inutile de proposer une amélioration s'il n'en reste aucune à prendre.
  const metropolisLeft = state.config.metropolisesTotal - metropolisesBuilt(state) > 0;

  return {
    settlements: settlementSpots(state.board, playerId),
    cities: mine
      .filter(([vertex]) => canUpgradeToCity(state.board, vertex, playerId).ok)
      .map(([vertex]) => vertex),
    metropolises: metropolisLeft
      ? mine
        .filter(([vertex]) => canUpgradeToMetropolis(state.board, vertex, playerId).ok)
        .map(([vertex]) => vertex)
      : [],
    monuments: player?.hasMonument
      ? []
      : mine
        .filter(([vertex]) => canRaiseMonument(state.board, vertex, playerId).ok)
        .map(([vertex]) => vertex),
    roads: roadSpots(state.board, playerId),
    maritime: maritimeSpots(state.board, playerId),
    robber,
    robberVictims: victims,
  };
}

/** Les objectifs, révélés à tous une fois la partie finie. */
export function revealedObjectives(state: GameState): { player: PlayerId; objective: ObjectiveId | undefined }[] {
  if (state.phase !== 'ended') return [];
  return state.players.map((p) => ({ player: p.id, objective: activeObjective(p) }));
}
