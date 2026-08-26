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
import { victoryPoints } from '../victory.js';
import type { Command, CommandResult, DomainEvent, RejectionReason } from './commands.js';
import {
  type GameState,
  activePlayer,
  playerIds,
  playerOf,
} from './state.js';

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
    case 'END_TURN':               return endTurn(state, command.playerId);
  }
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

/** Garde commune à toutes les actions du tour actif. */
function ensureCanAct(state: GameState, playerId: string): CommandResult | undefined {
  if (state.phase === 'production') return reject('must-roll-first');
  if (state.phase !== 'activeTurn') return reject('wrong-phase');
  if (activePlayer(state).id !== playerId) return reject('not-your-turn');
  if (state.pendingRobber) return reject('invalid-robber-move', 'déplace le voleur d abord');
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
  events.push(...checkVictory(state, playerId));
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
  events.push(...checkVictory(state, playerId));
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
  events.push(...checkVictory(state, playerId));
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
  events.push(...checkVictory(state, playerId));
  return { ok: true, events };
}

// ── commerce ───────────────────────────────────────────────────────────────

/**
 * Échange avec la banque au taux de base : quatre cartes identiques contre
 * une au choix. Les ports, qui améliorent ce taux, viendront avec eux.
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
  if (amount(give, from) !== 4 || amount(receive, to) !== 1) {
    return reject('invalid-trade', 'le taux de base est de quatre contre une');
  }
  if (!canAfford(player.hand, give)) return reject('not-enough-resources');
  if (amount(state.bank, to) < 1) return reject('invalid-trade', 'la banque est à sec');

  player.hand = addCounts(subtractCounts(player.hand, give), receive);
  state.bank = subtractCounts(addCounts(state.bank, give), receive);

  return { ok: true, events: [{ type: 'BankTraded', player: playerId, give, receive }] };
}

// ── fin de tour ────────────────────────────────────────────────────────────

function endTurn(state: GameState, playerId: string): CommandResult {
  if (state.phase !== 'activeTurn') return reject(state.phase === 'production' ? 'must-roll-first' : 'wrong-phase');
  if (activePlayer(state).id !== playerId) return reject('not-your-turn');
  if (state.pendingRobber) return reject('invalid-robber-move', 'déplace le voleur d abord');
  if (someoneMustDiscard(state)) return reject('must-discard-first');

  const events: DomainEvent[] = [{ type: 'TurnEnded', player: playerId, cycle: state.cycle }];

  state.activeIndex = (state.activeIndex + 1) % state.players.length;
  state.cycle++;
  state.phase = 'production';
  state.lastRoll = undefined;

  // Les cartes achetées par le joueur qui prend la main deviennent jouables.
  const next = activePlayer(state);
  next.devCards = beginTurn(next.devCards);

  events.push({ type: 'PhaseChanged', from: 'activeTurn', to: 'production' });
  return { ok: true, events };
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

function checkVictory(state: GameState, playerId: string): DomainEvent[] {
  const points = victoryPoints(state.board, playerId, {
    hasLongestRoute: state.longestRouteHolder === playerId,
    hasLargestArmy: state.largestArmyHolder === playerId,
  }, state.config.victory);

  if (points < state.config.victory.target) return [];

  state.winner = playerId;
  state.phase = 'ended';
  return [{ type: 'GameWon', player: playerId, points }];
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
