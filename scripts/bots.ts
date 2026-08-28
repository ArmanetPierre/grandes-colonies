/**
 * Adversaires automatiques, branchés comme de vrais clients.
 *
 * Les bots du paquet `sim` décident à partir de l'état complet de la partie :
 * ils servent à simuler en mémoire, pas à jouer en réseau. Ceux-ci ne voient
 * que ce qu'un joueur voit — sa vue publique et sa vue privée — et passent
 * par le même WebSocket que tout le monde. Ils ne peuvent donc pas tricher,
 * et ce qu'ils font est exactement ce qu'un humain pourrait faire.
 *
 *   BOTS=11 npm run play      onze adversaires, une place pour toi
 *   npx tsx scripts/bots.ts 5 cinq adversaires sur une partie déjà lancée
 */

import { WebSocket } from 'ws';

import { COSTS, RESOURCES, type ResourceCounts, amount, canAfford, total } from '@grand-colonies/engine';

const URL = process.env['BOT_URL'] ?? 'ws://localhost:2567';
const COUNT = Number(process.argv[2] ?? process.env['BOTS'] ?? 3);

/** Des noms grecs, pour que la table ait l'air d'une table. */
const NAMES = [
  'Ariane', 'Démétrios', 'Eirène', 'Phaidon', 'Kallisto', 'Lysandre',
  'Myrto', 'Nikandre', 'Xanthippe', 'Sophos', 'Thalassa', 'Zéno',
];

interface PrivateView {
  readonly capabilities: readonly string[];
  readonly hand: Record<string, number>;
  readonly mustDiscard: number;
  readonly playableDevCards: readonly string[];
  readonly bankRates: Record<string, number>;
  readonly acceptableOffers: readonly string[];
  readonly spots: {
    readonly settlements: readonly string[];
    readonly cities: readonly string[];
    readonly roads: readonly string[];
    readonly maritime: readonly string[];
    readonly metropolises: readonly string[];
    readonly monuments: readonly string[];
    readonly robber: readonly string[];
    readonly robberVictims: Record<string, readonly string[]>;
  };
}

interface PublicView {
  readonly offers: readonly { id: string; from: string; receive: Record<string, number> }[];
}

let actionCounter = 0;
const nextId = (): string => `bot-${Date.now().toString(36)}-${actionCounter++}`;

/** Les ressources que le bot possède en trop, de la plus abondante à la moins. */
function bySurplus(hand: Record<string, number>): string[] {
  return RESOURCES.filter((r) => (hand[r] ?? 0) > 0)
    .sort((a, b) => (hand[b] ?? 0) - (hand[a] ?? 0));
}

/** Celle dont il manque le plus, parmi les cinq ressources de base. */
function scarcest(hand: Record<string, number>): string {
  const core = ['wood', 'brick', 'wool', 'grain', 'ore'];
  return core.reduce((worst, r) => ((hand[r] ?? 0) < (hand[worst] ?? 0) ? r : worst), core[0] as string);
}

/**
 * Ce que le bot fait, dans l'ordre de ce qui rapporte.
 *
 * Volontairement simple : il construit dès qu'il peut, par ordre de valeur en
 * points, et convertit son surplus plutôt que de thésauriser. Il ne planifie
 * pas et ne marchande pas — un humain le battra, et c'est très bien : ces
 * bots sont là pour que la partie tourne, pas pour gagner.
 */
function decide(priv: PrivateView, pub: PublicView): Record<string, unknown> | undefined {
  const caps = new Set(priv.capabilities);
  const hand = priv.hand;
  const spots = priv.spots;

  if (caps.has('CAN_DISCARD')) {
    // On se sépare d'abord du plus abondant : c'est ce qui coûte le moins.
    const resources: Record<string, number> = {};
    let left = priv.mustDiscard;
    for (const r of bySurplus(hand)) {
      if (left <= 0) break;
      const take = Math.min(left, hand[r] ?? 0);
      resources[r] = take;
      left -= take;
    }
    return { type: 'DISCARD', resources };
  }

  if (caps.has('CAN_PLACE_SETUP')) {
    if (spots.roads.length > 0) return { type: 'PLACE_SETUP_ROAD', edge: spots.roads[0] };
    if (spots.settlements.length > 0) return { type: 'PLACE_SETUP_SETTLEMENT', vertex: spots.settlements[0] };
    return undefined;
  }

  if (caps.has('CAN_MOVE_ROBBER')) {
    const hex = spots.robber[0];
    if (hex === undefined) return undefined;
    // On vise de préférence un hexagone où il y a quelqu'un à dépouiller.
    const target = spots.robber.find((h) => (spots.robberVictims[h] ?? []).length > 0) ?? hex;
    const victim = (spots.robberVictims[target] ?? [])[0];
    return { type: 'MOVE_ROBBER', to: target, ...(victim ? { victim } : {}) };
  }

  if (caps.has('CAN_PLAY_KNIGHT') && priv.playableDevCards.includes('knight')) {
    const target = spots.robber.find((h) => (spots.robberVictims[h] ?? []).length > 0) ?? spots.robber[0];
    if (target !== undefined) {
      const victim = (spots.robberVictims[target] ?? [])[0];
      return { type: 'PLAY_KNIGHT', to: target, ...(victim ? { victim } : {}) };
    }
  }

  if (caps.has('CAN_ROLL_DICE')) return { type: 'ROLL_DICE' };

  // Une offre qui apporte ce qui manque se prend sans réfléchir.
  for (const id of priv.acceptableOffers) {
    const offer = pub.offers.find((o) => o.id === id);
    if (offer && canAfford(hand as ResourceCounts, offer.receive as ResourceCounts)) {
      return { type: 'ACCEPT_TRADE', offerId: id };
    }
  }

  if (caps.has('CAN_PLAY_DEV_CARD')) {
    const playable = priv.playableDevCards;
    if (playable.includes('freeBuild') && spots.cities.length > 0) {
      return { type: 'PLAY_FREE_BUILD', target: { kind: 'city', vertex: spots.cities[0] } };
    }
    if (playable.includes('roadBuilding') && spots.roads.length > 0) {
      return { type: 'PLAY_ROAD_BUILDING', edges: spots.roads.slice(0, 2) };
    }
    if (playable.includes('invention')) {
      return { type: 'PLAY_INVENTION', resources: { [scarcest(hand)]: 2 } };
    }
    if (playable.includes('monopoly')) {
      return { type: 'PLAY_MONOPOLY', resource: scarcest(hand) };
    }
  }

  if (caps.has('CAN_BUILD')) {
    const h = hand as ResourceCounts;
    // L'ordre suit la valeur en points, le monument d'abord : deux points
    // pour cinq ressources, et sans emplacement à trouver.
    if (canAfford(h, COSTS.monument) && spots.monuments.length > 0) {
      return { type: 'BUILD_MONUMENT', vertex: spots.monuments[0] };
    }
    if (canAfford(h, COSTS.metropolis) && spots.metropolises.length > 0) {
      return { type: 'BUILD_METROPOLIS', vertex: spots.metropolises[0] };
    }
    if (canAfford(h, COSTS.city) && spots.cities.length > 0) {
      return { type: 'BUILD_CITY', vertex: spots.cities[0] };
    }
    if (canAfford(h, COSTS.settlement) && spots.settlements.length > 0) {
      return { type: 'BUILD_SETTLEMENT', vertex: spots.settlements[0] };
    }
    if (canAfford(h, COSTS.road) && spots.roads.length > 0) {
      return { type: 'BUILD_ROAD', edge: spots.roads[0] };
    }
    if (canAfford(h, COSTS.maritimeRoute) && spots.maritime.length > 0) {
      return { type: 'BUILD_MARITIME_ROUTE', edge: spots.maritime[0] };
    }
  }

  if (caps.has('CAN_BUY_DEV_CARD') && canAfford(hand as ResourceCounts, COSTS.devCard)) {
    return { type: 'BUY_DEV_CARD' };
  }

  // Rien d'abordable : on convertit un surplus plutôt que d'attendre un 7.
  if (caps.has('CAN_TRADE_BANK') && total(hand as ResourceCounts) >= 5) {
    const need = scarcest(hand);
    for (const r of bySurplus(hand)) {
      const rate = priv.bankRates[r] ?? 4;
      if (r !== need && (hand[r] ?? 0) >= rate) {
        return { type: 'TRADE_WITH_BANK', give: { [r]: rate }, receive: { [need]: 1 } };
      }
    }
  }

  if (caps.has('CAN_END_TURN')) return { type: 'END_TURN' };
  if (caps.has('CAN_END_CYCLE')) return { type: 'END_CYCLE' };
  return undefined;
}

/** Un bot, du raccordement à sa dernière décision. */
function connect(name: string): void {
  const socket = new WebSocket(URL);
  let priv: PrivateView | undefined;
  let pub: PublicView | undefined;
  let last = '';

  socket.on('open', () => socket.send(JSON.stringify({ type: 'join', name })));
  socket.on('error', (error) => console.error(`  ${name} : ${error.message}`));

  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as { type: string; payload: unknown };
    if (frame.type === 'seat') console.log(`  ${name} rejoint`);
    if (frame.type === 'full') console.log(`  ${name} : partie complète`);
    if (frame.type === 'public') pub = frame.payload as PublicView;
    if (frame.type === 'private') priv = frame.payload as PrivateView;
    if (!priv || !pub) return;

    const command = decide(priv, pub);
    if (!command) { last = ''; return; }

    // Un garde-fou : si le serveur refuse toujours la même chose, on cesse
    // de la répéter plutôt que d'inonder la partie.
    const signature = JSON.stringify(command);
    if (signature === last) return;
    last = signature;

    // Un court délai rend la partie lisible : sans lui, douze bots jouent
    // un cycle entier avant que l'écran n'ait fini de se redessiner.
    setTimeout(() => {
      if (socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify({ type: 'command', command: { actionId: nextId(), ...command } }));
      }
    }, 350 + Math.random() * 450);
  });
}

console.log(`  ${COUNT} adversaires se connectent à ${URL}`);
for (let i = 0; i < COUNT; i++) connect(NAMES[i % NAMES.length] ?? `Bot ${i + 1}`);
