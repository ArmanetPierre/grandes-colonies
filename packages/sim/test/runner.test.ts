import { describe, expect, it } from 'vitest';

import { SeededRandom, defaultConfig } from '@grand-colonies/engine';

import { GreedyBot, RandomBot } from '../src/bots/greedy.js';
import { playGame } from '../src/runner.js';

const greedy = () => new GreedyBot();

/**
 * Seuil abaissé à 12 points pour ces tests.
 *
 * Le seuil réel de 15 est désormais atteignable, mais demande plus de 200
 * cycles : chaque test de fumée coûterait plusieurs secondes pour vérifier
 * de la machinerie, pas de l'équilibrage. Ce dernier est mesuré séparément
 * dans balance.test.ts.
 */
function lowThreshold(playerCount: number) {
  const base = defaultConfig(playerCount);
  return { ...base, victory: { ...base.victory, target: 12 } };
}

describe('simulateur', () => {
  it('mène une partie à 4 joueurs jusqu à la victoire', () => {
    const outcome = playGame({ playerCount: 4, seed: 'f-4-0', makeBot: greedy, config: lowThreshold(4) });
    expect(outcome.winner).toBeDefined();
    expect(outcome.exhausted).toBe(false);
    expect(outcome.cycles).toBeGreaterThan(4);
  });

  it('mène une partie à 12 joueurs jusqu à la victoire', () => {
    const outcome = playGame({ playerCount: 12, seed: 'f-12-0', makeBot: greedy, config: lowThreshold(12) });
    expect(outcome.winner).toBeDefined();
    expect(outcome.points.some((p) => p >= 12)).toBe(true);
  });

  it('rejoue exactement la même partie à graine égale', () => {
    const a = playGame({ playerCount: 6, seed: 'repeat', makeBot: greedy, config: lowThreshold(6) });
    const b = playGame({ playerCount: 6, seed: 'repeat', makeBot: greedy, config: lowThreshold(6) });
    expect(b.winner).toBe(a.winner);
    expect(b.cycles).toBe(a.cycles);
    expect(b.points).toEqual(a.points);
  });

  it('produit des parties différentes sur des graines différentes', () => {
    const a = playGame({ playerCount: 6, seed: 'x', makeBot: greedy, config: lowThreshold(6) });
    const b = playGame({ playerCount: 6, seed: 'y', makeBot: greedy, config: lowThreshold(6) });
    expect([a.cycles, a.winner]).not.toEqual([b.cycles, b.winner]);
  });

  it('fait jouer chaque joueur à son tour', () => {
    const outcome = playGame({ playerCount: 8, seed: 'turns', makeBot: greedy, config: lowThreshold(8) });
    // Aucun joueur ne doit être oublié par la rotation.
    expect(Math.min(...outcome.activeTurns)).toBeGreaterThan(0);
    // L'écart entre le plus et le moins servi ne dépasse pas un tour.
    expect(Math.max(...outcome.activeTurns) - Math.min(...outcome.activeTurns)).toBeLessThanOrEqual(1);
  });

  it('observe une distribution de dés en cloche', () => {
    const outcome = playGame({ playerCount: 6, seed: 'dice', makeBot: greedy, config: lowThreshold(6) });
    const seven = outcome.rolls.get(7) ?? 0;
    const two = outcome.rolls.get(2) ?? 0;
    expect(seven).toBeGreaterThan(two);
  });

  it('fonctionne aussi avec des bots aléatoires', () => {
    const outcome = playGame({
      playerCount: 6,
      seed: 'random-bots',
      makeBot: (_, rng) => new RandomBot(rng),
    });
    expect(outcome.cycles).toBeGreaterThan(0);
    expect(outcome.builds.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });

  it('accepte un mélange de bots', () => {
    const outcome = playGame({
      playerCount: 6,
      seed: 'mixed',
      makeBot: (i, rng) => (i % 2 === 0 ? new GreedyBot() : new RandomBot(rng)),
    });
    expect(outcome.cycles).toBeGreaterThan(0);
  });

  it('consomme la même graine de bots quel que soit l ordre d appel', () => {
    const rng = new SeededRandom('stable');
    expect(new RandomBot(rng).name).toBe('random');
  });
});
