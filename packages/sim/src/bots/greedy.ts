/**
 * Deux bots simples, suffisants pour mesurer.
 *
 * `GreedyBot` construit dès qu'il peut, par ordre de valeur en points.
 * `RandomBot` choisit au hasard parmi les coups légaux.
 *
 * Comparer les deux donne un repère utile : si le hasard gagne aussi souvent
 * que la cupidité, c'est que les décisions du jeu ne pèsent pas assez.
 */

import {
  type Command,
  type GameState,
  type PlayerId,
  type Resource,
  type SeededRandom,
  CORE_RESOURCES,
  amount,
  counts,
  playerOf,
  suggestDiscard,
} from '@grand-colonies/engine';

import {
  type Bot,
  affordableBuilds,
  openRoads,
  openSettlements,
  upgradableSettlements,
} from '../bot.js';

/** Commandes communes aux deux bots : mise en place, dés, défausse, voleur. */
function mandatoryCommand(
  state: GameState,
  playerId: PlayerId,
  actionId: string,
  pickIndex: (length: number) => number,
): Command | undefined {
  const player = playerOf(state, playerId);
  if (!player) return undefined;

  if (player.mustDiscard > 0) {
    return { actionId, playerId, type: 'DISCARD', resources: suggestDiscard(player.hand, player.mustDiscard) };
  }

  if (state.phase === 'setup') {
    if (state.setupQueue[0] !== playerId) return undefined;

    const pending = state.setupPendingVertex;
    if (pending !== undefined) {
      const edge = state.board.graph
        .edgesOfVertexOnBoard(pending)
        .find((e) => state.board.roadAt(e) === undefined);
      return edge === undefined ? undefined : { actionId, playerId, type: 'PLACE_SETUP_ROAD', edge };
    }

    const spots = openSettlements(state, playerId, true);
    const vertex = spots[pickIndex(spots.length)];
    return vertex === undefined ? undefined : { actionId, playerId, type: 'PLACE_SETUP_SETTLEMENT', vertex };
  }

  const isActive = state.players[state.activeIndex]?.id === playerId;
  if (!isActive) return undefined;

  if (state.phase === 'production') return { actionId, playerId, type: 'ROLL_DICE' };

  if (state.pendingRobber) {
    const target = [...state.board.allHexData().keys()]
      .sort()
      .find((id) => !state.board.isBlocked(id));
    return target === undefined ? undefined : { actionId, playerId, type: 'MOVE_ROBBER', to: target };
  }

  return undefined;
}

/**
 * Échange bancaire de dépannage.
 *
 * Sans lui, un bot accumule des ressources sans jamais réunir un coût précis :
 * une main de dix cartes réparties sur cinq types ne contient presque jamais
 * les trois minerais d'une ville. C'est exactement ce que la simulation a
 * révélé — des mains pleines, des défausses en série, et presque aucune
 * construction.
 */
function bankTrade(state: GameState, playerId: PlayerId, actionId: string): Command | undefined {
  const player = playerOf(state, playerId);
  if (!player) return undefined;

  let surplus: Resource | undefined;
  let scarcest: Resource | undefined;
  for (const r of CORE_RESOURCES) {
    const held = amount(player.hand, r);
    if (held >= 4 && (surplus === undefined || held > amount(player.hand, surplus))) surplus = r;
    if (scarcest === undefined || held < amount(player.hand, scarcest)) scarcest = r;
  }

  if (surplus === undefined || scarcest === undefined || surplus === scarcest) return undefined;
  if (amount(state.bank, scarcest) < 1) return undefined;

  return {
    actionId, playerId, type: 'TRADE_WITH_BANK',
    give: counts({ [surplus]: 4 }),
    receive: counts({ [scarcest]: 1 }),
  };
}

export class GreedyBot implements Bot {
  readonly name = 'greedy';

  decide(state: GameState, playerId: PlayerId, actionId: string): Command | undefined {
    const mandatory = mandatoryCommand(state, playerId, actionId, () => 0);
    if (mandatory) return mandatory;
    if (state.phase !== 'activeTurn') return undefined;

    // L'ordre de `affordableBuilds` est déjà celui de la valeur en points :
    // ville, colonie, route, carte.
    const [best] = affordableBuilds(state, playerId);
    // Rien d'abordable : on convertit un surplus plutôt que de thésauriser.
    if (best === undefined) return bankTrade(state, playerId, actionId);

    switch (best) {
      case 'BUILD_CITY': {
        const vertex = upgradableSettlements(state, playerId)[0];
        return vertex === undefined ? undefined : { actionId, playerId, type: 'BUILD_CITY', vertex };
      }
      case 'BUILD_SETTLEMENT': {
        const vertex = openSettlements(state, playerId, false)[0];
        return vertex === undefined ? undefined : { actionId, playerId, type: 'BUILD_SETTLEMENT', vertex };
      }
      case 'BUILD_ROAD': {
        const edge = openRoads(state, playerId)[0];
        return edge === undefined ? undefined : { actionId, playerId, type: 'BUILD_ROAD', edge };
      }
      case 'BUY_DEV_CARD':
        return { actionId, playerId, type: 'BUY_DEV_CARD' };
      default:
        return undefined;
    }
  }
}

export class RandomBot implements Bot {
  readonly name = 'random';

  constructor(private readonly rng: SeededRandom) {}

  decide(state: GameState, playerId: PlayerId, actionId: string): Command | undefined {
    const mandatory = mandatoryCommand(state, playerId, actionId, (n) => (n === 0 ? 0 : this.rng.int(n)));
    if (mandatory) return mandatory;
    if (state.phase !== 'activeTurn') return undefined;

    const options = affordableBuilds(state, playerId);
    if (options.length === 0) return bankTrade(state, playerId, actionId);

    // Un bot qui construit systématiquement ne laisserait jamais de ressources
    // s'accumuler : on le fait parfois s'abstenir, pour que la simulation voie
    // aussi des mains qui gonflent.
    if (this.rng.next() < 0.25) return undefined;

    const choice = options[this.rng.int(options.length)];
    switch (choice) {
      case 'BUILD_CITY': {
        const spots = upgradableSettlements(state, playerId);
        const vertex = spots[this.rng.int(spots.length)];
        return vertex === undefined ? undefined : { actionId, playerId, type: 'BUILD_CITY', vertex };
      }
      case 'BUILD_SETTLEMENT': {
        const spots = openSettlements(state, playerId, false);
        const vertex = spots[this.rng.int(spots.length)];
        return vertex === undefined ? undefined : { actionId, playerId, type: 'BUILD_SETTLEMENT', vertex };
      }
      case 'BUILD_ROAD': {
        const edges = openRoads(state, playerId);
        const edge = edges[this.rng.int(edges.length)];
        return edge === undefined ? undefined : { actionId, playerId, type: 'BUILD_ROAD', edge };
      }
      case 'BUY_DEV_CARD':
        return { actionId, playerId, type: 'BUY_DEV_CARD' };
      default:
        return undefined;
    }
  }
}
