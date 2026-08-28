/**
 * Une couche d'objets identiques.
 *
 * Toutes les pièces d'un même type — les colonies, les routes, les jetons du
 * même nombre — partagent une géométrie et un matériau, et ne diffèrent que
 * par leur position et leur couleur. C'est exactement ce que sait faire un
 * `InstancedMesh` : un seul appel de dessin pour cent maisons.
 *
 * Ce qui manque à `InstancedMesh`, et que cette couche ajoute, c'est la
 * mémoire de ce que chaque instance représente. Une matrice ne dit pas sur
 * quel sommet elle se trouve ; sans cette table, un clic renverrait un
 * numéro d'instance dont on ne saurait rien faire, et l'on ne saurait pas
 * davantage laquelle des cent maisons vient d'être posée.
 */

import {
  type BufferGeometry, Color, InstancedMesh, type Material, Matrix4, type Object3D,
} from 'three';

import type { Etape } from './chute.js';

/** Une animation : ce qu'il advient d'une instance, `age` secondes après sa pose. */
export type Animation = (age: number) => Etape;

export interface OptionsCouche {
  readonly colore?: boolean;
  readonly ombrePortee?: boolean;
  readonly ombreRecue?: boolean;
  readonly ordreRendu?: number;
  /**
   * Ce que devient une instance après sa pose.
   *
   * Sa présence seule fait tenir à la couche la mémoire de ce qui est neuf :
   * sans elle, on ne paierait ni les matrices de référence ni la table des
   * naissances.
   */
  readonly animation?: Animation;
  /** Écart entre deux poses simultanées, pour qu'elles tombent en cascade. */
  readonly cascade?: number;
}

/** Provision de départ : la plupart des couches n'en demanderont jamais plus. */
const CAPACITE_INITIALE = 64;

/**
 * L'âge qu'on donne à ce qui était déjà là.
 *
 * Assez grand pour qu'aucune animation ne s'y reconnaisse, et fini — un
 * infini traverserait mal les calculs de matrices.
 */
const DEJA_LA = 1e6;

/*
 * Des matrices de travail, partagées par toutes les couches.
 *
 * L'animation tourne à chaque image sur des dizaines d'instances : allouer
 * quatre matrices par instance et par image donnerait au ramasse-miettes de
 * quoi faire hoqueter la scène toutes les quelques secondes.
 */
const COURSE = new Matrix4();
const ROTATION = new Matrix4();
const ECHELLE = new Matrix4();
const ELEVATION = new Matrix4();

export class Couche {
  mesh: InstancedMesh;

  /** Ce que représente chaque instance, dans l'ordre où elles sont posées. */
  private cles: string[] = [];
  private curseur = 0;
  private capacite: number;
  private readonly teinte = new Color();

  /*
   * De quoi rejouer une pose.
   *
   * `base` garde la matrice telle qu'elle a été demandée : l'animation la
   * modifie à chaque image, et sans copie de référence elle dériverait —
   * chaque image partant du résultat déformé de la précédente.
   */
  private readonly base: Matrix4[] = [];
  private readonly couleurs: string[] = [];
  private readonly naissances = new Map<string, number>();
  /**
   * L'instant de la passe, et la date qu'on donne à ce qui y apparaît.
   *
   * Deux nombres et non un seul, parce qu'ils ne coïncident pas quand la
   * scène déclare que les pièces étaient déjà là : l'instant reste l'heure
   * courante, la naissance recule dans le passé. Les avoir confondus faisait
   * naître les pièces dans l'avenir — toutes attendaient un tour qui ne
   * viendrait jamais, à échelle nulle, et le plateau s'affichait sans une
   * seule route.
   */
  private maintenant = 0;
  private naissanceDesNeuves = 0;
  /** Les clés de la passe précédente : ce qui n'y figure pas vient d'arriver. */
  private precedentes = new Set<string>();
  private nouvelles = 0;

  constructor(
    private readonly parent: Object3D,
    private readonly geometrie: BufferGeometry,
    private readonly materiau: Material,
    private readonly options: OptionsCouche = {},
  ) {
    this.capacite = CAPACITE_INITIALE;
    this.mesh = this.fabriquer(this.capacite);
    parent.add(this.mesh);
  }

  private fabriquer(capacite: number): InstancedMesh {
    const mesh = new InstancedMesh(this.geometrie, this.materiau, capacite);
    mesh.castShadow = this.options.ombrePortee ?? false;
    mesh.receiveShadow = this.options.ombreRecue ?? false;
    if (this.options.ordreRendu !== undefined) mesh.renderOrder = this.options.ordreRendu;
    // Trois.js ne dessine que `count` instances : on part de zéro et la
    // couche grandit au fil des ajouts, plutôt que d'afficher d'un coup
    // soixante-quatre maisons empilées à l'origine.
    mesh.count = 0;
    mesh.frustumCulled = false;
    return mesh;
  }

  /**
   * Double la capacité en conservant ce qui est déjà posé.
   *
   * Une partie à douze joueurs finit avec plus de bâtiments qu'une provision
   * de départ n'en prévoit. Plutôt que de deviner un maximum — et de payer
   * en mémoire ce qu'on ne posera jamais — on grandit quand il le faut.
   *
   * Les tampons de l'ancien maillage sont recopiés dans le nouveau. C'est
   * indispensable : la couche grandit *pendant* une passe, au moment où l'on
   * ajoute la soixante-cinquième maison, et les soixante-quatre premières
   * viennent d'être écrites. Repartir d'un tampon vierge les aurait toutes
   * effacées, et le symptôme — la moitié des pièces qui disparaît au-delà
   * d'un certain nombre — n'aurait ressemblé à rien de connu.
   */
  private agrandir(): void {
    const ancien = this.mesh;
    this.capacite *= 2;
    const neuf = this.fabriquer(this.capacite);

    neuf.instanceMatrix.array.set(ancien.instanceMatrix.array);
    if (ancien.instanceColor) {
      // `setColorAt` alloue le tampon des couleurs à la première teinte
      // posée : on force la même allocation avant de recopier.
      neuf.setColorAt(0, this.teinte.setRGB(1, 1, 1));
      neuf.instanceColor?.array.set(ancien.instanceColor.array);
    }

    this.parent.remove(ancien);
    ancien.dispose();
    this.parent.add(neuf);
    this.mesh = neuf;
  }

  /**
   * Ouvre une nouvelle passe : tout ce qui suit remplace ce qui précédait.
   *
   * `immediat` déclare que les pièces de cette passe étaient déjà là. La
   * scène s'en sert à son premier remplissage : sans lui, rejoindre une
   * partie en cours ferait pleuvoir deux cents pièces sur la tête du joueur
   * qui se reconnecte, comme si tout venait d'être bâti à l'instant.
   */
  reinitialiser(maintenant: number, immediat = false): void {
    this.precedentes = new Set(this.cles);
    this.curseur = 0;
    this.cles.length = 0;
    this.maintenant = maintenant;
    this.naissanceDesNeuves = immediat ? maintenant - DEJA_LA : maintenant;
    this.nouvelles = 0;
  }

  ajouter(cle: string, matrice: Matrix4, couleur?: string): void {
    if (this.curseur >= this.capacite) this.agrandir();
    const i = this.curseur;

    this.cles[i] = cle;
    if (this.options.colore) this.couleurs[i] = couleur ?? '#ffffff';

    if (!this.options.animation) {
      this.mesh.setMatrixAt(i, matrice);
      if (this.options.colore) this.mesh.setColorAt(i, this.teinte.set(this.couleurs[i] ?? '#ffffff'));
      this.curseur++;
      return;
    }

    this.base[i] = matrice.clone();
    if (!this.naissances.has(cle)) {
      // Les poses simultanées s'égrènent au lieu de tomber en bloc : à la
      // mise en place, douze colonies arrivent d'un coup, et douze chutes
      // exactement synchrones se lisent comme une seule.
      this.naissances.set(cle, this.naissanceDesNeuves + (this.options.cascade ?? 0) * this.nouvelles);
      this.nouvelles++;
    }

    /*
     * On applique l'animation dès la pose, sans attendre l'image suivante.
     *
     * Sinon une instance dont l'animation est terminée — une poussière
     * retombée depuis longtemps — s'afficherait dans son état de référence,
     * c'est-à-dire à taille pleine et en pleine lumière, jusqu'à ce que
     * quelqu'un l'anime. Or on n'anime que ce qui bouge encore.
     */
    this.appliquer(i, this.maintenant);
    this.curseur++;
  }

  /** Clôt la passe : c'est ici que la carte graphique apprend le changement. */
  finir(): void {
    this.mesh.count = this.curseur;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.mesh.computeBoundingSphere();

    if (!this.options.animation) return;
    // Une pièce retirée du plateau ne doit pas garder sa date de naissance :
    // reposée plus tard au même endroit, elle réapparaîtrait sans tomber.
    const vivantes = new Set(this.cles);
    for (const cle of this.naissances.keys()) {
      if (!vivantes.has(cle)) this.naissances.delete(cle);
    }
  }

  /**
   * Écrit l'état d'une instance à un instant donné.
   *
   * La matrice animée est `T · B · R · S` : la translation verticale agit
   * dans le monde — la pièce tombe d'aplomb quelle que soit son orientation —
   * tandis que l'inclinaison et l'écrasement agissent après `B`, donc dans le
   * repère de la pièce. C'est ce qui fait qu'une route s'incline sur son axe
   * et qu'une maison s'écrase sur ses fondations, et non sur un point
   * arbitraire du plateau.
   */
  private appliquer(i: number, temps: number): boolean {
    const animation = this.options.animation;
    const base = this.base[i];
    const cle = this.cles[i];
    if (!animation || !base || cle === undefined) return false;

    const naissance = this.naissances.get(cle);
    if (naissance === undefined) return false;

    const etape = animation(temps - naissance);

    COURSE.copy(base);
    if (etape.inclinaison !== 0) {
      ROTATION.makeRotationZ(etape.inclinaison);
      COURSE.multiply(ROTATION);
    }
    if (etape.echelleXZ !== 1 || etape.echelleY !== 1) {
      ECHELLE.makeScale(etape.echelleXZ, etape.echelleY, etape.echelleXZ);
      COURSE.multiply(ECHELLE);
    }
    if (etape.dy !== 0) {
      ELEVATION.makeTranslation(0, etape.dy, 0);
      COURSE.premultiply(ELEVATION);
    }
    this.mesh.setMatrixAt(i, COURSE);

    if (this.options.colore) {
      this.teinte.set(this.couleurs[i] ?? '#ffffff');
      if (etape.eclat !== 1) this.teinte.multiplyScalar(etape.eclat);
      this.mesh.setColorAt(i, this.teinte);
    }

    return !etape.fini;
  }

  /**
   * Fait avancer les instances encore en mouvement.
   *
   * Renvoie `true` tant qu'il reste quelque chose à animer, pour que la scène
   * sache quand cesser de réécrire ses tampons.
   */
  animer(temps: number): boolean {
    if (!this.options.animation) return false;

    let enCours = false;
    for (let i = 0; i < this.curseur; i++) {
      if (this.appliquer(i, temps)) enCours = true;
    }

    if (enCours) {
      this.mesh.instanceMatrix.needsUpdate = true;
      if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    }
    return enCours;
  }

  /**
   * Fait rejouer l'animation d'une instance déjà posée.
   *
   * Une couche anime ce qui vient d'apparaître ; il faut aussi pouvoir animer
   * ce qui est là depuis longtemps. Un jeton ne bouge pas quand l'hexagone
   * produit : il est au même endroit avant et après, et seule une relance
   * explicite peut le faire sauter.
   *
   * Sans effet sur une clé absente : la scène demande le sursaut d'un
   * hexagone, elle n'a pas à savoir si ce dernier porte un jeton.
   */
  raviver(cle: string, maintenant: number): void {
    if (!this.naissances.has(cle)) return;
    this.naissances.set(cle, maintenant);
  }

  /** Ce que représente l'instance touchée par un rayon. */
  cleDe(instance: number | undefined): string | undefined {
    return instance === undefined ? undefined : this.cles[instance];
  }

  /** Ce qui vient d'apparaître au cours de la dernière passe. */
  posesRecentes(): string[] {
    return this.cles.filter((cle) => !this.precedentes.has(cle));
  }

  get vide(): boolean { return this.curseur === 0; }

  detruire(): void {
    this.parent.remove(this.mesh);
    this.mesh.dispose();
  }
}
