/**
 * L'Influence (§17) et ce qu'elle tranche.
 *
 * Elle ne rapporte aucun point : tout son intérêt est de désigner qui
 * construit quand deux joueurs visent le même emplacement. Ces tests portent
 * donc autant sur le calcul que sur la résolution des annonces.
 */

import { describe, expect, it } from 'vitest';

import { Board } from '../src/board/board.js';
import { classicBoard } from '../src/board/presets.js';
import { resolveIntents, type BuildIntent } from '../src/game/buildIntent.js';
import { GRAND_COLONIES_INFLUENCE, influenceOf } from '../src/influence.js';
import { SeededRandom } from '../src/rng.js';

const CONFIG = GRAND_COLONIES_INFLUENCE;

function plateau(): Board {
  return new Board(classicBoard(new SeededRandom('influence')));
}

/** Une annonce nue : seuls le joueur et l'ordre comptent pour le départage. */
const annonce = (player: string, order: number, vertex = 'v1'): BuildIntent => ({
  id: `${player}:${order}`,
  player,
  target: { kind: 'settlement', vertex },
  reserved: {},
  cycle: 1,
  order,
});

describe('calcul de l Influence', () => {
  it('ne donne rien à qui n a rien fait', () => {
    expect(influenceOf(plateau(), 'p1', CONFIG).total).toBe(0);
  });

  it('compte les jetons de défense et l objectif accompli', () => {
    const b = influenceOf(plateau(), 'p1', CONFIG, {
      barbarianDefences: 2,
      secretObjectivesCompleted: 1,
    });
    expect(b.barbarianDefences).toBe(2 * CONFIG.barbarianDefence);
    expect(b.secretObjectives).toBe(CONFIG.secretObjective);
    expect(b.total).toBe(2 * CONFIG.barbarianDefence + CONFIG.secretObjective);
  });

  /**
   * Un contrat rompu coûte, mais ne creuse pas de dette : une Influence
   * négative n'aurait aucun sens face à un joueur qui n'a simplement rien
   * fait.
   */
  it('ne descend jamais sous zéro', () => {
    const b = influenceOf(plateau(), 'p1', CONFIG, { brokenContracts: 5 });
    expect(b.total).toBe(0);
  });
});

describe('départage des annonces par l Influence', () => {
  it('donne toujours la priorité au joueur actif, même sans Influence', () => {
    const { built } = resolveIntents(
      [annonce('p2', 1), annonce('p1', 2)],
      'p1',
      (p) => (p === 'p2' ? 10 : 0),
    );
    expect(built.map((i) => i.player)).toEqual(['p1']);
  });

  /** La règle qui n'existait pas : elle s'insère entre l'actif et l'ancienneté. */
  it('départage deux passifs par l Influence, et non par l ancienneté', () => {
    const { built, refunded } = resolveIntents(
      [annonce('p2', 1), annonce('p3', 2)],
      'p1',
      (p) => (p === 'p3' ? 3 : 0),
    );
    // p2 a annoncé le premier, mais p3 pèse plus lourd.
    expect(built.map((i) => i.player)).toEqual(['p3']);
    expect(refunded.map((i) => i.player)).toEqual(['p2']);
  });

  it('retombe sur l ancienneté à Influence égale', () => {
    const { built } = resolveIntents([annonce('p2', 1), annonce('p3', 2)], 'p1', () => 4);
    expect(built.map((i) => i.player)).toEqual(['p2']);
  });

  /**
   * L'ancienneté reste le dernier recours, et c'est ce qui garde le gel
   * inatteignable : deux joueurs à zéro sont le cas ordinaire en début de
   * partie, et geler à chaque fois ferait de l'exception la règle.
   */
  it('désigne toujours un vainqueur, donc ne gèle rien', () => {
    const { built, frozen } = resolveIntents(
      [annonce('p2', 1), annonce('p3', 2), annonce('p4', 3)],
      'p1',
      () => 0,
    );
    expect(built).toHaveLength(1);
    expect(frozen).toEqual([]);
  });

  it('laisse chaque emplacement à son propre vainqueur', () => {
    const { built } = resolveIntents(
      [annonce('p2', 1, 'vA'), annonce('p3', 2, 'vA'), annonce('p4', 3, 'vB')],
      'p1',
      (p) => (p === 'p3' ? 5 : 0),
    );
    expect(built.map((i) => i.player).sort()).toEqual(['p3', 'p4']);
  });
});
