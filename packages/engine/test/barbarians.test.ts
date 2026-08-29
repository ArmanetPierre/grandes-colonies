/**
 * Les barbares (§16).
 *
 * La menace est collective, les récompenses individuelles : c'est toute
 * l'idée, et c'est ce que ces tests vérifient. Un joueur qui ne joue aucun
 * chevalier profite de la protection des autres — jusqu'au jour où l'attaque
 * passe, et c'est alors lui qui paie.
 */

import { describe, expect, it } from 'vitest';

import {
  GRAND_COLONIES_BARBARIANS as CONFIG,
  defenceOf,
  initialBarbarians,
  resolveInvasion,
} from '../src/barbarians.js';

const jamais = () => false;
const toujours = () => true;

describe('force et défense', () => {
  it('compte un chevalier comme une unité de défense', () => {
    expect(defenceOf(3, CONFIG)).toBe(3 * CONFIG.defencePerKnight);
    expect(defenceOf(0, CONFIG)).toBe(0);
  });

  it('démarre la piste à zéro', () => {
    const track = initialBarbarians();
    expect(track.progress).toBe(0);
    expect(track.attacks).toBe(0);
  });
});

describe('résolution d une invasion', () => {
  it('repousse l attaque quand les chevaliers suffisent', () => {
    const issue = resolveInvasion(4, new Map([['p1', 3], ['p2', 2]]), toujours);
    expect(issue.repelled).toBe(true);
    expect(issue.defence).toBe(5);
  });

  it('laisse passer l attaque quand ils ne suffisent pas', () => {
    const issue = resolveInvasion(10, new Map([['p1', 3], ['p2', 2]]), toujours);
    expect(issue.repelled).toBe(false);
  });

  /** Le jeton récompense l'effort, pas le résultat : le §16 ne le conditionne pas. */
  it('couronne le meilleur défenseur même quand l attaque passe', () => {
    const issue = resolveInvasion(99, new Map([['p1', 1], ['p2', 4], ['p3', 0]]), toujours);
    expect(issue.repelled).toBe(false);
    expect(issue.champion).toBe('p2');
  });

  /**
   * Récompenser un zéro partagé n'aurait aucun sens, et tirer au sort
   * récompenserait le hasard.
   */
  it('ne couronne personne si nul n a joué de chevalier', () => {
    const issue = resolveInvasion(3, new Map([['p1', 0], ['p2', 0]]), toujours);
    expect(issue.champion).toBeUndefined();
  });

  it('fait payer le plus faible défenseur', () => {
    const issue = resolveInvasion(99, new Map([['p1', 5], ['p2', 1], ['p3', 3]]), toujours);
    expect(issue.weakest).toBe('p2');
  });

  /**
   * Chercher le maillon faible parmi tous les joueurs aurait désigné
   * quelqu'un sans cité — et l'attaque n'aurait alors rien coûté à personne.
   */
  it('ne désigne que des joueurs ayant une cité à perdre', () => {
    const issue = resolveInvasion(
      99,
      new Map([['p1', 5], ['p2', 0], ['p3', 3]]),
      (p) => p !== 'p2',
    );
    expect(issue.weakest).toBe('p3');
  });

  it('ne fait payer personne si nul n a de cité', () => {
    const issue = resolveInvasion(99, new Map([['p1', 0], ['p2', 1]]), jamais);
    expect(issue.weakest).toBeUndefined();
  });

  /**
   * Les égalités sont tranchées par l'ordre des joueurs et non par le hasard :
   * un tirage rendrait la partie irrejouable depuis son journal, et c'est
   * tout ce qui permet de la restaurer.
   */
  it('tranche les égalités de façon déterministe', () => {
    const defences = new Map([['p1', 2], ['p2', 2], ['p3', 2]]);
    const a = resolveInvasion(99, defences, toujours);
    const b = resolveInvasion(99, defences, toujours);
    expect(a.champion).toBe(b.champion);
    expect(a.weakest).toBe(b.weakest);
  });
});
