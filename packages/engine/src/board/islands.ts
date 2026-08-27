/**
 * Masses continentales d'un plateau.
 *
 * Un archipel n'est pas déclaré : il se lit. Les îles sont les composantes
 * connexes des hexagones de terre, calculées à partir du plateau lui-même.
 * Rien n'est donc à tenir à jour ni à sérialiser, et un plateau chargé depuis
 * une sauvegarde se relit tout seul.
 */

import { hexKey, neighbors, parseHexKey } from './axial.js';
import type { Board } from './board.js';
import type { HexId } from './graph.js';

export interface Island {
  /**
   * Identifiant stable : le plus petit identifiant d'hexagone de l'île.
   *
   * Il ne dépend ni de l'ordre de parcours ni du hasard, ce qui permet de
   * retenir « cette île a déjà été atteinte » d'une diffusion à l'autre.
   */
  readonly id: string;
  readonly hexes: readonly HexId[];
}

/** Un hexagone est-il de la terre ferme ? */
function isLand(board: Board, hex: HexId): boolean {
  const terrain = board.terrainAt(hex);
  return terrain !== undefined && terrain !== 'sea' && terrain !== 'unexplored';
}

/**
 * Les îles du plateau, de la plus grande à la plus petite.
 *
 * Le tri rend la première déterministe : c'est l'île centrale, celle qui
 * porte la mise en place.
 */
/**
 * Mémoïsation par plateau.
 *
 * Le découpage ne dépend que des terrains, fixés à la construction. Le
 * recalculer à chaque appel coûterait cher : `settlementSpots` interroge
 * chacun des cent cinquante sommets d'un plateau XXL, à chaque diffusion et
 * pour douze joueurs.
 */
const cache = new WeakMap<Board, Island[]>();

export function landMasses(board: Board): Island[] {
  const cached = cache.get(board);
  if (cached) return cached;
  const computed = computeLandMasses(board);
  cache.set(board, computed);
  return computed;
}

function computeLandMasses(board: Board): Island[] {
  const remaining = new Set<HexId>();
  for (const hex of board.allHexData().keys()) {
    if (isLand(board, hex)) remaining.add(hex);
  }

  const islands: Island[] = [];
  while (remaining.size > 0) {
    // On repart du plus petit identifiant restant : à plateau égal, même
    // découpage, quel que soit l'ordre d'itération de la Map.
    const seed = [...remaining].sort()[0] as HexId;
    const hexes: HexId[] = [];
    const queue = [seed];
    remaining.delete(seed);

    while (queue.length > 0) {
      const current = queue.pop() as HexId;
      hexes.push(current);
      for (const neighbour of neighbors(parseHexKey(current))) {
        const key = hexKey(neighbour);
        if (!remaining.has(key)) continue;
        remaining.delete(key);
        queue.push(key);
      }
    }

    hexes.sort();
    islands.push({ id: hexes[0] as string, hexes });
  }

  // À taille égale, l'identifiant départage : le tri reste déterministe.
  islands.sort((a, b) => (b.hexes.length - a.hexes.length) || a.id.localeCompare(b.id));
  return islands;
}

/** L'île qui porte la mise en place : la plus grande. */
export function mainIsland(board: Board): Island | undefined {
  return landMasses(board)[0];
}

/** À quelle île appartient cet hexagone ? */
export function islandOfHex(board: Board, hex: HexId): Island | undefined {
  return landMasses(board).find((island) => island.hexes.includes(hex));
}
