import { PerspectiveCamera, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { Cadrage } from '../src/ui/board3d/camera.js';
import type { Point3 } from '../src/ui/board3d/geometrie.js';

/*
 * Le retour de soirée : sur téléphone, l'île n'occupait qu'un tiers de la
 * hauteur, le reste étant de la mer vide. Le cadrage reculait jusqu'à ce que
 * le plateau tienne en largeur — la contrainte d'un écran tenu debout —
 * sans jamais penser à le coucher dans l'autre sens.
 *
 * Ces tests tiennent la propriété plutôt que le calcul : après cadrage, le
 * plateau doit s'étaler dans le sens où l'écran est long.
 */

/** Un archipel en écharpe : long selon x, étroit selon z. */
function archipelAllonge(): Point3[] {
  const points: Point3[] = [];
  for (let i = -20; i <= 20; i += 2) {
    for (let j = -4; j <= 4; j += 2) points.push({ x: i, z: j });
  }
  return points;
}

const camera = (largeur: number, hauteur: number): PerspectiveCamera => {
  const cam = new PerspectiveCamera(42, largeur / hauteur, 0.1, 1000);
  return cam;
};

/** L'emprise du plateau à l'écran, en coordonnées normalisées. */
function empriseProjetee(points: readonly Point3[], cam: PerspectiveCamera) {
  cam.updateMatrixWorld();
  cam.updateProjectionMatrix();
  const v = new Vector3();
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  for (const p of points) {
    v.set(p.x, 0, p.z).project(cam);
    xMin = Math.min(xMin, v.x); xMax = Math.max(xMax, v.x);
    yMin = Math.min(yMin, v.y); yMax = Math.max(yMax, v.y);
  }
  return { largeur: xMax - xMin, hauteur: yMax - yMin, xMax, yMax, xMin, yMin };
}

describe('orientation du plateau', () => {
  it('couche l’archipel dans la hauteur sur un écran tenu debout', () => {
    const points = archipelAllonge();
    const cam = camera(375, 812);
    new Cadrage().cadrer(points, { x: 0, z: 0 }, 20, cam);

    const emprise = empriseProjetee(points, cam);
    expect(emprise.hauteur).toBeGreaterThan(emprise.largeur);
  });

  it('le couche dans la largeur sur un écran couché', () => {
    const points = archipelAllonge();
    const cam = camera(1280, 720);
    new Cadrage().cadrer(points, { x: 0, z: 0 }, 20, cam);

    const emprise = empriseProjetee(points, cam);
    expect(emprise.largeur).toBeGreaterThan(emprise.hauteur);
  });

  it('remplit bien plus l’écran debout qu’en gardant l’axe d’origine', () => {
    /*
     * La mesure du bug. Sans orientation, le plateau tient en largeur et
     * laisse deux bandes de mer : il n'occupe qu'une fraction de la hauteur.
     */
    const points = archipelAllonge();

    const oriente = camera(375, 812);
    new Cadrage().cadrer(points, { x: 0, z: 0 }, 20, oriente);
    const apres = empriseProjetee(points, oriente);

    // Le même plateau vu sans réorientation, à la distance que le cadrage
    // d'origine imposait : l'axe long en travers de l'écran étroit.
    const brut = camera(375, 812);
    brut.position.set(0, 40 * Math.cos(0.72), 40 * Math.cos(0));
    brut.lookAt(0, 0, 0);
    const avant = empriseProjetee(points, brut);

    expect(apres.hauteur).toBeGreaterThan(avant.hauteur * 1.5);
  });

  it('couvre l’écran, sans se contenter d’approcher', () => {
    /*
     * Le test qui manquait. Le premier jet choisissait l'orientation qui
     * laissait la caméra approcher le plus — et se trompait à chaque fois.
     * Couché en travers, un archipel laisse approcher davantage, la largeur
     * butant la première, mais ne forme plus qu'un bandeau. La distance ne
     * dit pas ce que le joueur voit ; la surface, si.
     *
     * Le nuage reproduit l'archipel à douze : une île centrale et trois
     * secondaires, étalées en écharpe.
     */
    const points: Point3[] = [];
    for (const [cx, cz] of [[0, 0], [-14, 2], [14, 1], [-1, -9]] as const) {
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) points.push({ x: cx + i, z: cz + j });
    }
    const cam = camera(375, 812);
    new Cadrage().cadrer(points, { x: 0, z: -1.5 }, 18, cam);

    const e = empriseProjetee(points, cam);
    const part = (e.largeur * e.hauteur) / 4;
    // En travers, l'archipel ne couvrait que 15 % du cadre ; couché dans la
    // hauteur, il en couvre trois fois plus.
    expect(part).toBeGreaterThan(0.35);
    expect(e.hauteur).toBeGreaterThan(0.9);
  });

  it('ne laisse jamais un point sortir du cadre', () => {
    for (const [l, h] of [[375, 812], [1280, 720], [768, 1024], [900, 900]] as const) {
      const points = archipelAllonge();
      const cam = camera(l, h);
      new Cadrage().cadrer(points, { x: 0, z: 0 }, 20, cam);

      const e = empriseProjetee(points, cam);
      expect(Math.max(Math.abs(e.xMin), Math.abs(e.xMax))).toBeLessThanOrEqual(1.001);
      expect(Math.max(Math.abs(e.yMin), Math.abs(e.yMax))).toBeLessThanOrEqual(1.001);
    }
  });

  it('n’a rien à choisir sur un plateau rond, et n’y perd rien', () => {
    // Sur un disque, la direction principale est arbitraire : les deux essais
    // se valent, et le cadrage doit rester serré quand même.
    const points: Point3[] = [];
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      for (const r of [4, 8, 12]) points.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
    }
    const cam = camera(375, 812);
    new Cadrage().cadrer(points, { x: 0, z: 0 }, 12, cam);

    const e = empriseProjetee(points, cam);
    expect(Math.max(Math.abs(e.xMin), Math.abs(e.xMax))).toBeLessThanOrEqual(1.001);
    // Serré : le plateau touche au moins un bord.
    expect(Math.max(e.largeur, e.hauteur)).toBeGreaterThan(1.5);
  });
});

describe('recentrer', () => {
  it('rétablit l’orientation choisie pour cet écran, pas le nord', () => {
    /*
     * `recentrer()` remettait l'azimut à zéro — c'est-à-dire justement
     * l'orientation qui gaspille l'écran sur un téléphone. Le bouton
     * « Recentrer » aurait donc défait ce que le cadrage venait de faire.
     */
    const points = archipelAllonge();
    const cam = camera(375, 812);
    const cadrage = new Cadrage();
    cadrage.cadrer(points, { x: 0, z: 0 }, 20, cam);

    const apresCadrage = empriseProjetee(points, cam);
    expect(cadrage.deplace).toBe(false);

    cadrage.tourner(1.2, 0);
    expect(cadrage.deplace).toBe(true);

    cadrage.recentrer();
    cadrage.appliquer(cam);
    const apresRecentrage = empriseProjetee(points, cam);

    expect(cadrage.deplace).toBe(false);
    expect(apresRecentrage.hauteur).toBeCloseTo(apresCadrage.hauteur, 6);
    expect(apresRecentrage.largeur).toBeCloseTo(apresCadrage.largeur, 6);
  });
});
