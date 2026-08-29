/**
 * Simulateur de parties.
 *
 * Il ne mesure pas le temps réel : il compte les **occasions d'agir**. C'est
 * cette grandeur qui décide de l'équilibre du jeu, et c'est elle que le §16
 * du plan de développement met en doute — à douze joueurs, chacun produit à
 * chaque lancer mais n'agit qu'un cycle sur douze.
 */

import {
  type Command,
  type DomainEvent,
  type GameConfig,
  type BoardInit,
  type GameState,
  type PlayerId,
  RESOURCES,
  SeededRandom,
  createGame,
  defaultConfig,
  dispatch,
  marketRate,
  pairedPlayer,
  classicBoard,
  playerPoints,
  total,
  type VictoryBreakdown,
  archipelagoBoard,
  archipelagoOptionsFor,
  usesXxlBoard,
} from '@grand-colonies/engine';

import type { Bot } from './bot.js';

export interface GameOutcome {
  readonly seed: string;
  readonly playerCount: number;
  readonly cycles: number;
  readonly winner: PlayerId | undefined;
  /** Points finaux, dans l'ordre des joueurs. */
  readonly points: readonly number[];
  /**
   * D'où viennent les points de chaque joueur.
   *
   * Un total seul ne dit pas si une source est morte. C'est ainsi qu'on a
   * longtemps mesuré un jeu où la plus grande puissance militaire n'était
   * jamais attribuée, faute de bots jouant leurs chevaliers.
   */
  readonly breakdowns: readonly VictoryBreakdown[];
  /** Tours actifs effectivement joués par chaque joueur. */
  readonly activeTurns: readonly number[];
  /** Constructions posées par chaque joueur. */
  readonly builds: readonly number[];
  /** Nombre de fois où un joueur a dû défausser sur un 7. */
  readonly discards: number;
  /** Offres d'échange proposées entre joueurs. */
  readonly tradesOffered: number;
  /** Offres effectivement acceptées — le taux d'acceptation du §19. */
  readonly tradesAccepted: number;
  /** Conversions passées par la banque, qui seules font bouger le cours. */
  readonly bankTrades: number;
  /** Conversions passées par un port à contrat (§11), qui n'y touchent pas. */
  readonly portTrades: number;
  /**
   * Annonces de construction hors tour (§8) : déposées, abouties, remboursées.
   *
   * La mécanique n'était mesurée nulle part parce qu'aucun bot ne s'en
   * servait. Elle l'est maintenant, et l'écart entre les deux derniers
   * chiffres est ce qui dit si annoncer vaut la peine ou si la table se
   * dispute les mêmes emplacements.
   */
  readonly buildsDeclared: number;
  readonly buildsResolved: number;
  readonly buildsRefunded: number;
  /**
   * Cours de chaque ressource à la fin de la partie (§10).
   *
   * Sans lui, impossible de dire si le marché a réellement vécu ou s'il est
   * resté sur ses valeurs d'ouverture pendant deux cents cycles — c'est la
   * première chose à vérifier après l'avoir branché.
   */
  readonly marketRates: Readonly<Record<string, number>>;
  /** Taille de main moyenne, tous joueurs et tous cycles confondus. */
  readonly averageHand: number;
  /** Plus grande main observée. */
  readonly peakHand: number;
  /** Cycles où au moins un joueur dépassait la limite de main. */
  readonly cyclesOverLimit: number;
  /** Fréquence observée de chaque total de dés. */
  readonly rolls: ReadonlyMap<number, number>;
  /** La partie s'est-elle arrêtée sur la limite plutôt que sur une victoire ? */
  readonly exhausted: boolean;
}

export interface SimulationOptions {
  readonly playerCount: number;
  readonly seed: string;
  readonly makeBot: (index: number, rng: SeededRandom) => Bot;
  readonly config?: GameConfig;
  /** Plateau imposé, pour comparer deux générations à bots égaux. */
  readonly board?: BoardInit;
  /** Garde-fou : au-delà, la partie est déclarée non concluante. */
  readonly maxCycles?: number;
}

/** Joue une partie complète et renvoie ses mesures. */
export function playGame(options: SimulationOptions): GameOutcome {
  const { playerCount, seed } = options;
  const maxCycles = options.maxCycles ?? 400;

  const setupRng = new SeededRandom(`${seed}:board`);
  const botRng = new SeededRandom(`${seed}:bots`);

  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  const config = options.config ?? defaultConfig(playerCount);

  // En dessous de huit joueurs, le plateau XXL disperserait tellement les
  // colonies que la production s'effondrerait.
  const board = options.board ?? (usesXxlBoard(playerCount)
    ? archipelagoBoard(setupRng, archipelagoOptionsFor(playerCount))
    : classicBoard(setupRng));

  const state = createGame({ players, board, config, seed: `${seed}:game` });

  const bots = players.map((_, i) => options.makeBot(i, botRng));

  const activeTurns = new Array<number>(playerCount).fill(0);
  const builds = new Array<number>(playerCount).fill(0);
  const rolls = new Map<number, number>();
  let discards = 0;
  let tradesOffered = 0;
  let tradesAccepted = 0;
  let bankTrades = 0;
  let portTrades = 0;
  let buildsDeclared = 0;
  let buildsResolved = 0;
  let buildsRefunded = 0;
  let handSamples = 0;
  let handTotal = 0;
  let peakHand = 0;
  let cyclesOverLimit = 0;

  let actionId = 0;
  const next = () => `s${actionId++}`;

  const record = (events: readonly DomainEvent[]): void => {
    for (const event of events) {
      if (event.type === 'DiceRolled') rolls.set(event.total, (rolls.get(event.total) ?? 0) + 1);
      if (event.type === 'ResourcesDiscarded') discards++;
      if (event.type === 'TradeCreated') tradesOffered++;
      if (event.type === 'TradeAccepted') tradesAccepted++;
      if (event.type === 'BankTraded') bankTrades++;
      if (event.type === 'PortTraded') portTrades++;
      if (event.type === 'BuildDeclared') buildsDeclared++;
      if (event.type === 'BuildRefunded') buildsRefunded++;
      if (event.type === 'BuildResolved') buildsResolved++;
      /*
       * Une construction annoncée est une construction.
       *
       * Elle n'émet que `BuildResolved` : la compter à part faisait
       * apparaître les bots qui annoncent comme s'ils bâtissaient moins que
       * les autres, alors qu'ils bâtissaient plus tôt.
       */
      if (event.type === 'SettlementPlaced' || event.type === 'CityBuilt'
          || event.type === 'RoadPlaced' || event.type === 'BuildResolved') {
        const index = players.findIndex((p) => p.id === event.player);
        if (index >= 0) builds[index] = (builds[index] ?? 0) + 1;
      }
    }
  };

  const run = (command: Command | undefined): boolean => {
    if (!command) return false;
    const result = dispatch(state, command);
    if (result.ok) record(result.events);
    return result.ok;
  };

  /** Laisse un bot agir jusqu'à ce qu'il n'ait plus rien à jouer. */
  const drain = (index: number, limit = 40): void => {
    const bot = bots[index];
    const player = players[index];
    if (!bot || !player) return;
    for (let i = 0; i < limit; i++) {
      if (!run(bot.decide(state, player.id, next()))) return;
    }
  };

  let guard = 0;
  while (state.phase !== 'ended' && state.cycle <= maxCycles && guard++ < maxCycles * 60) {
    if (state.phase === 'setup') {
      const current = state.setupQueue[0];
      const index = players.findIndex((p) => p.id === current);
      if (index < 0) break;
      drain(index, 4);
      continue;
    }

    const activeIndex = state.activeIndex;

    if (state.phase === 'production') {
      activeTurns[activeIndex] = (activeTurns[activeIndex] ?? 0) + 1;
      drain(activeIndex, 4);
      continue;
    }

    if (state.phase === 'activeTurn') {
      // Une défausse due bloque tout le monde : elle passe avant le reste.
      for (let i = 0; i < playerCount; i++) if ((state.players[i]?.mustDiscard ?? 0) > 0) drain(i, 3);

      drain(activeIndex);
      // Le joueur associé agit dans la même fenêtre (contrat §1).
      const paired = pairedPlayer(state);
      if (paired) {
        const pairedIndex = players.findIndex((p) => p.id === paired.id);
        if (pairedIndex >= 0) drain(pairedIndex);
      }

      sampleHands();
      run({ actionId: next(), playerId: players[activeIndex]?.id ?? '', type: 'END_TURN' });
      continue;
    }

    if (state.phase === 'freeTrade') {
      // Tout le monde négocie pendant la fenêtre, pas seulement l'actif.
      for (let i = 0; i < playerCount; i++) drain(i, 6);
      run({ actionId: next(), playerId: players[activeIndex]?.id ?? '', type: 'END_CYCLE' });
      continue;
    }

    break;
  }

  function sampleHands(): void {
    let over = false;
    for (const player of state.players) {
      const held = total(player.hand);
      handTotal += held;
      handSamples++;
      if (held > peakHand) peakHand = held;
      if (held > config.handLimit) over = true;
    }
    if (over) cyclesOverLimit++;
  }

  // Décompte complet : titres ET objectif secret. Les compter à la main
  // ici avait fait sous-estimer chaque score de deux points.
  const breakdowns = players.map((p) => playerPoints(state, p.id)) as VictoryBreakdown[];
  const points = breakdowns.map((b) => b?.total ?? 0);

  return {
    seed,
    playerCount,
    cycles: state.cycle,
    winner: state.winner,
    points,
    breakdowns,
    activeTurns,
    builds,
    discards,
    tradesOffered,
    tradesAccepted,
    bankTrades,
    portTrades,
    buildsDeclared,
    buildsResolved,
    buildsRefunded,
    marketRates: Object.fromEntries(
      RESOURCES.map((r) => [r, marketRate(config.market, state.market, r)]),
    ),
    averageHand: handSamples === 0 ? 0 : handTotal / handSamples,
    peakHand,
    cyclesOverLimit,
    rolls,
    exhausted: state.winner === undefined,
  };
}
