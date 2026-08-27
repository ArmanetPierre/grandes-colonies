/**
 * Ressources, terrains et coûts de construction.
 *
 * Les quantités sont manipulées par fonctions pures : un inventaire n'est
 * jamais modifié en place. C'est ce qui rend l'état rejouable à l'identique
 * depuis un journal de commandes, et donc les bugs reproductibles.
 */

/** Les cinq ressources classiques, plus les deux du mode avancé. */
export const RESOURCES = ['wood', 'brick', 'wool', 'grain', 'ore', 'gold', 'fish'] as const;
export type Resource = (typeof RESOURCES)[number];

/** Les cinq qui servent à construire. Or et poisson ont leurs propres usages. */
export const CORE_RESOURCES = ['wood', 'brick', 'wool', 'grain', 'ore'] as const;
export type CoreResource = (typeof CORE_RESOURCES)[number];

export const TERRAINS = [
  'forest', 'pasture', 'field', 'hills', 'mountain',
  'desert', 'sea', 'gold', 'fish', 'unexplored',
] as const;
export type Terrain = (typeof TERRAINS)[number];

/**
 * Ce que produit chaque terrain. Les identifiants correspondent exactement
 * aux tuiles de assets/prompts.json — un terrain, une image, une ressource.
 */
const TERRAIN_YIELD: Readonly<Record<Terrain, Resource | null>> = {
  forest: 'wood',
  pasture: 'wool',
  field: 'grain',
  hills: 'brick',
  mountain: 'ore',
  gold: 'gold',
  fish: 'fish',
  desert: null,
  sea: null,
  unexplored: null,
};

export function yieldOf(terrain: Terrain): Resource | null {
  return TERRAIN_YIELD[terrain];
}

/** Un terrain produit-il quoi que ce soit ? */
export function isProductive(terrain: Terrain): boolean {
  return TERRAIN_YIELD[terrain] !== null;
}

export type ResourceCounts = Readonly<Partial<Record<Resource, number>>>;

export const EMPTY: ResourceCounts = Object.freeze({});

export function counts(entries: ResourceCounts): ResourceCounts {
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const n = entries[r] ?? 0;
    if (n !== 0) out[r] = n;
  }
  return Object.freeze(out);
}

export function amount(c: ResourceCounts, r: Resource): number {
  return c[r] ?? 0;
}

/** Nombre total de cartes en main — c'est lui que borne la limite de main. */
export function total(c: ResourceCounts): number {
  let sum = 0;
  for (const r of RESOURCES) sum += c[r] ?? 0;
  return sum;
}

export function addCounts(a: ResourceCounts, b: ResourceCounts): ResourceCounts {
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const n = (a[r] ?? 0) + (b[r] ?? 0);
    if (n !== 0) out[r] = n;
  }
  return Object.freeze(out);
}

/**
 * Retranche `b` de `a`. Ne vérifie pas la disponibilité : les règles
 * appellent `canAfford` d'abord. Autoriser un négatif silencieux masquerait
 * un bug de validation, on lève donc une erreur.
 */
export function subtractCounts(a: ResourceCounts, b: ResourceCounts): ResourceCounts {
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const n = (a[r] ?? 0) - (b[r] ?? 0);
    if (n < 0) throw new Error(`Retrait impossible : ${r} passerait à ${n}`);
    if (n !== 0) out[r] = n;
  }
  return Object.freeze(out);
}

export function canAfford(have: ResourceCounts, cost: ResourceCounts): boolean {
  for (const r of RESOURCES) {
    if ((have[r] ?? 0) < (cost[r] ?? 0)) return false;
  }
  return true;
}

/** Ce qui manque pour payer `cost` — sert à expliquer un bouton grisé. */
export function missingFor(have: ResourceCounts, cost: ResourceCounts): ResourceCounts {
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const lack = (cost[r] ?? 0) - (have[r] ?? 0);
    if (lack > 0) out[r] = lack;
  }
  return Object.freeze(out);
}

export type Buildable =
  | 'road' | 'settlement' | 'city' | 'metropolis' | 'monument'
  | 'devCard' | 'maritimeRoute' | 'tradingPost';

/**
 * Coûts de construction. Les quatre premiers sont ceux de Catan ; la route
 * maritime et le comptoir viennent de Grand Colonies (§12 du game design).
 */
export const COSTS: Readonly<Record<Buildable, ResourceCounts>> = Object.freeze({
  road: counts({ wood: 1, brick: 1 }),
  settlement: counts({ wood: 1, brick: 1, wool: 1, grain: 1 }),
  city: counts({ ore: 3, grain: 2 }),
  // L'or n'avait aucun usage : produit, compté par la banque, réclamé par
  // rien. La métropole le lui donne, et donne aux tuiles d'or une valeur de
  // placement (contrat §8).
  metropolis: counts({ ore: 3, grain: 2, gold: 2 }),
  // Une ressource de chaque : le monument oblige à passer par le commerce,
  // ce qui fait vivre la table au lieu de l'assécher.
  monument: counts({ wood: 1, brick: 1, wool: 1, grain: 1, ore: 1 }),
  devCard: counts({ ore: 1, wool: 1, grain: 1 }),
  maritimeRoute: counts({ wood: 1, wool: 1 }),
  tradingPost: counts({ brick: 2, wool: 1 }),
});
