import { describe, expect, it } from 'vitest';

import {
  TOLERANCE_DOIGT, TOLERANCE_SOURIS, TORSION_MORTE,
  azimutDepuisTorsion, ecartAngulaire, estGlissement, toleranceDe,
} from '../src/ui/board3d/gestes.js';

/*
 * Les deux décisions rapportées cassées de la première soirée. Chacune est
 * fausse de façon silencieuse : le seul moyen de savoir qu'elles reviennent
 * est de les tenir ici.
 */

describe('appui ou glissement', () => {
  it('laisse à un doigt bien plus de dérive qu’à une souris', () => {
    expect(toleranceDe('mouse')).toBe(TOLERANCE_SOURIS);
    expect(toleranceDe('touch')).toBe(TOLERANCE_DOIGT);
    expect(toleranceDe('pen')).toBe(TOLERANCE_DOIGT);
    expect(TOLERANCE_DOIGT).toBeGreaterThan(TOLERANCE_SOURIS * 3);
  });

  it('tient pour un appui le doigt qui s’étale de huit pixels', () => {
    // Le bug rapporté : « déplacer le voleur ne fonctionne pas toujours,
    // malgré l'appui sur la zone ». Une pulpe qui s'écrase parcourt cette
    // distance sans que personne n'ait voulu glisser.
    const depart = { x: 200, y: 300 };
    expect(estGlissement(depart, { x: 206, y: 305 }, 'touch')).toBe(false);
    // La même dérive à la souris est bien un glissement : une souris ne
    // bouge pas toute seule.
    expect(estGlissement(depart, { x: 206, y: 305 }, 'mouse')).toBe(true);
  });

  it('reconnaît un vrai glissement du doigt', () => {
    expect(estGlissement({ x: 0, y: 0 }, { x: 40, y: 0 }, 'touch')).toBe(true);
  });

  it('mesure depuis le départ, donc un aller-retour reste un appui', () => {
    /*
     * Le cœur du bug. L'ancien code comparait chaque événement au précédent :
     * un doigt qui partait à trente pixels et revenait à son point de départ
     * avait franchi le seuil en chemin, et l'appui était perdu. Mesuré depuis
     * le départ, le geste redevient ce qu'il est.
     */
    const depart = { x: 100, y: 100 };
    expect(estGlissement(depart, { x: 130, y: 100 }, 'touch')).toBe(true);
    expect(estGlissement(depart, { x: 102, y: 101 }, 'touch')).toBe(false);
  });
});

describe('écart angulaire', () => {
  it('rend le plus court chemin quand on franchit la discontinuité', () => {
    /*
     * Le bug rapporté : « faire tourner l'île fonctionne que dans un sens ».
     * Deux doigts qui passent de +170° à −170° ont tourné de vingt degrés,
     * pas de trois cent quarante. La soustraction brute donnait −340°, et la
     * carte partait en vrille — mais dans un seul sens de rotation, celui
     * qui croise la frontière.
     */
    const presDePi = Math.PI - 0.17;
    const apresPi = -Math.PI + 0.17;
    expect(ecartAngulaire(presDePi, apresPi)).toBeCloseTo(0.34, 6);
    expect(ecartAngulaire(apresPi, presDePi)).toBeCloseTo(-0.34, 6);
  });

  it('reste dans (−π, π] quel que soit l’écart brut', () => {
    for (let de = -Math.PI; de <= Math.PI; de += 0.3) {
      for (let vers = -Math.PI; vers <= Math.PI; vers += 0.3) {
        const ecart = ecartAngulaire(de, vers);
        expect(ecart).toBeGreaterThan(-Math.PI - 1e-9);
        expect(ecart).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });

  it('ne change rien quand rien ne tourne', () => {
    expect(ecartAngulaire(1.2, 1.2)).toBeCloseTo(0, 12);
  });

  it('somme une rotation complète en 2π, sans saut', () => {
    // Une torsion continue doit s'intégrer proprement : c'est ce que fait la
    // scène, image par image.
    const images = 126;
    const pas = (Math.PI * 2) / images;
    let total = 0;
    for (let i = 0; i < images; i++) total += ecartAngulaire(i * pas, (i + 1) * pas);
    expect(total).toBeCloseTo(Math.PI * 2, 6);
  });
});

describe('sens de la rotation', () => {
  it('fait tourner la carte dans le sens des doigts', () => {
    /*
     * L'écran a son axe vertical vers le bas, donc `atan2` y croît dans le
     * sens des aiguilles ; l'azimut de la caméra aussi, ce que montre
     * `Cadrage.appliquer()`. Les deux vont donc de pair, et l'écart s'applique
     * tel quel. Le signe négatif qui figurait là renversait la carte : c'est
     * le « à l'envers » du rapport de soirée.
     */
    expect(azimutDepuisTorsion(0.4)).toBeGreaterThan(0);
    expect(azimutDepuisTorsion(-0.4)).toBeLessThan(0);
    expect(azimutDepuisTorsion(0.4)).toBeCloseTo(0.4, 12);
  });
});

describe('zone morte de torsion', () => {
  it('laisse pincer sans faire pivoter la carte', () => {
    // Deux doigts qui pincent ne restent jamais parfaitement alignés. Le
    // bruit d'un zoom franc reste très en deçà du seuil.
    const bruitParImage = 0.004;
    let cumul = 0;
    for (let image = 0; image < 20; image++) cumul += Math.abs(bruitParImage);
    expect(cumul).toBeLessThan(TORSION_MORTE);
  });

  it('cède à une torsion franche', () => {
    // Une dizaine de degrés suffit à montrer l'intention.
    expect(Math.abs(ecartAngulaire(0, 0.18))).toBeGreaterThan(TORSION_MORTE);
  });
});
