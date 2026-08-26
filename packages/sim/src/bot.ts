/**
 * Interface des bots et catalogue des coups légaux.
 *
 * Les bots n'ont pas besoin d'être intelligents. Leur rôle n'est pas de bien
 * jouer mais de **faire tourner des milliers de parties** pour détecter les
 * règles cassées, les blocages, et mesurer l'équilibrage. Un bot qui joue mal
 * mais qui joue vite vaut mieux ici qu'un bon joueur lent.
 */

import {
  type Command,
  type GameState,
  type PlayerId,
  type VertexId,
  COSTS,
  canAfford,
  canPlaceRoad,
  canPlaceSettlement,
  canUpgradeToCity,
  playerOf,
} from '@grand-colonies/engine';

export interface Bot {
  readonly name: string;
  /**
   * La prochaine commande à jouer, ou `undefined` si le bot ne souhaite plus
   * agir pendant cette phase. Le simulateur l'appelle en boucle.
   */
  decide(state: GameState, playerId: PlayerId, actionId: string): Command | undefined;
}

/** Emplacements de colonie disponibles, triés pour rester déterministes. */
export function openSettlements(state: GameState, playerId: PlayerId, setup: boolean): VertexId[] {
  return [...state.board.graph.vertices]
    .sort()
    .filter((v) => canPlaceSettlement(state.board, v, playerId, { setupPhase: setup }).ok);
}

export function openRoads(state: GameState, playerId: PlayerId): string[] {
  return [...state.board.graph.edges]
    .sort()
    .filter((e) => canPlaceRoad(state.board, e, playerId).ok);
}

/** Colonies à soi, améliorables en ville. */
export function upgradableSettlements(state: GameState, playerId: PlayerId): VertexId[] {
  return [...state.board.allBuildings().entries()]
    .filter(([vertex, building]) =>
      building.owner === playerId && canUpgradeToCity(state.board, vertex, playerId).ok)
    .map(([vertex]) => vertex)
    .sort();
}

/**
 * Les constructions que le joueur peut réellement payer et poser.
 *
 * Sert de socle aux deux bots : l'un y pioche au hasard, l'autre par ordre
 * de préférence.
 */
export function affordableBuilds(state: GameState, playerId: PlayerId): Command['type'][] {
  const player = playerOf(state, playerId);
  if (!player) return [];

  const options: Command['type'][] = [];

  if (player.citiesLeft > 0
      && canAfford(player.hand, COSTS.city)
      && upgradableSettlements(state, playerId).length > 0) {
    options.push('BUILD_CITY');
  }
  if (player.settlementsLeft > 0
      && canAfford(player.hand, COSTS.settlement)
      && openSettlements(state, playerId, false).length > 0) {
    options.push('BUILD_SETTLEMENT');
  }
  if (player.roadsLeft > 0
      && canAfford(player.hand, COSTS.road)
      && openRoads(state, playerId).length > 0) {
    options.push('BUILD_ROAD');
  }
  if (state.deck.length > 0 && canAfford(player.hand, COSTS.devCard)) {
    options.push('BUY_DEV_CARD');
  }

  return options;
}
