/**
 * Production sur lancer de dés.
 *
 * Deux règles propres à Grandes Colonies s'ajoutent à Catan :
 *   — 2 et 12 produisent double (§6), pour rendre les emplacements rares
 *     réellement attractifs ;
 *   — plusieurs voleurs peuvent bloquer simultanément (§25).
 */

import { type Board, type PlayerId, buildingYield } from './board/board.js';
import { hexesOfVertex, vertexIdsOfHex } from './board/graph.js';
import { hexKey, parseHexKey } from './board/axial.js';
import {
  type Resource,
  type ResourceCounts,
  RESOURCES,
  addCounts,
  amount,
  counts,
  yieldOf,
} from './resources.js';

export interface ProductionConfig {
  /** Valeurs dont la production est doublée. Grandes Colonies : 2 et 12. */
  readonly doubledNumbers: readonly number[];
}

export const CLASSIC_PRODUCTION: ProductionConfig = Object.freeze({ doubledNumbers: [] });
export const GRAND_COLONIES_PRODUCTION: ProductionConfig = Object.freeze({ doubledNumbers: [2, 12] });

export type Production = ReadonlyMap<PlayerId, ResourceCounts>;

/**
 * Ce que chaque joueur devrait recevoir pour ce lancer, sans tenir compte
 * du stock de la banque — `applyBankLimits` s'en charge ensuite.
 */
export function computeProduction(
  board: Board,
  roll: number,
  config: ProductionConfig = GRAND_COLONIES_PRODUCTION,
): Production {
  const out = new Map<PlayerId, ResourceCounts>();
  if (roll === 7) return out; // le 7 ne produit rien : il appelle le voleur

  const multiplier = config.doubledNumbers.includes(roll) ? 2 : 1;

  for (const [id, data] of board.allHexData()) {
    if (!board.producesOn(id, roll)) continue;

    const resource = yieldOf(data.terrain);
    if (resource === null) continue;

    for (const vertex of vertexIdsOfHex(parseHexKey(id))) {
      const building = board.buildingAt(vertex);
      if (!building) continue;

      const gained = buildingYield(building.kind) * multiplier;
      const before = out.get(building.owner) ?? {};
      out.set(building.owner, addCounts(before, counts({ [resource]: gained })));
    }
  }

  return out;
}

/**
 * Applique la pénurie de banque.
 *
 * Règle classique de Catan, conservée parce qu'elle compte ici plus
 * qu'ailleurs : à douze joueurs la banque se vide vite. Si le stock d'une
 * ressource ne suffit pas à honorer toutes les demandes, personne ne la
 * reçoit — sauf si un seul joueur l'attendait, auquel cas il prend ce qui
 * reste.
 */
export function applyBankLimits(production: Production, bank: ResourceCounts): {
  granted: Production;
  bank: ResourceCounts;
} {
  const claimants = new Map<Resource, PlayerId[]>();
  const demand = new Map<Resource, number>();

  for (const [player, gains] of production) {
    for (const r of RESOURCES) {
      const n = amount(gains, r);
      if (n === 0) continue;
      demand.set(r, (demand.get(r) ?? 0) + n);
      const list = claimants.get(r) ?? [];
      list.push(player);
      claimants.set(r, list);
    }
  }

  const blocked = new Set<Resource>();
  const capped = new Map<Resource, number>();
  for (const [r, wanted] of demand) {
    const stock = amount(bank, r);
    if (wanted <= stock) continue;
    if ((claimants.get(r) ?? []).length === 1) capped.set(r, stock);
    else blocked.add(r);
  }

  const granted = new Map<PlayerId, ResourceCounts>();
  let remaining = bank;

  for (const [player, gains] of production) {
    const kept: Partial<Record<Resource, number>> = {};
    for (const r of RESOURCES) {
      const n = amount(gains, r);
      if (n === 0 || blocked.has(r)) continue;
      const give = capped.has(r) ? (capped.get(r) ?? 0) : n;
      if (give > 0) kept[r] = give;
    }
    const c = counts(kept);
    if (Object.keys(c).length > 0) {
      granted.set(player, c);
      remaining = subtractSafely(remaining, c);
    }
  }

  return { granted, bank: remaining };
}

/** Retrait borné à zéro : la banque ne descend jamais sous son stock. */
function subtractSafely(bank: ResourceCounts, taken: ResourceCounts): ResourceCounts {
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) {
    const n = Math.max(0, amount(bank, r) - amount(taken, r));
    if (n !== 0) out[r] = n;
  }
  return counts(out);
}

/** Les hexagones qui alimentent un sommet — utile pour évaluer un emplacement. */
export function hexesFeedingVertex(board: Board, vertex: string): string[] {
  return hexesOfVertex(vertex)
    .map(hexKey)
    .filter((id) => board.hexData(id) !== undefined);
}
