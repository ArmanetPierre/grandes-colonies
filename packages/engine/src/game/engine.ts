/**
 * La boucle de commandes : valider, résoudre, raconter.
 *
 * Toute modification de l'état passe par `dispatch`, et par lui seul. Une
 * commande est d'abord validée sans rien changer ; ce n'est qu'une fois
 * acceptée qu'elle mute l'état et produit des événements. Un refus ne laisse
 * jamais l'état à moitié modifié.
 *
 * Le serveur sérialise les commandes avant de les passer ici : le moteur ne
 * connaît ni la concurrence, ni le temps, ni le réseau.
 */

import { parseHexKey } from '../board/axial.js';
import type { HexId, VertexId } from '../board/graph.js';
import { vertexIdsOfHex } from '../board/graph.js';
import { buildDeck, beginTurn, buyCard, canPlayCard, knightsPlayed, playCard } from '../devCards.js';
import { largestArmyHolder } from '../largestArmy.js';
import { longestRouteHolder } from '../longestRoute.js';
import { canPlaceRoad, canPlaceSettlement, canUpgradeToCity } from '../placement.js';
import { applyBankLimits, computeProduction } from '../production.js';
import {
  type Resource,
  type ResourceCounts,
  COSTS,
  RESOURCES,
  addCounts,
  amount,
  canAfford,
  counts,
  subtractCounts,
  total,
  yieldOf,
} from '../resources.js';
import { type VictoryBreakdown, victoryBreakdown, victoryPoints } from '../victory.js';
import type { Command, CommandResult, DomainEvent, RejectionReason } from './commands.js';
import { type BuildIntent, type IntentTarget, locationOf, resolveIntents } from './buildIntent.js';
import {
  type GameState,
  type PlayerState,
  activeObjective,
  activePlayer,
  pairedPlayer,
  playerIds,
  playerOf,
} from './state.js';
import { type ObjectiveId, isObjectiveComplete } from '../objectives.js';
import { tradeRate } from '../ports.js';
import { type TradeOffer, checkOffer, isAddressedTo } from './trade.js';

const reject = (reason: RejectionReason, detail?: string): CommandResult =>
  detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };

/**
 * Point d'entrée unique.
 *
 * La déduplication est faite ici plutôt que dans chaque gestionnaire : une
 * commande déjà appliquée renvoie un succès sans événement, ce qui laisse le
 * client tranquille sans rejouer l'effet.
 */
export function dispatch(state: GameState, command: Command): CommandResult {
  if (state.appliedActions.has(command.actionId)) {
    return { ok: true, events: [], duplicate: true };
  }

  const result = execute(state, command);
  if (result.ok) state.appliedActions.add(command.actionId);
  return result;
}

function execute(state: GameState, command: Command): CommandResult {
  if (state.phase === 'ended') return reject('game-over');

  const player = playerOf(state, command.playerId);
  if (!player) return reject('unknown-player');

  switch (command.type) {
    case 'PLACE_SETUP_SETTLEMENT': return placeSetupSettlement(state, command.playerId, command.vertex);
    case 'PLACE_SETUP_ROAD':       return placeSetupRoad(state, command.playerId, command.edge);
    case 'ROLL_DICE':              return rollDice(state, command.playerId);
    case 'DISCARD':                return discard(state, command.playerId, command.resources);
    case 'MOVE_ROBBER':            return moveRobber(state, command.playerId, command.to, command.victim);
    case 'BUILD_ROAD':             return buildRoad(state, command.playerId, command.edge);
    case 'BUILD_SETTLEMENT':       return buildSettlement(state, command.playerId, command.vertex);
    case 'BUILD_CITY':             return buildCity(state, command.playerId, command.vertex);
    case 'BUY_DEV_CARD':           return buyDevCard(state, command.playerId);
    case 'PLAY_KNIGHT':            return playKnight(state, command.playerId, command.to, command.victim);
    case 'TRADE_WITH_BANK':        return tradeWithBank(state, command.playerId, command.give, command.receive);
    case 'DECLARE_BUILD':          return declareBuild(state, command.playerId, command.target);
    case 'CANCEL_BUILD':           return cancelBuild(state, command.playerId, command.intentId);
    case 'END_TURN':               return endTurn(state, command.playerId);
    case 'CHOOSE_OBJECTIVE':       return chooseObjective(state, command.playerId, command.objective);
    case 'CREATE_TRADE':           return createTrade(state, command.playerId, command.to, command.give, command.receive);
    case 'CANCEL_TRADE':           return cancelTrade(state, command.playerId, command.offerId);
    case 'ACCEPT_TRADE':           return acceptTrade(state, command.playerId, command.offerId);
    case 'END_CYCLE':              return endCycle(state, command.playerId);
  }

  // Le typage garantit l'exhaustivité à la compilation, mais les commandes
  // arrivent par le réseau : rien n'empêche un client bricolé — ou un autre
  // programme qui tombe sur le port — d'envoyer un type inconnu. Sans ce
  // retour, la fonction rendait `undefined` et l'appelant levait.
  return reject('unknown-command', (command as { type?: string }).type);
}

// ── mise en place ──────────────────────────────────────────────────────────

function placeSetupSettlement(state: GameState, playerId: string, vertex: VertexId): CommandResult {
  if (state.phase !== 'setup') return reject('wrong-phase');
  if (state.setupQueue[0] !== playerId) return reject('not-your-turn');
  if (state.setupPendingVertex !== undefined) return reject('wrong-phase', 'route attendue');

  const check = canPlaceSettlement(state.board, vertex, playerId, { setupPhase: true });
  if (!check.ok) return reject('invalid-placement', check.reason);

  const player = playerOf(state, playerId);
  if (!player || player.settlementsLeft <= 0) return reject('no-pieces-left');

  state.board.setBuilding(vertex, { kind: 'settlement', owner: playerId });
  player.settlementsLeft--;
  state.setupPendingVertex = vertex;

  const events: DomainEvent[] = [{ type: 'SettlementPlaced', player: playerId, vertex }];

  // Seconde colonie : elle rapporte immédiatement les ressources de ses
  // hexagones, ce qui amorce la partie et récompense un bon placement.
  const isSecondRound = state.setupQueue.length <= state.players.length;
  if (isSecondRound) {
    const gains = initialYield(state, vertex);
    if (total(gains) > 0) {
      player.hand = addCounts(player.hand, gains);
      state.bank = subtractCounts(state.bank, gains);
      events.push({ type: 'ResourcesProduced', gains: new Map([[playerId, gains]]) });
    }
  }

  return { ok: true, events };
}

/** Ce que rapporte une colonie posée en seconde vague. */
function initialYield(state: GameState, vertex: VertexId): ResourceCounts {
  let gains: ResourceCounts = counts({});
  for (const hex of state.board.graph.boardHexesOfVertex(vertex)) {
    const data = state.board.hexData(hex);
    if (!data) continue;
    const resource = yieldOf(data.terrain);
    if (resource === null) continue;
    gains = addCounts(gains, counts({ [resource]: 1 }));
  }
  return gains;
}

function placeSetupRoad(state: GameState, playerId: string, edge: string): CommandResult {
  if (state.phase !== 'setup') return reject('wrong-phase');
  if (state.setupQueue[0] !== playerId) return reject('not-your-turn');

  const pending = state.setupPendingVertex;
  if (pending === undefined) return reject('wrong-phase', 'colonie attendue');

  // La route doit partir de la colonie qui vient d'être posée, et non de
  // n'importe quel point du réseau.
  if (!state.board.graph.edgesOfVertexOnBoard(pending).includes(edge)) {
    return reject('invalid-placement', 'la route doit partir de la colonie posée');
  }
  const check = canPlaceRoad(state.board, edge, playerId);
  if (!check.ok) return reject('invalid-placement', check.reason);

  const player = playerOf(state, playerId);
  if (!player || player.roadsLeft <= 0) return reject('no-pieces-left');

  state.board.setRoad(edge, playerId);
  player.roadsLeft--;
  state.setupPendingVertex = undefined;
  state.setupQueue.shift();

  const events: DomainEvent[] = [{ type: 'RoadPlaced', player: playerId, edge }];

  if (state.setupQueue.length === 0) {
    state.phase = 'production';
    state.cycle = 1;
    state.activeIndex = 0;
    state.deck = buildDeck(state.config.deck, state.rng);
    events.push({ type: 'SetupCompleted' }, { type: 'PhaseChanged', from: 'setup', to: 'production' });
  }

  return { ok: true, events };
}

// ── production ─────────────────────────────────────────────────────────────

function rollDice(state: GameState, playerId: string): CommandResult {
  if (state.phase !== 'production') return reject(state.phase === 'activeTurn' ? 'already-rolled' : 'wrong-phase');
  if (activePlayer(state).id !== playerId) return reject('not-your-turn');

  const roll = state.rng.roll();
  state.lastRoll = roll;
  state.phase = 'activeTurn';

  const events: DomainEvent[] = [
    { type: 'DiceRolled', player: playerId, a: roll.a, b: roll.b, total: roll.total },
    { type: 'PhaseChanged', from: 'production', to: 'activeTurn' },
  ];

  if (roll.total === 7) {
    state.pendingRobber = true;

    const toDiscard = new Map<string, number>();
    for (const p of state.players) {
      const held = total(p.hand);
      if (held > state.config.handLimit) {
        // On défausse la moitié, arrondie à l'inférieur.
        p.mustDiscard = Math.floor(held / 2);
        toDiscard.set(p.id, p.mustDiscard);
      }
    }
    if (toDiscard.size > 0) events.push({ type: 'DiscardRequired', players: toDiscard });
    return { ok: true, events };
  }

  const intended = computeProduction(state.board, roll.total, state.config.production);
  const { granted, bank } = applyBankLimits(intended, state.bank);
  state.bank = bank;
  for (const [id, gains] of granted) {
    const p = playerOf(state, id);
    if (p) p.hand = addCounts(p.hand, gains);
  }
  if (granted.size > 0) events.push({ type: 'ResourcesProduced', gains: granted });

  return { ok: true, events };
}

function discard(state: GameState, playerId: string, resources: ResourceCounts): CommandResult {
  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');
  if (player.mustDiscard === 0) return reject('invalid-discard', 'aucune défausse due');
  if (total(resources) !== player.mustDiscard) {
    return reject('invalid-discard', `${player.mustDiscard} cartes attendues`);
  }
  if (!canAfford(player.hand, resources)) return reject('not-enough-resources');

  player.hand = subtractCounts(player.hand, resources);
  player.mustDiscard = 0;
  state.bank = addCounts(state.bank, resources);

  return { ok: true, events: [{ type: 'ResourcesDiscarded', player: playerId, resources }] };
}

// ── voleur ─────────────────────────────────────────────────────────────────

function relocateRobber(
  state: GameState,
  playerId: string,
  to: HexId,
  victim: string | undefined,
): CommandResult {
  if (state.board.hexData(to) === undefined) return reject('invalid-robber-move', 'hexagone inconnu');
  if (state.board.isBlocked(to)) return reject('invalid-robber-move', 'un voleur y est déjà');

  // On déplace le voleur le plus anciennement posé, pour que le second
  // voleur des grandes parties ne serve pas à figer deux fois la même zone.
  const current = state.board.robberPositions();
  const from = current.length >= state.config.robberCount ? current[0] : undefined;
  if (from !== undefined) state.board.removeRobber(from);
  state.board.placeRobber(to);

  const events: DomainEvent[] = [{ type: 'RobberMoved', player: playerId, from, to }];

  if (victim !== undefined) {
    const stolen = stealFrom(state, playerId, victim, to);
    if (!stolen.ok) return stolen;
    events.push(...stolen.events);
  }

  state.pendingRobber = false;
  return { ok: true, events };
}

function stealFrom(state: GameState, thief: string, victimId: string, hex: HexId): CommandResult {
  if (victimId === thief) return reject('invalid-victim', 'on ne se vole pas soi-même');

  const victim = playerOf(state, victimId);
  if (!victim) return reject('unknown-player');

  // La victime doit posséder une construction sur l'hexagone bloqué.
  const touches = vertexIdsOfHex(parseHexKey(hex)).some(
    (v) => state.board.buildingAt(v)?.owner === victimId,
  );
  if (!touches) return reject('invalid-victim', 'aucune construction sur cet hexagone');

  // Une carte au hasard : le tirage passe par le générateur seedé, sans quoi
  // la partie cesserait d'être rejouable.
  const pool: Resource[] = [];
  for (const r of RESOURCES) for (let i = 0; i < amount(victim.hand, r); i++) pool.push(r);
  if (pool.length === 0) return { ok: true, events: [] };

  const picked = state.rng.pick(pool);
  if (picked === undefined) return { ok: true, events: [] };

  victim.hand = subtractCounts(victim.hand, counts({ [picked]: 1 }));
  const thiefState = playerOf(state, thief);
  if (thiefState) thiefState.hand = addCounts(thiefState.hand, counts({ [picked]: 1 }));

  return { ok: true, events: [{ type: 'ResourceStolen', thief, victim: victimId, resource: picked }] };
}

function moveRobber(state: GameState, playerId: string, to: HexId, victim?: string): CommandResult {
  if (state.phase !== 'activeTurn') return reject('wrong-phase');
  if (activePlayer(state).id !== playerId) return reject('not-your-turn');
  if (!state.pendingRobber) return reject('invalid-robber-move', 'aucun déplacement dû');
  if (someoneMustDiscard(state)) return reject('must-discard-first');

  return relocateRobber(state, playerId, to, victim);
}

function someoneMustDiscard(state: GameState): boolean {
  return state.players.some((p) => p.mustDiscard > 0);
}

// ── constructions ──────────────────────────────────────────────────────────

/**
 * Garde commune aux actions de la phase de tour.
 *
 * Le joueur actif et son associé y agissent simultanément (contrat §1).
 * L'associé construit, achète et commerce avec la banque, mais ne négocie
 * pas avec les autres joueurs — cette restriction est portée par les
 * commandes concernées, pas ici.
 */
function ensureCanAct(state: GameState, playerId: string): CommandResult | undefined {
  if (state.phase === 'production') return reject('must-roll-first');
  if (state.phase !== 'activeTurn') return reject('wrong-phase');

  const isActive = activePlayer(state).id === playerId;
  const isPaired = pairedPlayer(state)?.id === playerId;
  if (!isActive && !isPaired) return reject('not-your-turn');

  // Le voleur bloque le joueur actif, pas son associé : ce dernier n'a aucun
  // moyen de le déplacer et resterait bloqué sans rien pouvoir faire.
  if (isActive && state.pendingRobber) return reject('invalid-robber-move', 'déplace le voleur d abord');
  if (someoneMustDiscard(state)) return reject('must-discard-first');
  return undefined;
}

function pay(state: GameState, playerId: string, cost: ResourceCounts): void {
  const player = playerOf(state, playerId);
  if (!player) return;
  player.hand = subtractCounts(player.hand, cost);
  state.bank = addCounts(state.bank, cost);
}

function buildRoad(state: GameState, playerId: string, edge: string): CommandResult {
  const blocked = ensureCanAct(state, playerId);
  if (blocked) return blocked;

  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');
  if (player.roadsLeft <= 0) return reject('no-pieces-left');
  if (!canAfford(player.hand, COSTS.road)) return reject('not-enough-resources');

  const check = canPlaceRoad(state.board, edge, playerId);
  if (!check.ok) return reject('invalid-placement', check.reason);

  pay(state, playerId, COSTS.road);
  state.board.setRoad(edge, playerId);
  player.roadsLeft--;

  const events: DomainEvent[] = [{ type: 'RoadPlaced', player: playerId, edge }];
  events.push(...refreshRouteTitle(state));
  return { ok: true, events };
}

function buildSettlement(state: GameState, playerId: string, vertex: VertexId): CommandResult {
  const blocked = ensureCanAct(state, playerId);
  if (blocked) return blocked;

  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');
  if (player.settlementsLeft <= 0) return reject('no-pieces-left');
  if (!canAfford(player.hand, COSTS.settlement)) return reject('not-enough-resources');

  const check = canPlaceSettlement(state.board, vertex, playerId);
  if (!check.ok) return reject('invalid-placement', check.reason);

  pay(state, playerId, COSTS.settlement);
  state.board.setBuilding(vertex, { kind: 'settlement', owner: playerId });
  player.settlementsLeft--;

  const events: DomainEvent[] = [{ type: 'SettlementPlaced', player: playerId, vertex }];
  // Une colonie neuve peut couper le réseau d'un adversaire : le titre se
  // recalcule pour tout le monde, pas seulement pour le bâtisseur.
  events.push(...refreshRouteTitle(state));
  return { ok: true, events };
}

function buildCity(state: GameState, playerId: string, vertex: VertexId): CommandResult {
  const blocked = ensureCanAct(state, playerId);
  if (blocked) return blocked;

  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');
  if (player.citiesLeft <= 0) return reject('no-pieces-left');
  if (!canAfford(player.hand, COSTS.city)) return reject('not-enough-resources');

  const check = canUpgradeToCity(state.board, vertex, playerId);
  if (!check.ok) return reject('invalid-placement', check.reason);

  pay(state, playerId, COSTS.city);
  state.board.setBuilding(vertex, { kind: 'city', owner: playerId });
  player.citiesLeft--;
  player.settlementsLeft++; // la colonie retourne dans la réserve

  const events: DomainEvent[] = [{ type: 'CityBuilt', player: playerId, vertex }];
  return { ok: true, events };
}

// ── cartes développement ───────────────────────────────────────────────────

function buyDevCard(state: GameState, playerId: string): CommandResult {
  const blocked = ensureCanAct(state, playerId);
  if (blocked) return blocked;

  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');
  if (state.deck.length === 0) return reject('empty-deck');
  if (!canAfford(player.hand, COSTS.devCard)) return reject('not-enough-resources');

  pay(state, playerId, COSTS.devCard);
  const card = state.deck.pop();
  if (card === undefined) return reject('empty-deck');
  player.devCards = buyCard(player.devCards, card);

  return { ok: true, events: [{ type: 'DevCardBought', player: playerId, card }] };
}

function playKnight(state: GameState, playerId: string, to: HexId, victim?: string): CommandResult {
  if (state.phase !== 'activeTurn' && state.phase !== 'production') return reject('wrong-phase');
  if (activePlayer(state).id !== playerId) return reject('not-your-turn');
  if (someoneMustDiscard(state)) return reject('must-discard-first');

  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');

  const check = canPlayCard(player.devCards, 'knight');
  if (!check.ok) return reject('card-not-playable', check.reason);

  const moved = relocateRobber(state, playerId, to, victim);
  if (!moved.ok) return moved;

  player.devCards = playCard(player.devCards, 'knight');

  const events: DomainEvent[] = [
    { type: 'DevCardPlayed', player: playerId, card: 'knight' },
    ...moved.events,
  ];
  events.push(...refreshArmyTitle(state));
  return { ok: true, events };
}

// ── commerce ───────────────────────────────────────────────────────────────

/**
 * Échange avec la banque, au meilleur taux dont dispose le joueur.
 *
 * Quatre contre une sans port, trois avec un port générique, deux avec un
 * port spécialisé ou marchand (§11).
 */
function tradeWithBank(
  state: GameState,
  playerId: string,
  give: ResourceCounts,
  receive: ResourceCounts,
): CommandResult {
  const blocked = ensureCanAct(state, playerId);
  if (blocked) return blocked;

  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');

  const given = RESOURCES.filter((r) => amount(give, r) > 0);
  const received = RESOURCES.filter((r) => amount(receive, r) > 0);

  if (given.length !== 1 || received.length !== 1) {
    return reject('invalid-trade', 'une ressource contre une seule autre');
  }
  const from = given[0] as Resource;
  const to = received[0] as Resource;
  if (from === to) return reject('invalid-trade', 'échange sans effet');
  const rate = tradeRate(state.board, playerId, from);
  if (amount(give, from) !== rate || amount(receive, to) !== 1) {
    return reject('invalid-trade', `taux applicable : ${rate} contre 1`);
  }
  if (!canAfford(player.hand, give)) return reject('not-enough-resources');
  if (amount(state.bank, to) < 1) return reject('invalid-trade', 'la banque est à sec');

  player.hand = addCounts(subtractCounts(player.hand, give), receive);
  state.bank = subtractCounts(addCounts(state.bank, give), receive);

  return { ok: true, events: [{ type: 'BankTraded', player: playerId, give, receive }] };
}

// ── commerce entre joueurs ─────────────────────────────────────────────────

/**
 * Qui peut PROPOSER un échange, et quand (contrat §1 et §4).
 *
 * Le joueur associé en est exclu : il construit et commerce avec la banque,
 * mais négocier lui donnerait le double avantage d'agir hors de son tour ET
 * de peser sur le marché.
 */
function canOfferTrade(state: GameState, playerId: string): boolean {
  if (state.phase === 'freeTrade') return true;
  return state.phase === 'activeTurn' && activePlayer(state).id === playerId;
}

/**
 * Qui peut ACCEPTER un échange.
 *
 * Le contrat dit que le joueur actif négocie avec les autres pendant son
 * tour, mais il ne précisait pas qui pouvait répondre. Restreindre la
 * réponse au seul joueur actif rendait la règle vide : une offre sans
 * contrepartie possible ne sert à rien. Pendant le tour, un échange est donc
 * recevable dès lors que le joueur actif en est l'une des deux parties.
 */
function canAcceptTrade(state: GameState, playerId: string, offer: TradeOffer): boolean {
  if (state.phase === 'freeTrade') return true;
  if (state.phase !== 'activeTurn') return false;

  const active = activePlayer(state).id;
  return offer.from === active || playerId === active;
}

function createTrade(
  state: GameState,
  playerId: string,
  to: string | undefined,
  give: ResourceCounts,
  receive: ResourceCounts,
): CommandResult {
  if (!canOfferTrade(state, playerId)) return reject('wrong-phase');

  const problem = checkOffer(playerId, to, give, receive);
  if (problem) return reject('invalid-offer', problem);

  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');
  // On vérifie à la création pour éviter les offres manifestement creuses,
  // mais c'est la vérification à l'acceptation qui fait foi.
  if (!canAfford(player.hand, give)) return reject('not-enough-resources');
  if (to !== undefined && !playerOf(state, to)) return reject('unknown-player');

  const offer: TradeOffer = {
    id: `t${state.offerCounter}`,
    from: playerId,
    to,
    give,
    receive,
    cycle: state.cycle,
  };
  state.offerCounter++;
  state.offers.push(offer);

  return {
    ok: true,
    events: [{ type: 'TradeCreated', offerId: offer.id, from: playerId, to, give, receive }],
  };
}

function cancelTrade(state: GameState, playerId: string, offerId: string): CommandResult {
  const index = state.offers.findIndex((o) => o.id === offerId);
  if (index === -1) return reject('unknown-offer');

  const offer = state.offers[index];
  if (!offer) return reject('unknown-offer');
  if (offer.from !== playerId) return reject('not-your-turn', 'offre d un autre joueur');

  state.offers.splice(index, 1);
  return { ok: true, events: [{ type: 'TradeCancelled', offerId, by: playerId }] };
}

/**
 * Acceptation d'une offre — le point le plus délicat du commerce.
 *
 * Tout est vérifié ici et au dernier moment : phase, destinataire, et surtout
 * les DEUX inventaires. Entre la création et l'acceptation, l'auteur a pu
 * dépenser ses ressources ou les réserver pour une construction. L'offre
 * devient alors caduque, et le dire explicitement vaut mieux que d'échouer
 * à moitié.
 */
function acceptTrade(state: GameState, playerId: string, offerId: string): CommandResult {
  const index = state.offers.findIndex((o) => o.id === offerId);
  if (index === -1) return reject('unknown-offer');

  const offer = state.offers[index];
  if (!offer) return reject('unknown-offer');
  if (!canAcceptTrade(state, playerId, offer)) return reject('wrong-phase');
  if (!isAddressedTo(offer, playerId)) return reject('offer-not-for-you');

  const proposer = playerOf(state, offer.from);
  const accepter = playerOf(state, playerId);
  if (!proposer || !accepter) return reject('unknown-player');

  if (!canAfford(proposer.hand, offer.give)) {
    // L'auteur ne peut plus honorer : l'offre disparaît plutôt que de traîner.
    state.offers.splice(index, 1);
    return reject('offer-stale', 'le proposant n a plus les ressources');
  }
  if (!canAfford(accepter.hand, offer.receive)) return reject('not-enough-resources');

  // Les deux transferts sont faits d'un bloc, après toutes les vérifications.
  proposer.hand = addCounts(subtractCounts(proposer.hand, offer.give), offer.receive);
  accepter.hand = addCounts(subtractCounts(accepter.hand, offer.receive), offer.give);

  state.offers.splice(index, 1);

  return {
    ok: true,
    events: [{ type: 'TradeAccepted', offerId, from: offer.from, to: playerId }],
  };
}

// ── fin de tour ────────────────────────────────────────────────────────────

/** Fin de la phase de tour : on ouvre la fenêtre de commerce. */
function endTurn(state: GameState, playerId: string): CommandResult {
  if (state.phase !== 'activeTurn') return reject(state.phase === 'production' ? 'must-roll-first' : 'wrong-phase');
  if (activePlayer(state).id !== playerId) return reject('not-your-turn');
  if (state.pendingRobber) return reject('invalid-robber-move', 'déplace le voleur d abord');
  if (someoneMustDiscard(state)) return reject('must-discard-first');

  state.phase = 'freeTrade';
  return {
    ok: true,
    events: [
      { type: 'TurnEnded', player: playerId, cycle: state.cycle },
      { type: 'PhaseChanged', from: 'activeTurn', to: 'freeTrade' },
    ],
  };
}

// ── annonces de construction ───────────────────────────────────────────────

/** Coût d'une cible d'annonce. */
function costOfTarget(target: IntentTarget): ResourceCounts {
  switch (target.kind) {
    case 'road': return COSTS.road;
    case 'settlement': return COSTS.settlement;
    case 'city': return COSTS.city;
  }
}

function piecesLeftFor(player: PlayerState, target: IntentTarget): number {
  switch (target.kind) {
    case 'road': return player.roadsLeft;
    case 'settlement': return player.settlementsLeft;
    case 'city': return player.citiesLeft;
  }
}

/**
 * Annonce d'une construction, ouverte à tous et à tout moment (contrat §3).
 *
 * La légalité du placement n'est PAS vérifiée ici, seulement à la résolution :
 * le plateau change entre l'annonce et la fin du cycle, et un emplacement
 * légal au moment de l'annonce peut cesser de l'être. L'annonce est donc
 * optimiste, la résolution fait autorité.
 */
function declareBuild(state: GameState, playerId: string, target: IntentTarget): CommandResult {
  if (state.phase !== 'activeTurn' && state.phase !== 'freeTrade') return reject('wrong-phase');

  const location = locationOf(target);
  if (state.frozenLocations.has(location)) return reject('location-frozen');
  if (state.intents.some((i) => i.player === playerId && locationOf(i.target) === location)) {
    return reject('already-declared');
  }

  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');
  if (piecesLeftFor(player, target) <= 0) return reject('no-pieces-left');

  const cost = costOfTarget(target);
  if (!canAfford(player.hand, cost)) return reject('not-enough-resources');

  // Les ressources quittent la main immédiatement : elles ne sont plus
  // échangeables ni réutilisables tant que l'annonce est en vie.
  player.hand = subtractCounts(player.hand, cost);

  const intent: BuildIntent = {
    id: `${playerId}:${state.intentCounter}`,
    player: playerId,
    target,
    reserved: cost,
    cycle: state.cycle,
    order: state.intentCounter,
  };
  state.intentCounter++;
  state.intents.push(intent);

  return { ok: true, events: [{ type: 'BuildDeclared', player: playerId, intentId: intent.id, target }] };
}

function refund(state: GameState, intent: BuildIntent): void {
  const player = playerOf(state, intent.player);
  if (player) player.hand = addCounts(player.hand, intent.reserved);
}

function cancelBuild(state: GameState, playerId: string, intentId: string): CommandResult {
  const index = state.intents.findIndex((i) => i.id === intentId);
  if (index === -1) return reject('unknown-intent');

  const intent = state.intents[index];
  if (!intent) return reject('unknown-intent');
  if (intent.player !== playerId) return reject('not-your-turn', 'annonce d un autre joueur');

  refund(state, intent);
  state.intents.splice(index, 1);

  return { ok: true, events: [{ type: 'BuildCancelled', player: playerId, intentId }] };
}

/** Pose effective d'une annonce retenue, si elle est toujours légale. */
function applyIntent(state: GameState, intent: BuildIntent): DomainEvent[] {
  const player = playerOf(state, intent.player);
  if (!player) return [];

  const target = intent.target;
  const legal =
    target.kind === 'road' ? canPlaceRoad(state.board, target.edge, intent.player)
    : target.kind === 'settlement' ? canPlaceSettlement(state.board, target.vertex, intent.player)
    : canUpgradeToCity(state.board, target.vertex, intent.player);

  if (!legal.ok || piecesLeftFor(player, target) <= 0) {
    refund(state, intent);
    return [{ type: 'BuildRefunded', player: intent.player, intentId: intent.id, reason: 'no-longer-legal' }];
  }

  // Les ressources ont été prélevées à l'annonce : elles rejoignent la banque.
  state.bank = addCounts(state.bank, intent.reserved);

  switch (target.kind) {
    case 'road':
      state.board.setRoad(target.edge, intent.player);
      player.roadsLeft--;
      break;
    case 'settlement':
      state.board.setBuilding(target.vertex, { kind: 'settlement', owner: intent.player });
      player.settlementsLeft--;
      break;
    case 'city':
      state.board.setBuilding(target.vertex, { kind: 'city', owner: intent.player });
      player.citiesLeft--;
      player.settlementsLeft++;
      break;
  }

  return [{ type: 'BuildResolved', player: intent.player, intentId: intent.id, target }];
}

/**
 * Fin de cycle : on résout les annonces, on contrôle la victoire, puis la
 * main passe au joueur suivant.
 */
function endCycle(state: GameState, playerId: string): CommandResult {
  if (state.phase !== 'freeTrade') return reject('wrong-phase');
  if (activePlayer(state).id !== playerId) return reject('not-your-turn');

  const events: DomainEvent[] = [];

  const { built, refunded, frozen } = resolveIntents(state.intents, activePlayer(state).id);
  for (const intent of built) events.push(...applyIntent(state, intent));
  for (const intent of refunded) {
    refund(state, intent);
    events.push({ type: 'BuildRefunded', player: intent.player, intentId: intent.id, reason: 'lost-conflict' });
  }
  for (const location of frozen) {
    state.frozenLocations.add(location);
    events.push({ type: 'LocationFrozen', location });
  }
  state.intents = [];

  // Les offres ne franchissent pas le cycle : les inventaires ont trop changé.
  for (const offer of state.offers) events.push({ type: 'TradeExpired', offerId: offer.id });
  state.offers = [];

  events.push(...refreshRouteTitle(state));
  events.push({ type: 'CycleEnded', cycle: state.cycle });

  const won = checkVictory(state);
  if (won.length > 0) return { ok: true, events: [...events, ...won] };

  // Le gel ne vaut que pour le cycle où il s'est produit.
  state.frozenLocations.clear();

  state.activeIndex = (state.activeIndex + 1) % state.players.length;
  state.cycle++;
  state.phase = 'production';
  state.lastRoll = undefined;

  const next = activePlayer(state);
  next.devCards = beginTurn(next.devCards);

  events.push({ type: 'PhaseChanged', from: 'freeTrade', to: 'production' });
  return { ok: true, events };
}

/**
 * Choix de l'objectif conservé.
 *
 * Possible tant que la partie n'est pas finie : un joueur arrivé en retard
 * ou déconnecté au démarrage doit pouvoir le faire ensuite. À défaut de
 * choix, le premier objectif proposé fait foi.
 */
function chooseObjective(state: GameState, playerId: string, objective: ObjectiveId): CommandResult {
  const player = playerOf(state, playerId);
  if (!player) return reject('unknown-player');
  if (!player.offeredObjectives.includes(objective)) return reject('not-offered');

  player.chosenObjective = objective;
  // L'événement ne révèle pas lequel : c'est une information privée.
  return { ok: true, events: [{ type: 'ObjectiveChosen', player: playerId }] };
}

/** L'objectif d'un joueur est-il rempli ? */
export function objectiveDone(state: GameState, player: PlayerState): boolean {
  const objective = activeObjective(player);
  if (objective === undefined) return false;

  return isObjectiveComplete(objective, {
    board: state.board,
    player: player.id,
    devCards: player.devCards,
    roadsPlaced: state.config.roadsPerPlayer - player.roadsLeft,
    gold: amount(player.hand, 'gold'),
    territoriesExplored: 0,
    contractsHonoured: 0,
  });
}

/**
 * Le décompte complet d'un joueur, objectif secret compris.
 *
 * C'est le seul point d'entrée à utiliser pour afficher ou mesurer un score :
 * appeler `victoryPoints` directement oublierait l'objectif et les titres, et
 * sous-estimerait le total de plusieurs points.
 */
export function playerPoints(state: GameState, playerId: string): VictoryBreakdown | undefined {
  const player = playerOf(state, playerId);
  if (!player) return undefined;

  return victoryBreakdown(state.board, playerId, {
    hasLongestRoute: state.longestRouteHolder === playerId,
    hasLargestArmy: state.largestArmyHolder === playerId,
    secretObjectivesCompleted: objectiveDone(state, player) ? 1 : 0,
  }, state.config.victory);
}

// ── titres et victoire ─────────────────────────────────────────────────────

function refreshRouteTitle(state: GameState): DomainEvent[] {
  const before = state.longestRouteHolder;
  const holder = longestRouteHolder(state.board, playerIds(state), before, {
    minimum: state.config.minimumRouteLength,
  });
  state.longestRouteHolder = holder?.player;

  if (state.longestRouteHolder === before) return [];
  return [{ type: 'TitleChanged', title: 'longestRoute', from: before, to: state.longestRouteHolder }];
}

function refreshArmyTitle(state: GameState): DomainEvent[] {
  const before = state.largestArmyHolder;
  const knights = new Map(state.players.map((p) => [p.id, knightsPlayed(p.devCards)]));
  const holder = largestArmyHolder(knights, before, state.config.minimumKnights);
  state.largestArmyHolder = holder?.player;

  if (state.largestArmyHolder === before) return [];
  return [{ type: 'TitleChanged', title: 'largestArmy', from: before, to: state.largestArmyHolder }];
}

/**
 * Contrôle de victoire, en fin de cycle uniquement (contrat §5).
 *
 * Personne n'est coupé en plein geste : toutes les actions engagées se
 * terminent, y compris celles des autres joueurs pendant la phase simultanée.
 * Si plusieurs joueurs franchissent le seuil dans le même cycle, le plus haut
 * total l'emporte ; à égalité parfaite, l'ordre du tour tranche en partant du
 * joueur actif.
 */
function checkVictory(state: GameState): DomainEvent[] {
  const target = state.config.victory.target;

  // Ordre du tour à partir de l'actif : c'est lui qui départage une égalité.
  const order = state.players.map((_, i) => state.players[(state.activeIndex + i) % state.players.length]);

  let best: { player: PlayerState; points: number } | undefined;
  for (const player of order) {
    if (!player) continue;
    const points = victoryPoints(state.board, player.id, {
      hasLongestRoute: state.longestRouteHolder === player.id,
      hasLargestArmy: state.largestArmyHolder === player.id,
      secretObjectivesCompleted: objectiveDone(state, player) ? 1 : 0,
    }, state.config.victory);

    if (points < target) continue;
    // Strictement supérieur : à égalité, le premier rencontré dans l'ordre
    // du tour conserve l'avantage.
    if (best === undefined || points > best.points) best = { player, points };
  }

  if (best === undefined) return [];

  state.winner = best.player.id;
  state.phase = 'ended';

  // La partie est finie : les objectifs cessent d'être secrets.
  const revealed: DomainEvent[] = state.players.flatMap((player) => {
    const objective = activeObjective(player);
    return objective === undefined ? [] : [{
      type: 'ObjectiveRevealed' as const,
      player: player.id,
      objective,
      complete: objectiveDone(state, player),
    }];
  });

  return [{ type: 'GameWon', player: best.player.id, points: best.points }, ...revealed];
}

/** Rejoue une partie depuis son état initial. Sert au replay et aux tests. */
export function replay(state: GameState, commands: readonly Command[]): DomainEvent[] {
  const events: DomainEvent[] = [];
  for (const command of commands) {
    const result = dispatch(state, command);
    if (result.ok) events.push(...result.events);
  }
  return events;
}
