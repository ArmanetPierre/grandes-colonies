import { describe, expect, it } from 'vitest';

import { composerVols } from '../src/ui/Gains.js';

const partout = () => ({ x: 100, y: 100 });
const pile = () => ({ x: 500, y: 700 });

describe('composer les vols d’une récolte', () => {
  it('fait voler une carte par ressource gagnée', () => {
    const vols = composerVols({ wood: 2, ore: 1 }, partout, pile, 1);
    expect(vols.filter((v) => v.resource === 'wood')).toHaveLength(2);
    expect(vols.filter((v) => v.resource === 'ore')).toHaveLength(1);
  });

  it('plafonne les grosses récoltes', () => {
    // Un monopole peut rapporter huit briques. Huit icônes en vol masquent le
    // plateau sans mieux informer que trois — le compte exact reste écrit
    // sur la pile d'arrivée.
    const vols = composerVols({ brick: 8 }, partout, pile, 1);
    expect(vols).toHaveLength(3);
  });

  it('ignore les ressources non gagnées', () => {
    expect(composerVols({ wood: 0, grain: 2 }, partout, pile, 1)
      .every((v) => v.resource === 'grain')).toBe(true);
  });

  /*
   * Le cas qui compte.
   *
   * Un hexagone hors cadre, une pile pas encore affichée : il n'y a alors ni
   * départ ni arrivée. Faire voler une carte depuis l'origine de l'écran
   * jusqu'au coin supérieur gauche serait pire que ne rien montrer — et le
   * compteur, lui, dira toujours la vérité.
   */
  it('ne fait rien voler sans point de départ ni d’arrivée', () => {
    expect(composerVols({ wood: 3 }, () => undefined, pile, 1)).toHaveLength(0);
    expect(composerVols({ wood: 3 }, partout, () => undefined, 1)).toHaveLength(0);
  });

  it('échelonne les cartes d’une même ressource', () => {
    // Trois cartes parties ensemble se lisent comme une seule.
    const retards = composerVols({ wool: 3 }, partout, pile, 1).map((v) => v.retard);
    expect(retards).toEqual([...retards].sort((a, b) => a - b));
    expect(new Set(retards).size).toBe(3);
  });

  it('donne à chaque carte une identité stable et distincte', () => {
    const vols = composerVols({ wood: 2, ore: 2 }, partout, pile, 42);
    expect(new Set(vols.map((v) => v.id)).size).toBe(vols.length);
    // La graine sépare deux récoltes successives de la même ressource :
    // sans elle, React réutiliserait le nœud et l'animation ne rejouerait pas.
    const suivante = composerVols({ wood: 2, ore: 2 }, partout, pile, 43);
    expect(vols.some((v) => suivante.some((s) => s.id === v.id))).toBe(false);
  });
});
