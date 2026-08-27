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
  canAfford,
  counts,
  playerOf,
  suggestDiscard,
  tradeRate,
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

  // Le taux dépend des ports que le joueur contrôle : deux contre une sur un
  // port spécialisé, contre quatre sans port. Ignorer cette différence
  // reviendrait à ne jamais exploiter les ports du plateau.
  let surplus: Resource | undefined;
  let surplusRate = 0;
  let scarcest: Resource | undefined;

  for (const r of CORE_RESOURCES) {
    const held = amount(player.hand, r);
    const rate = tradeRate(state.board, playerId, r);

    // On privilégie le surplus dont l'échange coûte le moins cher.
    if (held >= rate) {
      const better = surplus === undefined || rate < surplusRate
        || (rate === surplusRate && held > amount(player.hand, surplus));
      if (better) { surplus = r; surplusRate = rate; }
    }
    if (scarcest === undefined || held < amount(player.hand, scarcest)) scarcest = r;
  }

  if (surplus === undefined || scarcest === undefined || surplus === scarcest) return undefined;
  if (amount(state.bank, scarcest) < 1) return undefined;

  return {
    actionId, playerId, type: 'TRADE_WITH_BANK',
    give: counts({ [surplus]: surplusRate }),
    receive: counts({ [scarcest]: 1 }),
  };
}

/** Le surplus et le manque d'un joueur, pour composer une offre. */
function imbalance(state: GameState, playerId: PlayerId): { surplus: Resource; scarce: Resource } | undefined {
  const player = playerOf(state, playerId);
  if (!player) return undefined;

  let surplus: Resource | undefined;
  let scarce: Resource | undefined;
  for (const r of CORE_RESOURCES) {
    const held = amount(player.hand, r);
    if (held >= 3 && (surplus === undefined || held > amount(player.hand, surplus))) surplus = r;
    if (scarce === undefined || held < amount(player.hand, scarce)) scarce = r;
  }

  if (surplus === undefined || scarce === undefined || surplus === scarce) return undefined;
  return { surplus, scarce };
}

/**
 * Négociation entre joueurs, pendant la fenêtre de commerce.
 *
 * Le §37 du game design en fait le cœur du jeu à douze : c'est par elle qu'un
 * joueur qui n'agit qu'un cycle sur douze reste dans la partie. Les bots la
 * pratiquent de la façon la plus fruste qui soit — deux cartes en surplus
 * contre une carte manquante, sans marchander — mais cela suffit à mesurer si
 * le système débloque l'expansion.
 */
function playerTrade(state: GameState, playerId: PlayerId, actionId: string): Command | undefined {
  const player = playerOf(state, playerId);
  if (!player) return undefined;

  const gap = imbalance(state, playerId);

  // Accepter est immédiat, donc préférable à proposer — mais pas à
  // n'importe quel prix. Accepter toute offre payable revenait à céder sa
  // dernière ressource rare contre une dont on n'avait pas besoin.
  for (const offer of state.offers) {
    if (offer.from === playerId) continue;
    if (offer.to !== undefined && offer.to !== playerId) continue;
    if (!canAfford(player.hand, offer.receive)) continue;

    // L'offre doit apporter ce qui manque sans vider une réserve.
    // Exiger davantage — ne céder que du surplus confortable — faisait
    // chuter le taux d'acceptation à 8 % et paralysait le marché.
    const brings = gap !== undefined && amount(offer.give, gap.scarce) > 0;
    const leavesSomething = CORE_RESOURCES.every(
      (r) => amount(offer.receive, r) === 0 || amount(player.hand, r) > amount(offer.receive, r),
    );
    if (!brings || !leavesSomething) continue;

    return { actionId, playerId, type: 'ACCEPT_TRADE', offerId: offer.id };
  }

  // Une seule offre en vol à la fois, pour ne pas inonder le marché.
  if (state.offers.some((o) => o.from === playerId)) return undefined;
  if (!gap) return undefined;

  return {
    actionId, playerId, type: 'CREATE_TRADE',
    give: counts({ [gap.surplus]: 2 }),
    receive: counts({ [gap.scarce]: 1 }),
  };
}

export class GreedyBot implements Bot {
  readonly name = 'greedy';

  decide(state: GameState, playerId: PlayerId, actionId: string): Command | undefined {
    const mandatory = mandatoryCommand(state, playerId, actionId, () => 0);
    if (mandatory) return mandatory;

    if (state.phase === 'freeTrade') return playerTrade(state, playerId, actionId);
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
