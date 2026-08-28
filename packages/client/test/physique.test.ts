import { Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { DUREE_MAX, PAS_IMAGE, type Lacher, simuler } from '../src/ui/board3d/physique.js';
import { NORMALES, tirages } from '../src/ui/board3d/roulement.js';

/*
 * Ce que ces tests vérifient est ce sur quoi tout le reste repose : un dé
 * simulé ne triche pas, et pourtant il s'arrête sur le nombre demandé. Les
 * deux affirmations tiennent ensemble grâce aux vingt-quatre symétries du
 * cube, et c'est cela qu'on met à l'épreuve — pas l'allure du roulement, qui
 * ne se juge qu'à l'œil.
 */

const COTE = 0.8;
const TABLE = 0.17;

/** Un lâcher plausible, tiré d'une graine comme le fait le module des dés. */
function lachers(graine: number): Lacher[] {
  const tirage = tirages(graine);
  return [0, 1].map((i) => ({
    p: new Vector3((i - 0.5) * 1.2 + (tirage() - 0.5) * 0.4, TABLE + 5 + tirage(), 1.6),
    v: new Vector3((tirage() - 0.5) * 1.5, -tirage(), -2.6 * (0.85 + tirage() * 0.3)),
    q: new Quaternion(tirage(), tirage(), tirage(), tirage()).normalize(),
    w: new Vector3(tirage() - 0.5, tirage() - 0.5, tirage() - 0.5)
      .normalize().multiplyScalar(12 + tirage() * 8),
  }));
}

const COINS = [-1, 1].flatMap((x) => [-1, 1].flatMap((y) => [-1, 1].map((z) => [x, y, z])));

/** Le point le plus bas du dé, à une image donnée. */
function creux(p: Vector3, q: Quaternion): number {
  let bas = Infinity;
  for (const [x, y, z] of COINS) {
    const coin = new Vector3((x as number) * COTE / 2, (y as number) * COTE / 2, (z as number) * COTE / 2)
      .applyQuaternion(q).add(p);
    bas = Math.min(bas, coin.y);
  }
  return bas;
}

describe('la chute d’un dé', () => {
  it('ne traverse jamais la table', () => {
    for (const graine of [0.1, 0.37, 0.62, 0.94]) {
      for (const chute of simuler(lachers(graine), TABLE, COTE)) {
        for (const image of chute.images) {
          // Une tolérance d'un centième d'unité : la correction de position
          // agit après le pas, donc une image peut être prise à l'instant
          // exact où un coin effleure le bois.
          expect(creux(image.p, image.q)).toBeGreaterThan(TABLE - 0.01);
        }
      }
    }
  });

  it('s’immobilise, et à plat', () => {
    let poses = 0;
    for (let k = 0; k < 24; k++) {
      const chutes = simuler(lachers(k / 24), TABLE, COTE);
      for (const chute of chutes) {
        if (chute.repos < DUREE_MAX) poses++;

        // La dernière image est celle d'un dé couché : un de ses axes regarde
        // exactement le ciel, sans quoi le nombre se lirait de travers.
        const derniere = chute.images[chute.images.length - 1] as { p: Vector3; q: Quaternion };
        const haut = chute.axeHaut.clone().applyQuaternion(derniere.q);
        expect(haut.y).toBeCloseTo(1, 5);
        expect(derniere.p.y).toBeCloseTo(TABLE + COTE / 2, 5);
      }
    }
    // La grande majorité s'arrête d'elle-même dans le temps imparti ; les
    // autres sont couchées sur les dernières images.
    expect(poses).toBeGreaterThan(40);
  });

  it('tombe pendant tout le budget, image par image', () => {
    const [chute] = simuler(lachers(0.5), TABLE, COTE);
    expect(chute?.images.length).toBeGreaterThanOrEqual(Math.floor(DUREE_MAX / PAS_IMAGE));
  });

  it('roule vraiment : le dé tourne et se déplace', () => {
    const [chute] = simuler(lachers(0.28), TABLE, COTE);
    const images = chute?.images ?? [];
    const debut = images[0] as { p: Vector3; q: Quaternion };
    const fin = images[images.length - 1] as { p: Vector3; q: Quaternion };

    expect(debut.p.y - fin.p.y).toBeGreaterThan(3);
    expect(debut.p.distanceTo(fin.p)).toBeGreaterThan(1);

    /*
     * L'angle cumulé d'une image à la suivante, et non l'angle du début à la
     * fin : un dé qui a fait trois tours et demi se retrouve presque dans sa
     * pose de départ, et la comparaison directe conclurait qu'il n'a pas
     * bougé.
     */
    let tourne = 0;
    for (let k = 1; k < images.length / 2; k++) {
      tourne += (images[k - 1] as { q: Quaternion }).q.angleTo((images[k] as { q: Quaternion }).q);
    }
    expect(tourne).toBeGreaterThan(6);
  });

  it('donne la même chute à qui a la même graine', () => {
    const a = simuler(lachers(0.77), TABLE, COTE);
    const b = simuler(lachers(0.77), TABLE, COTE);
    const c = simuler(lachers(0.78), TABLE, COTE);

    const trace = (t: typeof a) => t.flatMap((x) => x.images.map((i) => i.p.toArray().concat(i.q.toArray())));
    expect(trace(a)).toEqual(trace(b));
    expect(trace(a)).not.toEqual(trace(c));
  });
});

describe('la repeinture', () => {
  it('amène n’importe quel nombre sur la face qui s’est arrêtée en haut', () => {
    /*
     * Le cœur de l'affaire. La chute est ce qu'elle est ; on cherche la
     * rotation qui, appliquée au dé dans son propre repère, met le nombre
     * voulu là où la chute a laissé sa face du dessus. Elle existe toujours,
     * et c'est ce qui permet à une vraie simulation de servir un résultat
     * décidé ailleurs.
     */
    for (const graine of [0.05, 0.31, 0.66, 0.88]) {
      for (const chute of simuler(lachers(graine), TABLE, COTE)) {
        const derniere = chute.images[chute.images.length - 1] as { q: Quaternion };
        for (let valeur = 1; valeur <= 6; valeur++) {
          const n = NORMALES[valeur] as readonly [number, number, number];
          const symetrie = new Quaternion().setFromUnitVectors(
            new Vector3(n[0], n[1], n[2]), chute.axeHaut,
          );
          const repeint = derniere.q.clone().multiply(symetrie);
          const haut = new Vector3(n[0], n[1], n[2]).applyQuaternion(repeint);
          expect(haut.y).toBeCloseTo(1, 5);
        }
      }
    }
  });
});
