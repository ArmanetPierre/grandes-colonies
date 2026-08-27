import { describe, expect, it } from 'vitest';

import { GreedyBot } from '../src/bots/greedy.js';
import { playGame } from '../src/runner.js';

const greedy = () => new GreedyBot();

/**
 * Tests d'ÉQUILIBRAGE, mesurés par simulation — ils ne vérifient pas un
 * comportement du moteur mais une propriété du jeu. Ils échoueront quand
 * l'équilibrage bougera, et c'est leur raison d'être : signaler qu'il faut
 * réévaluer plutôt que laisser un déséquilibre passer inaperçu.
 *
 * Voir SIMULATION_FINDINGS.md pour les mesures et leur interprétation.
 */
describe('atteignabilité de la victoire', () => {
  it('permet d atteindre les 15 points visés', () => {
    const outcomes = [0, 1, 2, 3, 4, 5].map((s) =>
      playGame({ playerCount: 8, seed: `f-8-${s}`, makeBot: greedy, maxCycles: 300 }));

    // Avant les objectifs secrets et la dotation de routes relevée, AUCUNE
    // partie n'y parvenait. Une sur trois y arrive désormais — c'est un
    // progrès net, et un équilibrage encore insuffisant.
    expect(outcomes.filter((o) => o.winner !== undefined).length).toBeGreaterThanOrEqual(2);
    expect(Math.max(...outcomes.flatMap((o) => o.points))).toBeGreaterThanOrEqual(15);
  }, 600000);

  /**
   * Le problème suivant, et il est sérieux : la partie est bien trop longue.
   *
   * La cible du §2 du game design est de 120 à 160 minutes. À deux minutes
   * par cycle, cela autorise environ 60 cycles. Les mesures en réclament
   * quatre fois plus.
   *
   * Ce seuil est délibérément placé au-dessus des mesures actuelles : il
   * documente l'écart plutôt que de le masquer, et se resserrera à mesure
   * que l'équilibrage s'améliorera.
   */
  it('reste très au-dessus de la durée visée', () => {
    const outcome = playGame({ playerCount: 12, seed: 'duration', makeBot: greedy, maxCycles: 300 });
    // 60 cycles = 2 h. On en est loin, et ce test le consigne.
    expect(outcome.cycles).toBeGreaterThan(60);
  }, 300000);

  it('épuise moins vite la dotation de routes qu avant le correctif', () => {
    const outcome = playGame({ playerCount: 8, seed: 'roads', makeBot: greedy, maxCycles: 200 });
    expect(outcome.builds.reduce((a, b) => a + b, 0)).toBeGreaterThan(60);
  }, 300000);
});
