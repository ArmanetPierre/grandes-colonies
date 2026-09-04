import { describe, expect, it } from 'vitest';

import type { PrivatePlayerView, PublicGameView } from '@grand-colonies/protocol';

import { Garde, situationDe } from '../src/garde.js';

/*
 * Le bug d'une soirée entière, tenu par des tests.
 *
 * Les adversaires se connectent dans le salon et y reçoivent déjà une vue où
 * un objectif leur est proposé. Ils tiraient `CHOOSE_OBJECTIVE` aussitôt, le
 * serveur le refusait — la partie n'avait pas commencé — et l'ancien
 * garde-fou, qui ne comparait que la commande, gardait ce refus en mémoire
 * pour toujours. Au départ réel, le pilote redécidait la même chose et le bot
 * ne renvoyait plus rien : tous ses tours étaient joués d'office, trente
 * secondes chacun.
 */

const vue = (p: Partial<PublicGameView>): PublicGameView => ({
  started: true, phase: 'setup', cycle: 0, activePlayer: 'p1', ...p,
} as PublicGameView);

const moi = (p: Partial<PrivatePlayerView>): PrivatePlayerView => ({
  hand: {}, capabilities: ['CAN_PLACE_SETUP'], ...p,
} as PrivatePlayerView);

const CHOISIR = { type: 'CHOOSE_OBJECTIVE', objective: 'architect' };

describe('la situation', () => {
  it('distingue le salon de la partie lancée', () => {
    // C'est la distinction qui manquait : la même commande, refusée dans le
    // salon, doit pouvoir repartir une fois la partie lancée.
    expect(situationDe(vue({ started: false }), moi({})))
      .not.toBe(situationDe(vue({ started: true }), moi({})));
  });

  it('change quand le tour change', () => {
    expect(situationDe(vue({ activePlayer: 'p1' }), moi({})))
      .not.toBe(situationDe(vue({ activePlayer: 'p2' }), moi({})));
  });

  it('change quand la phase ou le cycle changent', () => {
    expect(situationDe(vue({ phase: 'setup' }), moi({})))
      .not.toBe(situationDe(vue({ phase: 'activeTurn' }), moi({})));
    expect(situationDe(vue({ cycle: 3 }), moi({})))
      .not.toBe(situationDe(vue({ cycle: 4 }), moi({})));
  });

  it('change quand la main ou les capacités changent', () => {
    expect(situationDe(vue({}), moi({ hand: { wood: 1 } })))
      .not.toBe(situationDe(vue({}), moi({ hand: { wood: 2 } })));
    expect(situationDe(vue({}), moi({ capabilities: ['CAN_BUILD'] })))
      .not.toBe(situationDe(vue({}), moi({ capabilities: ['CAN_ROLL_DICE'] })));
  });

  it('ne dépend pas de l’ordre des capacités', () => {
    // Elles viennent d'un ensemble : leur ordre n'a pas de sens, et deux
    // ordres différents ne doivent pas passer pour deux situations.
    expect(situationDe(vue({}), moi({ capabilities: ['CAN_BUILD', 'CAN_TRADE_BANK'] })))
      .toBe(situationDe(vue({}), moi({ capabilities: ['CAN_TRADE_BANK', 'CAN_BUILD'] })));
  });
});

describe('le garde-fou', () => {
  it('laisse passer un coup, puis coupe sa répétition', () => {
    const garde = new Garde();
    const s = situationDe(vue({}), moi({}));

    expect(garde.autorise(s, CHOISIR)).toBe(true);
    expect(garde.autorise(s, CHOISIR)).toBe(false);
    expect(garde.autorise(s, CHOISIR)).toBe(false);
  });

  it('laisse repartir le même coup dès que la situation change', () => {
    /*
     * Le cœur du correctif. Refusé dans le salon, `CHOOSE_OBJECTIVE` doit
     * repartir au lancement — c'est précisément ce que l'ancien garde-fou
     * interdisait, et ce qui figeait le bot pour le reste de la partie.
     */
    const garde = new Garde();
    const salon = situationDe(vue({ started: false }), moi({}));
    const lancee = situationDe(vue({ started: true }), moi({}));

    expect(garde.autorise(salon, CHOISIR)).toBe(true);
    expect(garde.autorise(salon, CHOISIR)).toBe(false);
    expect(garde.autorise(lancee, CHOISIR)).toBe(true);
  });

  it('distingue deux coups différents dans la même situation', () => {
    // Poser une colonie puis une route ne change ni la phase ni le tour :
    // c'est le coup qui doit les séparer.
    const garde = new Garde();
    const s = situationDe(vue({}), moi({}));

    expect(garde.autorise(s, { type: 'PLACE_SETUP_SETTLEMENT', vertex: 'a' })).toBe(true);
    expect(garde.autorise(s, { type: 'PLACE_SETUP_ROAD', edge: 'b' })).toBe(true);
  });

  it('oublie quand le pilote ne veut plus rien', () => {
    const garde = new Garde();
    const s = situationDe(vue({}), moi({}));

    expect(garde.autorise(s, CHOISIR)).toBe(true);
    garde.oublier();
    expect(garde.autorise(s, CHOISIR)).toBe(true);
  });
});
