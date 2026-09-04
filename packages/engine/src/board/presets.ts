/**
 * Génération de plateaux.
 *
 * Tout passe par le générateur seedé : deux parties de même graine ont
 * exactement le même plateau, ce qui rend une simulation comparable et un
 * bug reproductible.
 */

import type { SeededRandom } from '../rng.js';
import type { Terrain } from '../resources.js';
import { type Axial, DIRECTIONS, hexKey, hexesWithin, distance } from './axial.js';
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

/**
 * Les dix-neuf tuiles du plateau d'origine.
 *
 * Nommé plutôt que laissé en littéral : c'est la valeur qui décide si l'on
 * sert le plateau classique ou si l'on génère, et un `19` nu au milieu de ce
 * test ne dirait pas de quoi il parle.
 */
export const CLASSIC_LAND_COUNT = CLASSIC_TERRAINS.length;

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
 * Les ports ordinaires (§11) : deux tiers de spécialisés, un tiers de
 * génériques. Ils se répètent autant que la côte le permet.
 */
const COMMON_PORT_KINDS: readonly PortKind[] = [
  'generic', 'generic', 'wood', 'brick', 'wool', 'grain', 'ore',
];

/**
 * Les trois ports particuliers du §11, **en un seul exemplaire**.
 *
 * Ce sont des positions de course, comme la métropole : deux ports miniers
 * sur la même côte n'apprendraient rien de plus à la table, et un plateau
 * immense en aurait semé deux ou trois puisque les types s'y répètent.
 *
 * L'ordre compte : si le plateau est trop petit pour les quatre, c'est le
 * marchand qui reste, parce qu'il est le seul dont l'effet se comprend sans
 * avoir lu la règle.
 *
 * Le royal vient en dernier, et c'est voulu : il ne commerce pas: il paie en
 * Influence. Sur une petite côte, où chaque port compte pour le commerce
 * ordinaire, en poser un qui n'échange rien serait une place perdue.
 */
const UNIQUE_PORT_KINDS: readonly PortKind[] = ['merchant', 'mining', 'commercial', 'royal'];

/**
 * La liste des types à semer, pour un nombre de ports donné.
 *
 * Les particuliers sont plafonnés au tiers du total : sur une côte de six
 * ports, en mettre trois ferait un plateau où le commerce ordinaire est
 * l'exception.
 */
function portKinds(rng: SeededRandom, count: number): PortKind[] {
  const uniques = UNIQUE_PORT_KINDS.slice(0, Math.max(1, Math.floor(count / 3)));
  const commons = rng.shuffle(COMMON_PORT_KINDS);

  const kinds: PortKind[] = [...uniques];
  for (let i = 0; kinds.length < count; i++) {
    kinds.push(commons[i % commons.length] as PortKind);
  }
  return rng.shuffle(kinds);
}

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

  const kinds = portKinds(rng, count);
  const ports = new Map<VertexId, Port>();
  const taken = new Set<VertexId>();

  for (const vertex of rng.shuffle([...coastal].sort())) {
    if (ports.size >= count) break;
    if (taken.has(vertex)) continue;

    // Un type par port, sans repli cyclique : la liste a exactement la bonne
    // longueur, et boucler dessus dupliquerait les ports uniques.
    const kind = kinds[ports.size];
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
 * Grandes Colonies est conçu pour 8 à 12 joueurs (§2). En dessous, un plateau
 * de quarante-quatre hexagones disperse tellement les joueurs que la
 * production s'effondre : chacun ne touche que six tuiles sur quarante-quatre
 * et ne produit presque jamais. Le plateau classique convient mieux.
 */
export function usesXxlBoard(playerCount: number): boolean {
  return playerCount >= 8;
}

/**
 * Taille du plateau, au-delà de celle que l'effectif appelle.
 *
 * Le §4 dimensionne les terres sur le nombre de joueurs — quarante-quatre à
 * cinquante-deux — et c'est ce qui équilibre la partie. Ces échelles ne
 * corrigent pas ce dimensionnement : elles ouvrent une variante, pour une
 * table qui veut de la place à explorer plutôt qu'une course serrée. Le prix
 * en est une partie plus longue, mesuré plutôt que supposé (voir
 * SIMULATION_FINDINGS.md).
 */
export type BoardScale = 'normal' | 'grand' | 'immense';

const SCALES: Record<BoardScale, number> = { normal: 1, grand: 1.6, immense: 2.4 };

/** Le facteur d'une échelle. Vaut 1 pour `normal` : rien ne bouge. */
export function scaleFactor(scale: BoardScale = 'normal'): number {
  return SCALES[scale] ?? 1;
}

/** Les terres prévues par le §4 pour cet effectif, avant mise à l'échelle. */
export function baseLandCount(playerCount: number): number {
  return Math.min(52, Math.max(44, playerCount * 4));
}

/**
 * La taille servie quand l'hôte n'en demande aucune.
 *
 * Ce n'est pas `baseLandCount` en dessous de huit joueurs : le §4 dimensionne
 * pour les tables de huit à douze, et appliquer ses quarante-quatre terres à
 * une table de quatre disperse tellement les joueurs que la production
 * s'effondre — chacun ne touche que six tuiles sur quarante-quatre. Le
 * plateau classique reste donc le défaut des petites tables, comme avant que
 * la taille soit réglable. Ce qui change, c'est qu'on peut désormais le
 * quitter.
 */
export function defaultLandCount(playerCount: number): number {
  return usesXxlBoard(playerCount) ? baseLandCount(playerCount) : CLASSIC_LAND_COUNT;
}

/**
 * Bornes du nombre de terres réglable à la main.
 *
 * En deçà de dix-neuf, on passe sous le plateau de Catan classique et il ne
 * reste plus assez de sommets pour asseoir même quatre joueurs. Au-delà de
 * cent trente, la génération tient toujours mais la traversée devient si
 * longue que les îles lointaines ne sont jamais atteintes.
 */
export const LAND_LIMITS = { min: 19, max: 130 } as const;

/**
 * Le plus petit plateau où la mise en place tient encore.
 *
 * Chaque joueur pose deux colonies, et la règle d'écartement en stérilise les
 * sommets voisins : la capacité d'un plateau tourne autour d'une colonie par
 * hexagone de terre. En deçà, la mise en place **se bloque** — les derniers
 * joueurs n'ont plus où poser et la partie ne démarre jamais.
 *
 * Mesuré plutôt que supposé, sur huit plateaux tirés par effectif : la
 * capacité tombe sous le nécessaire à vingt terres pour onze joueurs et
 * vingt et une pour douze. On retient le double de l'effectif, qui laisse une
 * marge à toutes les tables sans rien interdire d'utile — la valeur par
 * défaut à douze joueurs est de quarante-huit.
 */
export function minLandFor(playerCount: number): number {
  return Math.max(CLASSIC_LAND_COUNT, playerCount * 2);
}

/**
 * Combien de terres, qu'on ait demandé une échelle ou un nombre.
 *
 * Les deux formes coexistent volontairement : les préréglages restent la
 * façon de dire « comme prévu pour cet effectif, en plus grand », et servent
 * aux scripts de mesure ; le nombre est ce que règle l'hôte, qui veut une
 * taille à lui et non un multiple de ce que son effectif appelle.
 *
 * Le plancher dépend de l'effectif : c'est le seul endroit que traversent
 * toutes les demandes, donc le seul où l'interdit tient vraiment.
 */
export function landCountFor(playerCount: number, size: BoardSize = 'normal'): number {
  const asked = typeof size === 'number'
    ? Math.round(size)
    : Math.round(baseLandCount(playerCount) * scaleFactor(size));
  const floor = Math.max(LAND_LIMITS.min, minLandFor(playerCount));
  return Math.min(LAND_LIMITS.max, Math.max(floor, asked));
}

/** Une taille de plateau : un préréglage, ou un nombre de terres. */
export type BoardSize = BoardScale | number;

/**
 * Ce que cette surface vaut, rapportée à celle que l'effectif appelle.
 *
 * C'est ce rapport — et non le préréglage — qui dose déserts, or et îles.
 * Les faire suivre l'échelle nommée les aurait laissés au nombre du plateau
 * normal dès qu'on règle la taille au chiffre, et l'or aurait disparu dans
 * un plateau deux fois plus grand où il cesse d'être une raison de naviguer.
 */
function spread(playerCount: number, landCount: number): number {
  return landCount / baseLandCount(playerCount);
}

export function xxlOptionsFor(playerCount: number, size: BoardSize = 'normal'): XxlOptions {
  // Le game design prévoit 44 à 52 hexagones selon l'effectif (§4).
  const landCount = landCountFor(playerCount, size);
  const factor = spread(playerCount, landCount);
  return {
    landCount,
    // Déserts et or suivent la surface : gardés au nombre prévu pour un
    // plateau normal, ils disparaîtraient dans un plateau deux fois plus
    // grand, où l'or cesserait d'être une raison de naviguer.
    deserts: Math.round((playerCount >= 11 ? 4 : 3) * factor),
    seaRing: true,
    gold: Math.round((playerCount >= 10 ? 3 : 2) * factor),
  };
}

/**
 * Plateau XXL de Grandes Colonies.
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
  // Le plafond suit lui aussi : figé à douze, il laissait un plateau de cent
  // hexagones avec la même façade maritime qu'un plateau de cinquante.
  const portCount = Math.max(6, Math.round(options.landCount / 5));
  return { positions, hexes, ports: placePorts(rng, landKeys, hexes, portCount) };
}

// ── archipel ───────────────────────────────────────────────────────────────

export interface ArchipelagoOptions {
  /** Hexagones de terre ferme, toutes îles confondues. */
  readonly landCount: number;
  /** Îles secondaires, en plus de l'île centrale. */
  readonly islands: number;
  readonly deserts: number;
  readonly gold?: number;
  /**
   * Part des terres revenant à l'île centrale.
   *
   * Trois quarts, mesuré plutôt que choisi. À 55 %, les îles secondaires
   * enferment trop de terrain derrière la mer : à douze joueurs, six parties
   * simulées sur vingt-quatre parvenaient à se conclure. À 75 %, on remonte à
   * vingt et une, sans que l'exploration cesse d'avoir lieu.
   */
  readonly mainShare?: number;
}

export function archipelagoOptionsFor(
  playerCount: number,
  size: BoardSize = 'normal',
): ArchipelagoOptions {
  const landCount = landCountFor(playerCount, size);
  const factor = spread(playerCount, landCount);
  const islands = playerCount >= 11 ? 3 : 2;
  return {
    landCount,
    /*
     * Plus de terres, plus d'îles — et non des îles démesurées.
     *
     * Multiplier les seules surfaces aurait donné deux continents où l'on
     * navigue une fois pour toutes ; c'est le nombre de rives qui fait
     * l'exploration. Six au plus : les centres suivent les six directions
     * axiales, au-delà deux îles se superposeraient.
     */
    islands: Math.min(DIRECTIONS.length, Math.max(1, Math.round(islands * factor))),
    deserts: Math.round((playerCount >= 11 ? 4 : 3) * factor),
    gold: Math.round((playerCount >= 10 ? 3 : 2) * factor),
  };
}

/** Le plus petit rayon dont le disque contient au moins `count` hexagones. */
function radiusFor(count: number): number {
  let radius = 0;
  while (hexesWithin(CENTER, radius).length < count) radius++;
  return radius;
}

/**
 * Plateau en archipel : une île centrale disputée, deux ou trois îles
 * majeures autour (§4 du game design).
 *
 * Les îles sont séparées par au moins un hexagone de mer. C'est cette
 * séparation qui fait tout : sans elle, la voie maritime resterait un
 * raccourci facultatif au lieu d'être le seul chemin vers les terres neuves.
 */
export function archipelagoBoard(rng: SeededRandom, options: ArchipelagoOptions): BoardInit {
  // L'île centrale porte un peu plus de la moitié des terres : elle doit
  // rester la région disputée, pas une île comme les autres.
  const mainCount = Math.round(options.landCount * (options.mainShare ?? 0.75));
  const perIsland = Math.max(4, Math.floor((options.landCount - mainCount) / options.islands));

  const mainRadius = radiusFor(mainCount);
  const islandRadius = radiusFor(perIsland);

  // Deux rangs de mer séparent le bord de l'île centrale du bord d'une île
  // secondaire : un seul les séparerait déjà, mais deux laissent la place
  // d'un vrai trajet maritime plutôt que d'un simple saut.
  const orbit = mainRadius + islandRadius + 3;

  const land: Axial[] = spiral(mainRadius).slice(0, mainCount);

  // Les centres suivent les directions axiales, pas un cercle trigonométrique :
  // en coordonnées axiales, `cos` et `sin` donnent des distances fausses — deux
  // îles censées être à égale distance se retrouvaient à 7 et 10 rangs.
  const step = Math.floor(DIRECTIONS.length / options.islands);
  for (let i = 0; i < options.islands; i++) {
    const direction = DIRECTIONS[(i * step) % DIRECTIONS.length] as Axial;
    const center: Axial = { q: direction.q * orbit, r: direction.r * orbit };
    const blob = hexesWithin(center, islandRadius)
      .sort((a, b) => distance(center, a) - distance(center, b) || hexKey(a).localeCompare(hexKey(b)))
      .slice(0, perIsland);
    land.push(...blob);
  }

  const landKeys = new Set(land.map(hexKey));

  /**
   * Le plateau n'est pas un disque mais le halo des terres.
   *
   * Un disque englobant gaspillait des centaines d'hexagones de haute mer que
   * personne n'atteindrait jamais — 397 pour 44 terres. Deux rangs autour de
   * chaque île suffisent, et comme les îles sont écartées de deux rangs
   * exactement, les halos se rejoignent : la mer reste navigable d'un bout à
   * l'autre de l'archipel.
   */
  const positions: Axial[] = [];
  const seen = new Set<HexId>();
  for (const hex of land) {
    for (const around of hexesWithin(hex, 2)) {
      const key = hexKey(around);
      if (seen.has(key)) continue;
      seen.add(key);
      positions.push(around);
    }
  }
  positions.sort((a, b) => hexKey(a).localeCompare(hexKey(b)));

  const terrains = buildTerrains(rng, landKeys.size, options.deserts, options.gold ?? 0);
  const tokens = rng.shuffle(bellTokens(terrains.filter((t) => t !== 'desert').length));

  const hexes = new Map<HexId, HexData>();
  let terrainIndex = 0;
  let tokenIndex = 0;

  const terrainOf = new Map<HexId, Terrain>();
  for (const key of [...landKeys].sort()) terrainOf.set(key, terrains[terrainIndex++] ?? 'desert');

  for (const position of positions) {
    const key = hexKey(position);
    const terrain = terrainOf.get(key);
    if (terrain === undefined) {
      hexes.set(key, { terrain: 'sea' });
      continue;
    }
    if (terrain === 'desert') {
      hexes.set(key, { terrain });
      continue;
    }
    hexes.set(key, { terrain, token: tokens[tokenIndex++] as Token });
  }

  const portCount = Math.max(6, Math.round(options.landCount / 5));
  return { positions, hexes, ports: placePorts(rng, landKeys, hexes, portCount) };
}

/** Terrains d'un plateau, mélangés : productifs, or, puis déserts. */
function buildTerrains(
  rng: SeededRandom,
  landCount: number,
  deserts: number,
  gold: number,
): Terrain[] {
  const productive: Terrain[] = ['forest', 'pasture', 'field', 'hills', 'mountain'];
  const out: Terrain[] = [];
  for (let i = 0; i < landCount - deserts - gold; i++) {
    out.push(productive[i % productive.length] as Terrain);
  }
  for (let i = 0; i < gold; i++) out.push('gold');
  for (let i = 0; i < deserts; i++) out.push('desert');
  return rng.shuffle(out);
}

/** Jetons en cloche, aux fréquences de Catan. */
function bellTokens(count: number): Token[] {
  const weights: readonly [Token, number][] = [
    [2, 1], [3, 2], [4, 2], [5, 2], [6, 2], [8, 2], [9, 2], [10, 2], [11, 2], [12, 1],
  ];
  const tokens: Token[] = [];
  while (tokens.length < count) {
    for (const [value, n] of weights) {
      for (let i = 0; i < n && tokens.length < count; i++) tokens.push(value);
    }
  }
  return tokens;
}
