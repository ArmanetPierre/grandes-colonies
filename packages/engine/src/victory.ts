/**
 * Points de victoire et fin de partie.
 *
 * Le barème suit le §22 du game design. Le seuil de 15 points, plus élevé
 * qu'au Catan classique, est la contrepartie d'une carte beaucoup plus
 * grande : il faut qu'une partie à douze reste une course et non un sprint.
 */

import type { Board, PlayerId } from './board/board.js';
import { largestArmyHolder } from './largestArmy.js';
import { longestRouteHolder } from './longestRoute.js';

export interface VictoryConfig {
  readonly target: number;
  readonly settlement: number;
  readonly city: number;
  readonly metropolis: number;
  readonly secretObjective: number;
  readonly longestRoute: number;
  readonly largestArmy: number;
  readonly defenderToken: number;
  readonly majorExploration: number;
  readonly monument: number;
}

export const GRAND_COLONIES_VICTORY: VictoryConfig = Object.freeze({
  target: 15,
  settlement: 1,
  city: 2,
  metropolis: 3,
  secretObjective: 2,
  longestRoute: 2,
  largestArmy: 2,
  defenderToken: 1,
  majorExploration: 1,
  monument: 2,
});

export const CLASSIC_VICTORY: VictoryConfig = Object.freeze({
  ...GRAND_COLONIES_VICTORY,
  target: 10,
});

/**
 * Ce que le plateau ne peut pas dire de lui-même : titres, objectifs
 * secrets, jetons gagnés contre les barbares.
 */
export interface VictoryExtras {
  readonly secretObjectivesCompleted?: number;
  readonly defenderTokens?: number;
  readonly majorExplorations?: number;
  readonly monuments?: number;
  readonly metropolises?: number;
  readonly hasLongestRoute?: boolean;
  readonly hasLargestArmy?: boolean;
}

export interface VictoryBreakdown {
  readonly settlements: number;
  readonly cities: number;
  readonly metropolises: number;
  readonly secretObjectives: number;
  readonly longestRoute: number;
  readonly largestArmy: number;
  readonly defenderTokens: number;
  readonly majorExplorations: number;
  readonly monuments: number;
  readonly total: number;
}

/**
 * Le détail des points d'un joueur.
 *
 * On renvoie la ventilation plutôt qu'un total : l'écran de fin de partie
 * doit montrer d'où viennent les points, et un joueur en cours de partie doit
 * pouvoir comprendre pourquoi son voisin le devance.
 */
export function victoryBreakdown(
  board: Board,
  player: PlayerId,
  extras: VictoryExtras = {},
  config: VictoryConfig = GRAND_COLONIES_VICTORY,
): VictoryBreakdown {
  let settlements = 0;
  let cities = 0;
  for (const building of board.allBuildings().values()) {
    if (building.owner !== player) continue;
    if (building.kind === 'settlement') settlements++;
    else cities++;
  }

  const metropolises = extras.metropolises ?? 0;
  const objectives = extras.secretObjectivesCompleted ?? 0;
  const defenders = extras.defenderTokens ?? 0;
  const explorations = extras.majorExplorations ?? 0;
  const monuments = extras.monuments ?? 0;

  const breakdown = {
    settlements: settlements * config.settlement,
    // Une métropole est une ville améliorée : ses points remplacent ceux de
    // la ville, ils ne s'y ajoutent pas.
    cities: (cities - metropolises) * config.city,
    metropolises: metropolises * config.metropolis,
    secretObjectives: objectives * config.secretObjective,
    longestRoute: extras.hasLongestRoute ? config.longestRoute : 0,
    largestArmy: extras.hasLargestArmy ? config.largestArmy : 0,
    defenderTokens: defenders * config.defenderToken,
    majorExplorations: explorations * config.majorExploration,
    monuments: monuments * config.monument,
  };

  const total = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  return Object.freeze({ ...breakdown, total });
}

export function victoryPoints(
  board: Board,
  player: PlayerId,
  extras: VictoryExtras = {},
  config: VictoryConfig = GRAND_COLONIES_VICTORY,
): number {
  return victoryBreakdown(board, player, extras, config).total;
}

export interface StandingsInput {
  readonly players: readonly PlayerId[];
  readonly knightsPlayed: ReadonlyMap<PlayerId, number>;
  readonly extras?: ReadonlyMap<PlayerId, VictoryExtras>;
  readonly longestRouteHolder?: PlayerId;
  readonly largestArmyHolder?: PlayerId;
}

export interface Standings {
  readonly points: ReadonlyMap<PlayerId, VictoryBreakdown>;
  readonly longestRoute: PlayerId | undefined;
  readonly largestArmy: PlayerId | undefined;
  readonly winner: PlayerId | undefined;
}

/**
 * Classement complet : les deux titres sont recalculés d'abord, puisqu'ils
 * valent deux points chacun et peuvent à eux seuls faire basculer la partie.
 */
export function computeStandings(
  board: Board,
  input: StandingsInput,
  config: VictoryConfig = GRAND_COLONIES_VICTORY,
): Standings {
  const route = longestRouteHolder(board, input.players, input.longestRouteHolder);
  const army = largestArmyHolder(input.knightsPlayed, input.largestArmyHolder);

  const points = new Map<PlayerId, VictoryBreakdown>();
  for (const player of input.players) {
    const extras: VictoryExtras = {
      ...(input.extras?.get(player) ?? {}),
      hasLongestRoute: route?.player === player,
      hasLargestArmy: army?.player === player,
    };
    points.set(player, victoryBreakdown(board, player, extras, config));
  }

  // Un seul vainqueur : le premier joueur de la liste à atteindre le seuil.
  // L'ordre du tableau fait foi, ce qui reflète l'ordre du tour.
  let winner: PlayerId | undefined;
  for (const player of input.players) {
    if ((points.get(player)?.total ?? 0) >= config.target) {
      winner = player;
      break;
    }
  }

  return Object.freeze({
    points,
    longestRoute: route?.player,
    largestArmy: army?.player,
    winner,
  });
}
