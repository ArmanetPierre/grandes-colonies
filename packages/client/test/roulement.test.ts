import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import {
  DUREE_ROULEMENT, DUREE_TOTALE, NORMALES, ORDRE_FACES,
  annonce, graineDepuis, opacite, tirages,
} from '../src/ui/board3d/roulement.js';

/*
 * Ce fichier ne teste plus la chute — elle est simulée, et vérifiée dans
 * `physique.test.ts`. Restent les tables de faces, dont une erreur donnerait
 * un dé impossible, et le temps : quand le total se déclare, quand tout
 * s'efface.
 */

describe('les faces', () => {
  it('range les six nombres dans l’ordre des matériaux d’une boîte', () => {
    expect(ORDRE_FACES).toEqual([1, 6, 2, 5, 3, 4]);
    expect(ORDRE_FACES.map((v) => NORMALES[v])).toEqual([
      [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    ]);
  });

  it('met les faces opposées dos à dos, et fait sept', () => {
    for (let valeur = 1; valeur <= 6; valeur++) {
      const face = new Vector3(...(NORMALES[valeur] as [number, number, number]));
      const opposee = new Vector3(...(NORMALES[7 - valeur] as [number, number, number]));
      expect(face.dot(opposee)).toBe(-1);
    }
  });

  it('tourne dans le sens d’un vrai dé : 1, 2, 3 en sens direct', () => {
    // Sur un dé du commerce, les faces 1, 2 et 3 se suivent dans le sens
    // direct autour de leur sommet commun. Un cube numéroté à l'envers est un
    // dé de miroir, et se remarque sans qu'on sache dire pourquoi.
    const un = new Vector3(...(NORMALES[1] as [number, number, number]));
    const deux = new Vector3(...(NORMALES[2] as [number, number, number]));
    const trois = new Vector3(...(NORMALES[3] as [number, number, number]));
    expect(new Vector3().crossVectors(un, deux).dot(trois)).toBe(1);
  });
});

describe('la graine', () => {
  it('donne la même suite de tirages à la même graine', () => {
    const suite = (g: number): number[] => {
      const t = tirages(g);
      return [t(), t(), t(), t(), t()];
    };
    expect(suite(0.42)).toEqual(suite(0.42));
    expect(suite(0.42)).not.toEqual(suite(0.43));
    for (const v of suite(0.9)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('tire une graine utilisable d’une clé de lancer', () => {
    for (const cle of ['1-a-1-1', '2-b-6-5', '12-l-3-4', '']) {
      const graine = graineDepuis(cle);
      expect(graine).toBeGreaterThanOrEqual(0);
      expect(graine).toBeLessThan(1);
    }
    expect(graineDepuis('4-p2-3-3')).toBe(graineDepuis('4-p2-3-3'));
    expect(graineDepuis('4-p2-3-3')).not.toBe(graineDepuis('5-p2-3-3'));
  });
});

describe('opacite', () => {
  it('reste pleine le temps qu’on lise, puis s’éteint', () => {
    expect(opacite(0)).toBe(1);
    expect(opacite(DUREE_ROULEMENT + 1)).toBe(1);
    expect(opacite(DUREE_TOTALE)).toBe(0);
    expect(opacite(DUREE_TOTALE + 5)).toBe(0);
    expect(opacite(DUREE_TOTALE - 0.25)).toBeGreaterThan(0);
    expect(opacite(DUREE_TOTALE - 0.25)).toBeLessThan(1);
  });
});

describe('annonce', () => {
  /** L'instant où les dés se sont arrêtés : il change à chaque lancer. */
  const REPOS = 0.94;

  it('n’existe pas tant que les dés roulent', () => {
    for (const age of [0, 0.4, REPOS - 0.01]) {
      expect(annonce(age, REPOS).eclat).toBe(0);
      expect(annonce(age, REPOS).echelle).toBe(0);
    }
  });

  it('suit l’arrêt réel des dés, tôt ou tard', () => {
    // Un lancer qui se pose vite annonce vite. Le total ne guette pas une
    // horloge, il guette les dés.
    expect(annonce(0.7, 0.6).eclat).toBeGreaterThan(0);
    expect(annonce(0.7, 1.3).eclat).toBe(0);
  });

  it('monte, grossit, et se tient tranquille', () => {
    const arrivee = annonce(REPOS + 0.5, REPOS);
    expect(arrivee.eclat).toBe(1);
    expect(arrivee.echelle).toBeCloseTo(1, 2);

    // Elle monte sans jamais redescendre.
    let precedente = -1;
    for (let age = REPOS; age < REPOS + 0.4; age += 0.01) {
      const dy = annonce(age, REPOS).dy;
      expect(dy).toBeGreaterThanOrEqual(precedente - 1e-9);
      precedente = dy;
    }

    // Le dépassement d'échelle en cours de montée : elle s'annonce.
    const sommets = [];
    for (let age = REPOS; age < REPOS + 0.32; age += 0.01) {
      sommets.push(annonce(age, REPOS).echelle);
    }
    expect(Math.max(...sommets)).toBeGreaterThan(1);
  });
});
