/**
 * État autoritaire d'une partie.
 *
 * L'état est mutable, mais un seul chemin le modifie : `resolve`. Aucune
 * autre fonction n'y touche, et le serveur sérialise les commandes avant de
 * les lui passer. Le déterminisme ne vient donc pas de l'immuabilité mais de
 * cette discipline — même état initial, même graine, mêmes commandes dans le
 * même ordre produisent le même résultat, ce qui suffit au rejeu.
 */

import { Board, type BoardInit, type PlayerId } from '../board/board.js';
import type { VertexId } from '../board/graph.js';
import { type DevCardHolding, EMPTY_HOLDING } from '../devCards.js';
import { type MarketState, createMarket } from '../market.js';
import { type ResourceCounts, EMPTY, counts } from '../resources.js';
import { SeededRandom } from '../rng.js';
import type { DevCardKind } from '../devCards.js';
import type { GameConfig } from './config.js';
import type { BuildIntent } from './buildIntent.js';
import type { TradeOffer } from './trade.js';
import { type ObjectiveId, availableObjectives } from '../objectives.js';
import { type BarbarianState, initialBarbarians } from '../barbarians.js';

/**
 * Les phases d'un cycle, telles que fixées par RULES_CONTRACT.md §1.
 *
 * Trois temps et non cinq : les phases B et C du game design sont fusionnées,
 * le joueur actif et son associé jouant simultanément. C'est le seul
 * découpage compatible avec la durée de partie visée — en séquentiel, un tour
 * de table à douze passerait de 24 à 42 minutes.
 */
export type Phase = 'setup' | 'production' | 'activeTurn' | 'freeTrade' | 'ended';

export interface PlayerState {
  readonly id: PlayerId;
  /** Modifiable : le joueur choisit son nom en rejoignant sa place. */
  name: string;
  hand: ResourceCounts;
  devCards: DevCardHolding;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  /** Le monument est unique par joueur : posé ou non, rien d'autre. */
  hasMonument: boolean;
  /** Îles secondaires atteintes le premier — 1 point chacune (contrat §9). */
  explorations: number;
  /**
   * Jetons « Défenseur de Catan », gagnés en menant la défense contre une
   * invasion barbare (§16). Un point de victoire et un point d'Influence
   * chacun.
   */
  barbarianDefences: number;
  /** Cartes à défausser après un 7 ; zéro le reste du temps. */
  mustDiscard: number;

  /**
   * Les deux objectifs proposés au joueur, dont il n'en conserve qu'un (§21).
   * Information privée : jamais transmise aux autres clients.
   */
  offeredObjectives: ObjectiveId[];
  /**
   * L'objectif retenu. Tant qu'il est absent, le premier des deux fait foi —
   * même principe que la validation automatique du contrat §2 : ne pas
   * choisir ne doit jamais bloquer la partie.
   */
  chosenObjective: ObjectiveId | undefined;
}

export interface GameState {
  readonly config: GameConfig;
  readonly board: Board;
  readonly players: readonly PlayerState[];
  readonly seed: number | string;

  phase: Phase;
  cycle: number;
  /** Index du joueur actif dans `players`. */
  activeIndex: number;
  lastRoll: { readonly a: number; readonly b: number; readonly total: number } | undefined;
  /**
   * Lancer imposé par le maître de jeu (§22), consommé au prochain `ROLL_DICE`.
   *
   * Posé plutôt que résolu sur-le-champ : qui force un 7 veut voir la
   * défausse et le voleur se dérouler normalement, et c'est `rollDice` qui
   * sait faire tout cela.
   */
  forcedRoll: { readonly a: number; readonly b: number } | undefined;

  bank: ResourceCounts;
  /**
   * Cours du marché (§10). Il a la mémoire de toute la partie : le remettre
   * à zéro à chaque cycle reviendrait à ne plus avoir de marché du tout.
   */
  market: MarketState;
  deck: DevCardKind[];
  rng: SeededRandom;

  /** Piste de menace barbare (§16). */
  barbarians: BarbarianState;

  longestRouteHolder: PlayerId | undefined;
  largestArmyHolder: PlayerId | undefined;
  winner: PlayerId | undefined;

  /**
   * Commandes déjà appliquées, par `actionId`.
   *
   * Un joueur dont le réseau rame clique deux fois : le serveur reçoit deux
   * commandes identiques et ne doit en exécuter qu'une.
   */
  readonly appliedActions: Set<string>;

  /** Mise en place : ordre de passage restant, en aller-retour. */
  setupQueue: PlayerId[];
  /**
   * Colonie posée en attente de sa route. Pendant la mise en place, chaque
   * joueur pose une colonie puis la route qui en part : ce champ mémorise
   * laquelle, pour vérifier que la route y touche bien.
   */
  setupPendingVertex: VertexId | undefined;

  /**
   * Un 7 vient d'être lancé et le voleur n'a pas encore été déplacé.
   * Tant qu'il est vrai, le joueur actif ne peut rien faire d'autre.
   */
  pendingRobber: boolean;

  /** Annonces de construction en attente de résolution (contrat §3). */
  intents: BuildIntent[];
  /**
   * Rang d'arrivée de la prochaine annonce. Un compteur et non une horloge :
   * il départage les annonces sans jamais reculer.
   */
  intentCounter: number;
  /** Emplacements gelés jusqu'à la fin du cycle en cours. */
  frozenLocations: Set<string>;
  /**
   * Îles secondaires déjà atteintes, par identifiant.
   *
   * Seul le premier arrivé marque : sans cette trace, chaque colonie posée
   * sur une île rapporterait un point de plus.
   */
  exploredIslands: Set<string>;

  /** Offres d'échange en cours. Vidées à chaque fin de cycle. */
  offers: TradeOffer[];
  offerCounter: number;
}

export interface NewGameOptions {
  readonly players: readonly { readonly id: PlayerId; readonly name: string }[];
  readonly board: BoardInit;
  readonly config: GameConfig;
  readonly seed: number | string;
  /** Stock initial de la banque. */
  readonly bank?: ResourceCounts;
}

/** Stock de banque par défaut : généreux, la pénurie doit rester exceptionnelle. */
const DEFAULT_BANK: ResourceCounts = counts({
  wood: 60, brick: 60, wool: 60, grain: 60, ore: 60, gold: 40, fish: 40,
});

/**
 * Ordre de la mise en place, en aller-retour.
 *
 * Le premier joueur pose en premier puis en dernier : c'est ce qui compense
 * l'avantage du premier tour, et l'effet est d'autant plus marqué à douze
 * joueurs qu'à quatre.
 */
export function setupOrder(players: readonly PlayerId[]): PlayerId[] {
  return [...players, ...[...players].reverse()];
}

export function createGame(options: NewGameOptions): GameState {
  const rng = new SeededRandom(options.seed);

  const players: PlayerState[] = options.players.map((p) => ({
    id: p.id,
    name: p.name,
    hand: EMPTY,
    devCards: EMPTY_HOLDING,
    roadsLeft: options.config.roadsPerPlayer,
    settlementsLeft: options.config.settlementsPerPlayer,
    citiesLeft: options.config.citiesPerPlayer,
    hasMonument: false,
    barbarianDefences: 0,
    explorations: 0,
    mustDiscard: 0,
    offeredObjectives: [],
    chosenObjective: undefined,
  }));

  // Deux objectifs par joueur, tirés dans le paquet mélangé par la graine.
  const pool = rng.shuffle(availableObjectives());
  players.forEach((player, index) => {
    const first = pool[(index * 2) % pool.length];
    const second = pool[(index * 2 + 1) % pool.length];
    player.offeredObjectives = [first, second].filter((o): o is ObjectiveId => o !== undefined);
  });

  return {
    config: options.config,
    board: new Board(options.board),
    players,
    seed: options.seed,
    phase: 'setup',
    cycle: 0,
    activeIndex: 0,
    lastRoll: undefined,
    bank: options.bank ?? DEFAULT_BANK,
    market: createMarket(),
    deck: [],
    rng,
    forcedRoll: undefined,
    barbarians: initialBarbarians(),
    longestRouteHolder: undefined,
    largestArmyHolder: undefined,
    winner: undefined,
    appliedActions: new Set(),
    setupQueue: setupOrder(players.map((p) => p.id)),
    setupPendingVertex: undefined,
    pendingRobber: false,
    intents: [],
    intentCounter: 0,
    frozenLocations: new Set(),
    exploredIslands: new Set(),
    offers: [],
    offerCounter: 0,
  };
}

export function playerOf(state: GameState, id: PlayerId): PlayerState | undefined {
  return state.players.find((p) => p.id === id);
}

export function activePlayer(state: GameState): PlayerState {
  const player = state.players[state.activeIndex];
  if (!player) throw new Error('Aucun joueur actif : état incohérent');
  return player;
}

/** Le joueur associé : trois positions à gauche de l'actif (§7). */
export function pairedPlayer(state: GameState): PlayerState | undefined {
  if (state.players.length < 4) return undefined;
  const index = (state.activeIndex + 3) % state.players.length;
  return state.players[index];
}

/** L'objectif effectivement en jeu pour ce joueur. */
export function activeObjective(player: PlayerState): ObjectiveId | undefined {
  return player.chosenObjective ?? player.offeredObjectives[0];
}

export function playerIds(state: GameState): PlayerId[] {
  return state.players.map((p) => p.id);
}
