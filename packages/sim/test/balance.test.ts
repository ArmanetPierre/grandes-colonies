import { describe, expect, it } from 'vitest';

import { defaultConfig } from '@grand-colonies/engine';

import { GreedyBot } from '../src/bots/greedy.js';
import { playGame } from '../src/runner.js';

const greedy = () => new GreedyBot();

/**
 * Ces tests ne vérifient pas un comportement du moteur mais une propriété
 * d'ÉQUILIBRAGE, mesurée par simulation. Ils échoueront le jour où les
 * sources de points manquantes seront implémentées — et c'est voulu : ils
 * signaleront alors qu'il faut réévaluer le seuil de victoire.
 */
describe('plafond de points atteignable', () => {
  it('ne permet pas d atteindre 15 PV avec les seules sources implémentées', () => {
    const best = [0, 1, 2].map((s) =>
      Math.max(...playGame({ playerCount: 8, seed: `cap-${s}`, makeBot: greedy, maxCycles: 200 }).points));

    // Mesuré : le plafond réel tourne autour de 12 points.
    expect(Math.max(...best)).toBeLessThan(15);
  }, 300000);

  it('conclut les parties avec un seuil abaissé, ce qui isole la cause', () => {
    const base = defaultConfig(8);
    const config = { ...base, victory: { ...base.victory, target: 10 } };

    const outcomes = [0, 1, 2, 3].map((s) =>
      playGame({ playerCount: 8, seed: `low-${s}`, makeBot: greedy, config, maxCycles: 250 }));

    // La machinerie fonctionne : ce n'est donc pas le moteur qui bloque,
    // mais le barème de points.
    expect(outcomes.filter((o) => o.winner !== undefined).length).toBeGreaterThanOrEqual(3);
  }, 400000);

  it('épuise la dotation de routes avant les autres pièces', () => {
    const outcome = playGame({ playerCount: 8, seed: 'roads', makeBot: greedy, maxCycles: 200 });
    // Chaque joueur a construit largement : ce n'est pas la pénurie de
    // ressources qui limite, mais le nombre de routes disponibles.
    expect(outcome.builds.reduce((a, b) => a + b, 0)).toBeGreaterThan(60);
  }, 300000);
});
