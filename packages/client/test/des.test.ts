import { Object3D, Vector3 } from 'three';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { COTE, Des } from '../src/ui/board3d/des.js';
import { DUREE_ROULEMENT, DUREE_TOTALE, NORMALES } from '../src/ui/board3d/roulement.js';

/*
 * Ces tests ne dessinent rien non plus.
 *
 * Un maillage Three.js est un objet ordinaire tant qu'on ne le rend pas : sa
 * position et son orientation se lisent sans contexte graphique. Ce qui
 * manque, c'est le canevas des faces — on le rend indisponible, les dés se
 * montent alors sans texture, et tout ce qui décide de leur place reste
 * vérifiable.
 */
const CANEVAS_ABSENT = {
  createElement: () => ({ width: 0, height: 0, getContext: () => null }),
};

/** Où regarde la face `valeur` du dé `de`. */
function faceVers(de: { quaternion: never }, valeur: number): Vector3 {
  const n = NORMALES[valeur] as readonly [number, number, number];
  return new Vector3(n[0], n[1], n[2]).applyQuaternion(de.quaternion);
}

const ANCRE = new Vector3(4, 0.17, -2);
const VERS_CAMERA = new Vector3(0, 0, 1);

describe('les dés sur la carte', () => {
  let scene: Object3D;
  let des: Des;

  beforeEach(() => {
    (globalThis as { document?: unknown }).document = CANEVAS_ABSENT;
    scene = new Object3D();
    des = new Des(scene);
  });

  afterEach(() => {
    des.detruire();
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { matchMedia?: unknown }).matchMedia;
  });

  /** Les deux dés. Le troisième objet de la scène est le total annoncé. */
  const pions = (): readonly { visible: boolean; position: Vector3; quaternion: never }[] =>
    scene.children.slice(0, 2) as never;

  const annonce = (): { visible: boolean; position: Vector3 } =>
    scene.children[2] as never;

  it('monte deux dés et leur total, éteints tant que rien n’est lancé', () => {
    expect(scene.children).toHaveLength(3);
    expect(pions().every((de) => !de.visible)).toBe(true);
    expect(annonce().visible).toBe(false);
  });

  it('n’annonce le total qu’une fois les dés arrêtés', () => {
    des.lancer(5, 2, 0.42, ANCRE, VERS_CAMERA, 10);

    // Au lâcher, le nombre dirait le résultat avant les dés.
    des.animer(10.05);
    expect(annonce().visible).toBe(false);

    des.animer(10 + DUREE_ROULEMENT + 0.4);
    expect(annonce().visible).toBe(true);
    // Au-dessus des dés, pas dessus : on doit pouvoir vérifier l'addition.
    expect(annonce().position.y).toBeGreaterThan(ANCRE.y + COTE);

    // Au-dessus des dés là où ils se sont arrêtés, et non au-dessus du point
    // qui était visé : c'est la chute qui décide de l'endroit.
    const milieu = new Vector3()
      .addVectors((pions()[0] as { position: Vector3 }).position,
        (pions()[1] as { position: Vector3 }).position)
      .multiplyScalar(0.5);
    expect(annonce().position.x).toBeCloseTo(milieu.x, 5);
    expect(annonce().position.z).toBeCloseTo(milieu.z, 5);
  });

  it('les pose sur leur nombre, près du point visé', () => {
    des.lancer(3, 5, 0.42, ANCRE, VERS_CAMERA, 10);
    des.animer(10 + DUREE_ROULEMENT);

    const [premier, second] = pions();
    expect(premier?.visible).toBe(true);
    expect(second?.visible).toBe(true);

    // Chacun montre le nombre que le moteur a tiré, et lui seul.
    expect(faceVers(premier as never, 3).y).toBeCloseTo(1, 6);
    expect(faceVers(second as never, 5).y).toBeCloseTo(1, 6);

    for (const de of pions()) {
      // Posés sur la table : leur centre est à un demi-côté au-dessus.
      expect(de.position.y).toBeCloseTo(ANCRE.y + COTE / 2, 6);
      // Et près du point visé : ils roulent, mais ne s'exilent pas.
      expect(Math.hypot(de.position.x - ANCRE.x, de.position.z - ANCRE.z)).toBeLessThan(2.5);
    }

    // Jamais l'un dans l'autre : la simulation les repousse.
    const ecart = (premier as { position: Vector3 }).position
      .distanceTo((second as { position: Vector3 }).position);
    expect(ecart).toBeGreaterThan(COTE);
  });

  it('les fait arriver d’en haut et du côté de la caméra', () => {
    des.lancer(2, 6, 0.42, ANCRE, VERS_CAMERA, 10);
    des.animer(10.02);

    for (const de of pions()) {
      expect(de.position.y).toBeGreaterThan(ANCRE.y + 1);
      // `versCamera` pointe vers les z croissants : ils partent de là.
      expect(de.position.z).toBeGreaterThan(ANCRE.z + 1);
    }
  });

  it('s’efface, et ne se rallume pas tout seul', () => {
    des.lancer(1, 1, 0.1, ANCRE, VERS_CAMERA, 10);
    des.animer(10 + DUREE_TOTALE + 0.01);
    expect(pions().every((de) => !de.visible)).toBe(true);

    des.animer(10 + DUREE_TOTALE + 5);
    expect(pions().every((de) => !de.visible)).toBe(true);
  });

  it('ne bouge pas quand le mouvement est refusé', () => {
    (globalThis as { matchMedia?: unknown }).matchMedia = (requete: string) => ({
      matches: requete.includes('reduced-motion'),
    });

    des.lancer(6, 4, 0.7, ANCRE, VERS_CAMERA, 10);
    // Pas de roulement : dès la première image, les dés sont posés et
    // lisibles — on saute directement à l'instant où la chute s'est arrêtée.
    des.animer(10);
    const [premier, second] = pions();
    expect(faceVers(premier as never, 6).y).toBeCloseTo(1, 6);
    expect(faceVers(second as never, 4).y).toBeCloseTo(1, 6);
    expect(premier?.position.y).toBeCloseTo(ANCRE.y + COTE / 2, 4);
  });
});
