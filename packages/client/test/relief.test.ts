import { describe, expect, it } from 'vitest';

import {
  baseDe, geoRelief, orientationDe, profilDe, sommetDe,
} from '../src/ui/board3d/relief.js';

const TERRAINS = ['mountain', 'hills', 'gold', 'forest', 'desert', 'pasture', 'field'];

/**
 * À quelle fraction du bord se trouve un point de l'hexagone.
 *
 * Un pour un point de la frontière, zéro au centre. La distance euclidienne
 * ne dit pas cela : un coin est à 1 du centre, un milieu de côté à 0,866, et
 * les deux sont pourtant sur le bord. On mesure donc contre les six côtés.
 */
function normeHex(x: number, z: number): number {
  const apotheme = Math.sqrt(3) / 2;
  let plus = 0;
  for (let k = 0; k < 6; k++) {
    const angle = (k + 0.5) * (Math.PI / 3);
    plus = Math.max(plus, (x * Math.sin(angle) + z * Math.cos(angle)) / apotheme);
  }
  return plus;
}

/** Les sommets de la géométrie, en triplets. */
function points(terrain: string, rayon = 1): { x: number; y: number; z: number }[] {
  const position = geoRelief(terrain, rayon).getAttribute('position');
  return Array.from({ length: position.count }, (_, i) => ({
    x: position.getX(i), y: position.getY(i), z: position.getZ(i),
  }));
}

describe('le relief des tuiles', () => {
  /*
   * L'invariant qui tient tout.
   *
   * Le bord doit être exactement plat, et exactement à zéro. C'est ce qui
   * permet à deux tuiles de terrains différents de se toucher sans laisser
   * voir un jour entre elles, et à une route posée sur leur arête commune de
   * ne pencher ni d'un côté ni de l'autre.
   */
  it('laisse le bord de chaque tuile rigoureusement plat', () => {
    for (const terrain of TERRAINS) {
      let bords = 0;
      for (const p of points(terrain)) {
        const h = normeHex(p.x, p.z);
        // Sur la frontière : altitude nulle, sans la moindre tolérance.
        if (h > 0.9999) { expect(p.y).toBeCloseTo(0, 10); bords++; }
        // Partout ailleurs : au-dessus du niveau du bord, jamais en dessous.
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
      }
      expect(bords).toBeGreaterThan(10);
    }
  });

  it('soulève le centre de chaque terrain productif', () => {
    for (const terrain of TERRAINS) {
      const centre = points(terrain).filter((p) => Math.hypot(p.x, p.z) < 0.001);
      expect(centre.length).toBeGreaterThan(0);
      for (const p of centre) expect(p.y).toBeCloseTo(profilDe(terrain).crete, 6);
    }
  });

  it('fait de la montagne le point le plus haut du plateau', () => {
    const hauteurs = TERRAINS.map((t) => ({ t, h: sommetDe(t) }));
    const plusHaut = hauteurs.reduce((a, b) => (b.h > a.h ? b : a));
    expect(plusHaut.t).toBe('mountain');
    // Et le champ le plus bas : c'est ce qui doit se lire d'un coup d'œil.
    const plusBas = hauteurs.reduce((a, b) => (b.h < a.h ? b : a));
    expect(plusBas.t).toBe('field');
  });

  /*
   * L'autre invariant, moins évident et plus fragile.
   *
   * Le dénivelé entre deux *bords* doit rester petit. Les routes courent sur
   * les arêtes et les colonies sur les sommets : c'est le seul endroit du
   * plateau où deux terrains différents se rencontrent, et un écart trop
   * grand y ferait des routes suspendues au-dessus du champ voisin.
   */
  it('garde les bords des terrains à des altitudes voisines', () => {
    const bases = TERRAINS.map(baseDe);
    expect(Math.max(...bases) - Math.min(...bases)).toBeLessThanOrEqual(0.1);
  });

  it('ignore la mer et ce qu’il ne connaît pas', () => {
    expect(baseDe('sea')).toBe(0);
    expect(sommetDe('sea')).toBe(0);
    expect(baseDe('terrain-inconnu')).toBe(0);
  });

  it('plaque l’image en l’inscrivant dans l’hexagone', () => {
    // Le même placage que la face plate qu'il remplace : sans quoi les
    // illustrations se décaleraient d'une tuile à l'autre.
    const geo = geoRelief('forest', 1);
    const uv = geo.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
      expect(uv.getX(i)).toBeGreaterThanOrEqual(-0.001);
      expect(uv.getX(i)).toBeLessThanOrEqual(1.001);
      expect(uv.getY(i)).toBeGreaterThanOrEqual(-0.001);
      expect(uv.getY(i)).toBeLessThanOrEqual(1.001);
    }
  });

  it('recoud les six secteurs en une seule surface', () => {
    // Sans couture, chaque rayon de l'hexagone porterait une arête de
    // lumière : les normales seraient calculées séparément de part et
    // d'autre d'une même arête.
    const geo = geoRelief('mountain', 1);
    const position = geo.getAttribute('position');
    const vus = new Set<string>();
    for (let i = 0; i < position.count; i++) {
      vus.add([position.getX(i), position.getY(i), position.getZ(i)]
        .map((v) => v.toFixed(5)).join('/'));
    }
    expect(vus.size).toBe(position.count);
    expect(geo.getAttribute('normal')).toBeDefined();
  });
});

describe('l’orientation d’une tuile', () => {
  it('ne rend que des multiples de soixante degrés', () => {
    // La seule rotation qui laisse un hexagone à sa place dans la maille.
    for (const id of ['0,0', '3,-2', '-5,4', '12,7']) {
      const tours = orientationDe(id) / (Math.PI / 3);
      expect(Math.abs(tours - Math.round(tours))).toBeLessThan(1e-9);
      expect(orientationDe(id)).toBeLessThan(Math.PI * 2);
    }
  });

  it('donne toujours la même à la même tuile', () => {
    // Deux joueurs doivent voir le même monde, et le même joueur aussi
    // d'une image à l'autre.
    expect(orientationDe('4,-3')).toBe(orientationDe('4,-3'));
  });

  it('ne donne pas la même à toutes', () => {
    const vues = new Set(['0,0', '1,0', '2,0', '0,1', '1,1', '3,-1', '2,-2'].map(orientationDe));
    expect(vues.size).toBeGreaterThan(2);
  });
});
