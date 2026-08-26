import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import { Board, type HexData } from '../src/board/board.js';
import { longestRouteFor, searchLongestRoute } from '../src/longestRoute.js';

const ORIGIN: Axial = { q: 0, r: 0 };

function board(radius: number): Board {
  const positions = hexesWithin(ORIGIN, radius);
  const hexes = new Map<string, HexData>();
  for (const p of positions) hexes.set(hexKey(p), { terrain: 'forest', token: 5 });
  return new Board({ positions, hexes });
}

/** Un joueur possédant `count` routes contiguës autour du centre. */
function withRoutes(count: number): Board {
  const b = board(3);
  let laid = 0;
  for (const edge of [...b.graph.edges].sort()) {
    if (laid >= count) break;
    b.setRoad(edge, 'p1');
    laid++;
  }
  return b;
}

/** Cas impossible en partie légale : toutes les arêtes au même joueur. */
function saturated(radius: number): Board {
  const b = board(radius);
  for (const edge of b.graph.edges) b.setRoad(edge, 'p1');
  return b;
}

describe('coût du plus long réseau', () => {
  // Mesuré : 15 routes ≈ 0,6 ms, 35 routes ≈ 2,8 ms. Le seuil est large
  // pour absorber la variabilité d'une machine chargée.
  it('reste instantané à la dotation réelle d un joueur', () => {
    const b = withRoutes(15);
    const started = Date.now();
    const length = longestRouteFor(b, 'p1');
    expect(length).toBeGreaterThan(0);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it('reste rapide bien au-delà de la dotation', () => {
    const b = withRoutes(35);
    const started = Date.now();
    longestRouteFor(b, 'p1');
    expect(Date.now() - started).toBeLessThan(200);
  });

  it('ne tronque pas une recherche de taille réelle', () => {
    expect(searchLongestRoute(withRoutes(35), 'p1').truncated).toBe(false);
  });

  /**
   * Sans budget, ce cas demande une minute (mesuré : 58 s pour 72 arêtes).
   * Il est hors d'atteinte d'une partie légale — un joueur n'a que quinze
   * routes — mais le panneau maître de jeu peut poser des constructions
   * arbitrairement, et un serveur figé une minute avec douze joueurs
   * connectés serait inacceptable.
   */
  it('borne un état impossible au lieu de figer le serveur', () => {
    const b = saturated(2);
    expect(b.graph.edges.size).toBe(72);

    const started = Date.now();
    const result = searchLongestRoute(b, 'p1');
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(2000);
    expect(result.truncated).toBe(true);
    // La longueur reste une borne inférieure exploitable, pas zéro.
    expect(result.length).toBeGreaterThan(10);
  });

  it('signale la troncature plutôt que de la taire', () => {
    // Un budget minuscule force la troncature même sur un petit réseau.
    const result = searchLongestRoute(withRoutes(10), 'p1', { maxSteps: 5 });
    expect(result.truncated).toBe(true);
  });
});
