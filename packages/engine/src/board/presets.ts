/**
 * Génération de plateaux.
 *
 * Tout passe par le générateur seedé : deux parties de même graine ont
 * exactement le même plateau, ce qui rend une simulation comparable et un
 * bug reproductible.
 */

import type { SeededRandom } from '../rng.js';
import type { Terrain } from '../resources.js';
import { type Axial, hexKey, hexesWithin, distance } from './axial.js';
import type { BoardInit, HexData, Token } from './board.js';
import { type HexId, type VertexId, vertexIdsOfHex } from './graph.js';
import type { Port, PortKind } from '../ports.js';

/**
 * Séquence des jetons du Catan classique.
 *
 * Elle n'est pas aléatoire : posée en spirale, elle éloigne mécaniquement les
 * 6 et les 8 les uns des autres. Un tirage purement aléatoire produirait
 * régulièrement des plateaux où trois numéros forts se touchent, donnant une
 * position de départ décisive avant même le premier lancer.
 */
const CLASSIC_TOKEN_SEQUENCE: readonly Token[] = [
  5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11,
];

/** Proportions de terrain du Catan classique, pour 19 hexagones. */
const CLASSIC_TERRAINS: readonly Terrain[] = [
  ...Array<Terrain>(4).fill('forest'),
  ...Array<Terrain>(4).fill('pasture'),
  ...Array<Terrain>(4).fill('field'),
  ...Array<Terrain>(3).fill('hills'),
  ...Array<Terrain>(3).fill('mountain'),
  'desert',
];

const CENTER: Axial = { q: 0, r: 0 };

/**
 * Parcours en spirale depuis le centre.
 *
 * Sert à poser les jetons dans l'ordre de la séquence classique, qui suppose
 * précisément ce parcours.
 */
function spiral(radius: number): Axial[] {
  const hexes = hexesWithin(CENTER, radius);
  return hexes.sort((a, b) => {
    const da = distance(CENTER, a);
    const db = distance(CENTER, b);
    if (da !== db) return da - db;
    // À distance égale, l'angle donne un ordre stable autour de l'anneau.
    return Math.atan2(a.r, a.q) - Math.atan2(b.r, b.q);
  });
}

/** Le plateau du Catan classique : 19 tuiles, proportions et jetons d'origine. */
export function classicBoard(rng: SeededRandom): BoardInit {
  const positions = spiral(2);
  const terrains = rng.shuffle(CLASSIC_TERRAINS);
  const hexes = new Map<HexId, HexData>();

  let tokenIndex = 0;
  positions.forEach((position, i) => {
    const terrain = terrains[i] ?? 'desert';
    if (terrain === 'desert') {
      // Le désert ne produit rien : il ne consomme pas de jeton.
      hexes.set(hexKey(position), { terrain });
      return;
    }
    const token = CLASSIC_TOKEN_SEQUENCE[tokenIndex % CLASSIC_TOKEN_SEQUENCE.length] as Token;
    tokenIndex++;
    hexes.set(hexKey(position), { terrain, token });
  });

  const landKeys = new Set(positions.map(hexKey));
  return { positions, hexes, ports: placePorts(rng, landKeys, hexes, 9) };
}

/**
 * Répartition des ports (§11) : deux tiers de spécialisés, un tiers de
 * génériques, plus un port marchand qui donne 2:1 sur tout.
 */
const PORT_KINDS: readonly PortKind[] = [
  'generic', 'generic', 'wood', 'brick', 'wool', 'grain', 'ore', 'merchant',
];

/**
 * Place les ports sur des sommets côtiers, espacés les uns des autres.
 *
 * L'espacement compte : deux ports adjacents seraient captés par une seule
 * colonie, ce qui donnerait un avantage décisif au premier joueur qui la pose.
 */
function placePorts(
  rng: SeededRandom,
  landKeys: ReadonlySet<HexId>,
  hexes: ReadonlyMap<HexId, HexData>,
  count: number,
): Map<VertexId, Port> {
  // Un sommet est côtier s'il touche à la fois une terre et une non-terre.
  const coastal = new Set<VertexId>();
  for (const key of landKeys) {
    const [q, r] = key.split(',').map(Number);
    if (q === undefined || r === undefined) continue;
    for (const vertex of vertexIdsOfHex({ q, r })) {
      const touching = vertex.split('|');
      const touchesLand = touching.some((h) => landKeys.has(h));
      const touchesWater = touching.some((h) => !landKeys.has(h) || hexes.get(h)?.terrain === 'sea');
      if (touchesLand && touchesWater) coastal.add(vertex);
    }
  }

  const kinds = rng.shuffle(PORT_KINDS);
  const ports = new Map<VertexId, Port>();
  const taken = new Set<VertexId>();

  for (const vertex of rng.shuffle([...coastal].sort())) {
    if (ports.size >= count) break;
    if (taken.has(vertex)) continue;

    const kind = kinds[ports.size % kinds.length];
    if (kind === undefined) break;
    ports.set(vertex, { kind });

    // On réserve les sommets voisins pour éviter deux ports sur une colonie.
    taken.add(vertex);
    for (const neighbour of adjacentVertexKeys(vertex)) taken.add(neighbour);
  }

  return ports;
}

/** Sommets voisins, déduits des trios d'hexagones (voir graph.ts). */
function adjacentVertexKeys(vertex: VertexId): VertexId[] {
  const hexes = vertex.split('|');
  const out: VertexId[] = [];
  for (let i = 0; i < hexes.length; i++) {
    for (let j = i + 1; j < hexes.length; j++) {
      const a = hexes[i];
      const b = hexes[j];
      if (a !== undefined && b !== undefined) out.push([a, b].sort().join('|'));
    }
  }
  return out;
}

export interface XxlOptions {
  /** Nombre d'hexagones de terrain ferme visés (44 à 52 selon le §4). */
  readonly landCount: number;
  /** Proportion de déserts. */
  readonly deserts: number;
  /** Ajouter une couronne de mer autour des terres. */
  readonly seaRing?: boolean;
  /** Activer les tuiles d'or. */
  readonly gold?: number;
}

/**
 * Le plateau XXL est-il pertinent à cet effectif ?
 *
 * Grand Colonies est conçu pour 8 à 12 joueurs (§2). En dessous, un plateau
 * de quarante-quatre hexagones disperse tellement les joueurs que la
 * production s'effondre : chacun ne touche que six tuiles sur quarante-quatre
 * et ne produit presque jamais. Le plateau classique convient mieux.
 */
export function usesXxlBoard(playerCount: number): boolean {
  return playerCount >= 8;
}

export function xxlOptionsFor(playerCount: number): XxlOptions {
  // Le game design prévoit 44 à 52 hexagones selon l'effectif (§4).
  const landCount = Math.min(52, Math.max(44, playerCount * 4));
  return {
    landCount,
    deserts: playerCount >= 11 ? 4 : 3,
    seaRing: true,
    gold: playerCount >= 10 ? 3 : 2,
  };
}

/**
 * Plateau XXL de Grand Colonies.
 *
 * Les terres occupent le cœur du disque, la mer forme le pourtour. La
 * répartition des jetons est ici tirée au sort plutôt que posée en spirale :
 * la séquence classique ne vaut que pour 19 tuiles, et l'équilibrage d'un
 * plateau de cinquante reste une question ouverte que la simulation devra
 * trancher.
 */
export function xxlBoard(rng: SeededRandom, options: XxlOptions): BoardInit {
  // Rayon minimal contenant assez de terres.
  let radius = 1;
  while (hexesWithin(CENTER, radius).length < options.landCount) radius++;

  const inner = spiral(radius).slice(0, options.landCount);
  const positions = options.seaRing ? hexesWithin(CENTER, radius + 1) : inner;

  const landTerrains: Terrain[] = [];
  const productive: Terrain[] = ['forest', 'pasture', 'field', 'hills', 'mountain'];
  const goldCount = options.gold ?? 0;

  for (let i = 0; i < options.landCount - options.deserts - goldCount; i++) {
    landTerrains.push(productive[i % productive.length] as Terrain);
  }
  for (let i = 0; i < goldCount; i++) landTerrains.push('gold');
  for (let i = 0; i < options.deserts; i++) landTerrains.push('desert');

  const shuffled = rng.shuffle(landTerrains);
  const tokens: Token[] = [];
  // Distribution en cloche, reprise des fréquences de Catan.
  const weights: readonly [Token, number][] = [
    [2, 1], [3, 2], [4, 2], [5, 2], [6, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 1],
  ];
  while (tokens.length < shuffled.length) {
    for (const [value, count] of weights) {
      for (let i = 0; i < count && tokens.length < shuffled.length; i++) tokens.push(value);
    }
  }
  const shuffledTokens = rng.shuffle(tokens);

  const hexes = new Map<HexId, HexData>();
  const landKeys = new Set(inner.map(hexKey));

  let tokenIndex = 0;
  for (const position of positions) {
    const key = hexKey(position);
    if (!landKeys.has(key)) {
      hexes.set(key, { terrain: 'sea' });
      continue;
    }
    const index = inner.findIndex((p) => hexKey(p) === key);
    const terrain = shuffled[index] ?? 'desert';
    if (terrain === 'desert') {
      hexes.set(key, { terrain });
      continue;
    }
    hexes.set(key, { terrain, token: shuffledTokens[tokenIndex++] as Token });
  }

  // Le §4 prévoit 6 à 8 ports ; on suit l'effectif via la taille des terres.
  const portCount = Math.min(12, Math.max(6, Math.round(options.landCount / 5)));
  return { positions, hexes, ports: placePorts(rng, landKeys, hexes, portCount) };
}
