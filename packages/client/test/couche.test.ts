import { BoxGeometry, Matrix4, MeshBasicMaterial, Object3D, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';

import { DUREE_CHUTE, chute, poussiere } from '../src/ui/board3d/chute.js';
import { Couche } from '../src/ui/board3d/couche.js';

/*
 * Ces tests ne dessinent rien.
 *
 * `InstancedMesh` est un objet de scène ordinaire : il tient ses matrices
 * dans un tampon de nombres, et n'a besoin d'un contexte graphique qu'au
 * moment d'être rendu. On peut donc vérifier ici tout ce qui décide de
 * l'apparence — où est chaque pièce, à quelle échelle — sans navigateur.
 */
function couche(options: ConstructorParameters<typeof Couche>[3]): Couche {
  return new Couche(new Object3D(), new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), options);
}

/** La position et l'échelle d'une instance, telles qu'elles seront rendues. */
function etat(c: Couche, i: number): { y: number; echelleY: number } {
  const m = new Matrix4();
  c.mesh.getMatrixAt(i, m);
  return {
    y: new Vector3().setFromMatrixPosition(m).y,
    echelleY: new Vector3().setFromMatrixScale(m).y,
  };
}

const aLaPosition = (x: number, y: number, z: number): Matrix4 =>
  new Matrix4().makeTranslation(x, y, z);

describe('une couche animée', () => {
  /*
   * Le test qui compte.
   *
   * Rejoindre une partie en cours ne doit rien faire tomber : les pièces sont
   * déjà là. La première version datait ces pièces de l'avenir au lieu du
   * passé — elles attendaient donc toutes leur tour, à échelle nulle, et le
   * plateau s'affichait entièrement vide. Aucun test de courbe n'aurait vu
   * cela : la faute était dans la date, pas dans l'animation.
   */
  it('pose sans animer ce qui était déjà là', () => {
    const c = couche({ animation: chute, cascade: 0.07 });
    c.reinitialiser(10, true);
    c.ajouter('a', aLaPosition(0, 0.5, 0));
    c.ajouter('b', aLaPosition(1, 0.5, 0));
    c.ajouter('c', aLaPosition(2, 0.5, 0));
    c.finir();

    for (let i = 0; i < 3; i++) {
      expect(etat(c, i).y).toBeCloseTo(0.5, 6);
      expect(etat(c, i).echelleY).toBeCloseTo(1, 6);
    }
    expect(c.animer(10)).toBe(false);
  });

  it('fait tomber ce qui vient d’être posé', () => {
    const c = couche({ animation: chute });
    c.reinitialiser(0, true);
    c.ajouter('a', aLaPosition(0, 0.5, 0));
    c.finir();

    // Une seconde passe, où « b » apparaît : lui seul doit être en l'air.
    c.reinitialiser(10);
    c.ajouter('a', aLaPosition(0, 0.5, 0));
    c.ajouter('b', aLaPosition(1, 0.5, 0));
    c.finir();

    expect(etat(c, 0).y).toBeCloseTo(0.5, 6);
    expect(etat(c, 1).y).toBeGreaterThan(2);

    // Puis elle retombe exactement à sa place, et l'animation s'arrête.
    expect(c.animer(10.2)).toBe(true);
    expect(etat(c, 1).y).toBeLessThan(2);
    expect(c.animer(10 + DUREE_CHUTE + 0.01)).toBe(false);
    expect(etat(c, 1).y).toBeCloseTo(0.5, 6);
    expect(etat(c, 1).echelleY).toBeCloseTo(1, 6);
  });

  it('oublie la date d’une pièce retirée du plateau', () => {
    // Sinon une route reposée au même endroit après un retour en arrière
    // réapparaîtrait sans tomber, comme si elle n'avait jamais bougé.
    const c = couche({ animation: chute });
    c.reinitialiser(0);
    c.ajouter('a', aLaPosition(0, 0.5, 0));
    c.finir();
    c.animer(DUREE_CHUTE + 1);

    c.reinitialiser(20);
    c.finir();

    c.reinitialiser(30);
    c.ajouter('a', aLaPosition(0, 0.5, 0));
    c.finir();
    expect(etat(c, 0).y).toBeGreaterThan(2);
  });

  it('égrène les poses simultanées', () => {
    const c = couche({ animation: chute, cascade: 0.1 });
    c.reinitialiser(0, true);
    c.finir();

    c.reinitialiser(5);
    c.ajouter('a', aLaPosition(0, 0, 0));
    c.ajouter('b', aLaPosition(1, 0, 0));
    c.finir();

    // À l'instant de la pose, la première tombe déjà et la seconde attend :
    // c'est ce décalage qui fait lire douze chutes plutôt qu'un bloc.
    expect(etat(c, 0).echelleY).toBeCloseTo(1, 6);
    expect(etat(c, 1).echelleY).toBeCloseTo(0, 6);
  });

  it('n’anime rien sans animation déclarée', () => {
    const c = couche({});
    c.reinitialiser(0);
    c.ajouter('a', aLaPosition(0, 3, 0));
    c.finir();
    expect(etat(c, 0).y).toBeCloseTo(3, 6);
    expect(c.animer(1)).toBe(false);
  });

  it('retrouve ce que représente chaque instance', () => {
    const c = couche({});
    c.reinitialiser(0);
    c.ajouter('sommet-1', aLaPosition(0, 0, 0));
    c.ajouter('sommet-2', aLaPosition(1, 0, 0));
    c.finir();
    expect(c.cleDe(1)).toBe('sommet-2');
    expect(c.cleDe(undefined)).toBeUndefined();
    expect(c.posesRecentes()).toEqual(['sommet-1', 'sommet-2']);
  });

  it('grandit sans perdre ce qu’elle portait', () => {
    // La couche double sa capacité au soixante-cinquième ajout, en pleine
    // passe : les soixante-quatre premières pièces viennent d'être écrites
    // et doivent survivre au changement de tampon.
    const c = couche({});
    c.reinitialiser(0);
    for (let i = 0; i < 200; i++) c.ajouter(`p${i}`, aLaPosition(0, i, 0));
    c.finir();
    expect(c.mesh.count).toBe(200);
    for (const i of [0, 63, 64, 127, 199]) expect(etat(c, i).y).toBeCloseTo(i, 6);
  });
});

describe('les courbes de chute', () => {
  it('part d’en haut, arrive à sa place, et s’arrête', () => {
    expect(chute(0).dy).toBeGreaterThan(2);
    expect(chute(0).fini).toBe(false);
    expect(chute(DUREE_CHUTE).fini).toBe(true);
    expect(chute(DUREE_CHUTE).dy).toBe(0);
    expect(chute(DUREE_CHUTE).echelleY).toBe(1);
  });

  it('accélère en tombant plutôt que de freiner', () => {
    // Une chute qui ralentit à l'arrivée se lit comme une pièce reposée à la
    // main, pas comme une pièce lâchée. C'est toute la différence de poids.
    const debut = chute(0).dy - chute(0.05).dy;
    const fin = chute(0.2).dy - chute(0.25).dy;
    expect(fin).toBeGreaterThan(debut);
  });

  it('n’existe pas avant son tour', () => {
    expect(chute(-0.1).echelleY).toBe(0);
    expect(chute(-0.1).fini).toBe(false);
  });

  it('écrase puis étire, en conservant grossièrement le volume', () => {
    // On cherche l'instant le plus écrasé du rebond.
    let plusEcrase = 1;
    let largeurAlors = 1;
    for (let t = 0.3; t < DUREE_CHUTE; t += 0.005) {
      const e = chute(t);
      if (e.echelleY < plusEcrase) { plusEcrase = e.echelleY; largeurAlors = e.echelleXZ; }
    }
    expect(plusEcrase).toBeLessThan(0.85);
    expect(largeurAlors).toBeGreaterThan(1);
  });
});

describe('la poussière d’impact', () => {
  it('reste invisible tant que la pièce est en l’air', () => {
    expect(poussiere(0).eclat).toBe(0);
    expect(poussiere(0).echelleXZ).toBe(0);
  });

  it('s’ouvre à l’impact puis s’éteint', () => {
    const juste = poussiere(0.32);
    expect(juste.eclat).toBeGreaterThan(0.5);
    expect(juste.echelleXZ).toBeGreaterThan(0);
    expect(poussiere(0.6).eclat).toBeLessThan(juste.eclat);
    expect(poussiere(5).eclat).toBe(0);
  });
});
