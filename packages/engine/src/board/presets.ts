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
import type { HexId } from './graph.js';

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

  return { positions, hexes };
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

  return { positions, hexes };
}
