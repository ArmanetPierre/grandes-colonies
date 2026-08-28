import { describe, expect, it } from 'vitest';

import {
  TAILLE, barycentre, bornes, centreHex, hexDe, ilesDuLarge, rotationArete, touche,
} from '../src/ui/board3d/geometrie.js';

/** Les six voisins d'un hexagone, en coordonnées axiales. */
const VOISINS: readonly (readonly [number, number])[] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];

const distance = (a: { x: number; z: number }, b: { x: number; z: number }): number =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe('la maille hexagonale', () => {
  it('place les six voisins à égale distance', () => {
    // Un hexagone pointe en haut a ses voisins à √3 fois son rayon : c'est la
    // distance entre deux côtés opposés. Si un seul voisin sortait du lot, la
    // maille serait cisaillée et les tuiles se chevaucheraient.
    const centre = centreHex('3,-2');
    for (const [dq, dr] of VOISINS) {
      const voisin = centreHex(`${3 + dq},${-2 + dr}`);
      expect(distance(centre, voisin)).toBeCloseTo(Math.sqrt(3) * TAILLE, 10);
    }
  });

  it('ne place jamais deux hexagones distincts au même endroit', () => {
    const vus = new Map<string, string>();
    for (let q = -6; q <= 6; q++) {
      for (let r = -6; r <= 6; r++) {
        const { x, z } = centreHex(`${q},${r}`);
        const cle = `${x.toFixed(6)}/${z.toFixed(6)}`;
        expect(vus.has(cle)).toBe(false);
        vus.set(cle, `${q},${r}`);
      }
    }
  });
});

describe('sommets et arêtes', () => {
  const sommet = '0,0|1,0|0,1';

  it('pose un sommet au rayon exact de chacun de ses trois hexagones', () => {
    // C'est la propriété qui rend le rendu gratuit : le barycentre des trois
    // centres tombe pile sur le sommet géométrique, à un rayon de chacun.
    const point = barycentre(sommet);
    for (const id of sommet.split('|')) {
      expect(distance(point, centreHex(id))).toBeCloseTo(TAILLE, 10);
    }
  });

  it('pose une arête à mi-chemin de ses deux hexagones', () => {
    const arete = '0,0|1,0';
    const milieu = barycentre(arete);
    const [a, b] = arete.split('|').map(centreHex);
    expect(distance(milieu, a!)).toBeCloseTo((Math.sqrt(3) * TAILLE) / 2, 10);
    expect(distance(milieu, b!)).toBeCloseTo((Math.sqrt(3) * TAILLE) / 2, 10);
  });

  /*
   * Le test qui compte.
   *
   * `rotationArete` traduit une arête en rotation autour de la verticale, et
   * le repère de Three.js y cache un signe : tourner de θ envoie l'axe X sur
   * `(cos θ, 0, −sin θ)`. Se tromper pose toutes les routes en travers de
   * leur arête — un symptôme qui ressemble à une erreur de géométrie alors
   * que c'en est une de repère, et qu'aucun autre test n'attraperait.
   */
  it('couche une pièce parallèlement à son arête', () => {
    for (const arete of ['0,0|1,0', '0,0|0,1', '0,0|1,-1', '2,-3|2,-2']) {
      const [a, b] = arete.split('|').map(centreHex);
      const theta = rotationArete(arete);
      const axe = { x: Math.cos(theta), z: -Math.sin(theta) };
      const centres = { x: b!.x - a!.x, z: b!.z - a!.z };

      // L'arête est perpendiculaire à la ligne des centres : leur produit
      // scalaire doit être nul.
      expect(axe.x * centres.x + axe.z * centres.z).toBeCloseTo(0, 10);
    }
  });

  it('reconnaît les hexagones que touche un emplacement', () => {
    expect(touche(sommet, new Set(['1,0']))).toBe(true);
    expect(touche(sommet, new Set(['5,5']))).toBe(false);
  });
});

describe('le cadrage et le large', () => {
  it('englobe toutes les tuiles', () => {
    const ids = ['0,0', '2,-1', '-1,2'];
    const emprise = bornes(ids);
    for (const id of ids) {
      const { x, z } = centreHex(id);
      expect(x).toBeGreaterThanOrEqual(emprise.minX);
      expect(x).toBeLessThanOrEqual(emprise.maxX);
      expect(z).toBeGreaterThanOrEqual(emprise.minZ);
      expect(z).toBeLessThanOrEqual(emprise.maxZ);
    }
  });

  it('ne pose jamais une île du large sur une tuile jouable', () => {
    // Le décor doit rester du décor : une silhouette posée sur le plateau
    // serait cliquable à l'œil et morte au doigt.
    const jouables = new Set<string>();
    for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) jouables.add(`${q},${r}`);

    const occupees = new Set(
      [...jouables].map((id) => {
        const { x, z } = centreHex(id);
        return `${x.toFixed(6)}/${z.toFixed(6)}`;
      }),
    );
    for (const { x, z } of ilesDuLarge(jouables)) {
      expect(occupees.has(`${x.toFixed(6)}/${z.toFixed(6)}`)).toBe(false);
    }
  });

  it('dessine le large de la même façon à chaque rendu', () => {
    // Une carte qui change de décor entre deux images donnerait l'impression
    // que le monde bouge sans raison.
    const ids = new Set(['0,0', '1,0', '0,1']);
    expect(ilesDuLarge(ids)).toEqual(ilesDuLarge(ids));
  });
});

describe('hexDe', () => {
  it('retrouve l’hexagone dont on lui donne le centre', () => {
    for (const id of ['0,0', '3,-2', '-4,1', '7,-3', '-6,6']) {
      expect(hexDe(centreHex(id))).toBe(id);
    }
  });

  it('reste sur la tuile tant qu’on n’en sort pas', () => {
    // Le rayon inscrit vaut √3/2 : tout point plus proche du centre que cela
    // appartient à la tuile, quel que soit le cap.
    const id = '2,1';
    const centre = centreHex(id);
    for (let k = 0; k < 24; k++) {
      const angle = (k * Math.PI) / 12;
      const rayon = TAILLE * 0.85 * (Math.sqrt(3) / 2);
      expect(hexDe({ x: centre.x + rayon * Math.cos(angle), z: centre.z + rayon * Math.sin(angle) })).toBe(id);
    }
  });

  it('bascule sur le voisin dès qu’on franchit le bord', () => {
    // Un pas au-delà du milieu du côté partagé : on est chez le voisin, et
    // c'est bien lui — pas la tuile d'à côté, comme le donnerait un arrondi
    // fait coordonnée par coordonnée.
    const centre = centreHex('0,0');
    for (const voisin of VOISINS) {
      const cible = centreHex(`${voisin[0]},${voisin[1]}`);
      const point = {
        x: centre.x + (cible.x - centre.x) * 0.62,
        z: centre.z + (cible.z - centre.z) * 0.62,
      };
      expect(hexDe(point)).toBe(`${voisin[0]},${voisin[1]}`);
    }
  });
});
