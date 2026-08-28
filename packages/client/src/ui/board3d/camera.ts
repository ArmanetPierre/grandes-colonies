/**
 * Le cadrage, et les gestes qui le changent.
 *
 * La caméra tourne autour d'un point posé sur la carte. Trois nombres la
 * décrivent entièrement : la distance à ce point, l'azimut — de quel côté on
 * regarde — et l'inclinaison. Les gestes ne déplacent jamais la caméra
 * directement, ils modifient ces trois nombres ; c'est ce qui permet de
 * borner chacun séparément et de garantir qu'aucun geste, si maladroit
 * soit-il, ne fasse passer le joueur sous le plateau ou derrière l'horizon.
 *
 * Le plateau se lit à plat. On autorise donc l'inclinaison à varier, mais
 * jamais au point de raser la carte : au-delà, les tuiles du fond se
 * chevauchent et les jetons deviennent illisibles — le rendu serait plus
 * spectaculaire et le jeu injouable.
 */

import { type PerspectiveCamera, Vector3 } from 'three';

import type { Point3 } from './geometrie.js';

/** Inclinaison, mesurée depuis la verticale. Zéro : à la verticale du plateau. */
const POLAIRE_MIN = 0.05;
const POLAIRE_MAX = 1.22;
/** L'inclinaison de lecture : assez pour voir le relief, assez peu pour lire. */
const POLAIRE_DEFAUT = 0.72;

export class Cadrage {
  private readonly cible = new Vector3();
  private azimut = 0;
  private polaire = POLAIRE_DEFAUT;
  private distance = 20;

  private distanceMin = 3;
  private distanceMax = 120;
  private repos = { x: 0, z: 0, distance: 20 };

  /**
   * Cadre pour que tous ces points restent visibles.
   *
   * On ne calcule pas la distance, on la cherche : la caméra est placée, les
   * points sont projetés à l'écran, et la distance est corrigée du
   * dépassement mesuré. Trois tours suffisent à converger.
   *
   * Une formule fermée aurait semblé plus propre et se serait trompée deux
   * fois. D'abord parce que, vue de biais, une carte ne se projette pas comme
   * un rectangle : son bord proche occupe bien plus de place que le bord
   * lointain, et aucun facteur en cosinus ne rend compte de cette asymétrie.
   * Ensuite parce qu'un plateau n'est pas un rectangle : le cadrer sur son
   * rectangle englobant réserve de la place pour quatre coins vides et
   * rapetisse tout le reste d'autant.
   *
   * D'où la liste de points plutôt que des bornes. L'appelant y met ce qui
   * doit tenir à l'écran — les tuiles, mais aussi les panneaux de port qui
   * flottent au large et qu'une emprise calculée sur les seuls hexagones
   * laissait dépasser du cadre.
   */
  cadrer(
    points: readonly Point3[],
    centre: Point3,
    rayon: number,
    camera: PerspectiveCamera,
    marge = 1.03,
  ): void {
    this.cible.set(centre.x, 0, centre.z);
    this.distance = Math.max(rayon * 2, 6);
    /*
     * Les deux bouts de la course de zoom.
     *
     * Ils étaient calculés larges — un dix-huitième du rayon d'un côté, huit
     * fois de l'autre — et les deux extrémités étaient inexploitables. Le
     * champ de la caméra est de 42°, donc la hauteur visible vaut environ
     * 0,77 fois la distance : sur un plateau à douze joueurs, dont le rayon
     * mesure une vingtaine d'unités, la butée avant tombait à 3,7 et ne
     * laissait qu'un hexagone et demi à l'écran — on ne savait plus où l'on
     * était. La butée arrière montait à 164, où le plateau ne couvrait plus
     * qu'un tiers de la hauteur et flottait, minuscule, au milieu de la mer.
     *
     * On resserre donc des deux côtés, autour du cadrage d'ensemble qui vaut
     * à peu près deux fois le rayon : quatre fois plus près au plus près,
     * une fois et demie plus loin au plus loin. Le joueur peut toujours
     * examiner un carrefour et toujours prendre du recul, mais aucun des
     * deux gestes ne le perd.
     */
    this.distanceMin = Math.max(6, rayon * 0.5);
    this.distanceMax = Math.max(rayon * 3, 26);

    const projete = new Vector3();
    for (let tour = 0; tour < 4; tour++) {
      this.appliquer(camera);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();

      // Le plus grand écart au centre, en coordonnées d'écran normalisées :
      // 1 signifie « touche le bord ».
      let debord = 0;
      for (const point of points) {
        projete.set(point.x, 0, point.z).project(camera);
        debord = Math.max(debord, Math.abs(projete.x), Math.abs(projete.y));
      }
      if (debord <= 0.0001) break;
      this.distance = Math.min(
        this.distanceMax,
        Math.max(this.distanceMin, this.distance * debord * marge),
      );
    }

    this.repos = { x: centre.x, z: centre.z, distance: this.distance };
  }

  /** Revient au cadrage d'origine, sans toucher à ce que le joueur regarde. */
  recentrer(): void {
    this.cible.set(this.repos.x, 0, this.repos.z);
    this.distance = this.repos.distance;
    this.azimut = 0;
    this.polaire = POLAIRE_DEFAUT;
  }

  /** Le joueur a-t-il bougé la caméra ? Décide de l'offre de recentrage. */
  get deplace(): boolean {
    return this.azimut !== 0
      || this.polaire !== POLAIRE_DEFAUT
      || Math.abs(this.distance - this.repos.distance) > 0.01
      || Math.abs(this.cible.x - this.repos.x) > 0.01
      || Math.abs(this.cible.z - this.repos.z) > 0.01;
  }

  /**
   * Fait glisser la carte sous le doigt.
   *
   * Le point visé reste sous le doigt : c'est la seule façon de déplacer une
   * carte qui ne demande pas d'apprentissage. Le déplacement vertical est
   * corrigé de l'inclinaison — vu de biais, un pixel d'écran couvre d'autant
   * plus de terrain que la caméra est basse.
   */
  deplacer(dx: number, dy: number, hauteurPixels: number, camera: PerspectiveCamera): void {
    const fov = (camera.fov * Math.PI) / 180;
    const parPixel = (2 * this.distance * Math.tan(fov / 2)) / Math.max(1, hauteurPixels);
    const droite = { x: Math.cos(this.azimut), z: -Math.sin(this.azimut) };
    const avant = { x: -Math.sin(this.azimut), z: -Math.cos(this.azimut) };
    const raccourci = Math.max(0.3, Math.cos(this.polaire));

    this.cible.x -= droite.x * dx * parPixel;
    this.cible.z -= droite.z * dx * parPixel;
    this.cible.x += (avant.x * dy * parPixel) / raccourci;
    this.cible.z += (avant.z * dy * parPixel) / raccourci;
  }

  zoomer(facteur: number): void {
    this.distance = Math.min(this.distanceMax, Math.max(this.distanceMin, this.distance / facteur));
  }

  tourner(dAzimut: number, dPolaire: number): void {
    this.azimut += dAzimut;
    this.polaire = Math.min(POLAIRE_MAX, Math.max(POLAIRE_MIN, this.polaire + dPolaire));
  }

  /** Reporte les trois nombres sur la caméra. */
  appliquer(camera: PerspectiveCamera): void {
    const sin = Math.sin(this.polaire);
    camera.position.set(
      this.cible.x + this.distance * sin * Math.sin(this.azimut),
      this.cible.y + this.distance * Math.cos(this.polaire),
      this.cible.z + this.distance * sin * Math.cos(this.azimut),
    );
    camera.lookAt(this.cible);
  }

  /** La distance courante — l'échelle à laquelle dimensionner ce qui doit rester lisible. */
  get eloignement(): number { return this.distance; }
}
