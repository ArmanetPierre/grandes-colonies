/**
 * Les deux dés, sur la carte.
 *
 * Le lancer était une ligne de texte au coin de l'écran, puis deux petits
 * carrés dans le bandeau. À douze joueurs, c'est pourtant le seul instant où
 * la table entière regarde la même chose : il se joue donc là où tout le
 * monde a déjà les yeux, sur le plateau, à la taille d'un jeton.
 *
 * Deux maillages ordinaires, et non une couche instanciée : il n'y en a que
 * deux, ils portent chacun six matériaux différents — un par face — et ils
 * ne se posent pas sur un emplacement du plateau. Rien de ce que `Couche`
 * apporte ne leur servirait.
 *
 * Ce module ne calcule pas le mouvement : il le commande et le rejoue. La
 * chute est simulée d'un coup par `physique.ts` au moment du lâcher, puis
 * lue image par image — de sorte que la boucle d'affichage n'a plus qu'à
 * interpoler, et qu'une image perdue ne dérègle rien.
 */

import {
  type Camera, Euler, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D,
  PlaneGeometry, Quaternion, type Texture, Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

import { PAS_IMAGE, type Trajectoire, simuler } from './physique.js';
import {
  DUREE_TOTALE, NORMALES, ORDRE_FACES,
  annonce, mouvementReduit, opacite, tirages,
} from './roulement.js';
import { textureFaceDe, textureTotal } from './textures.js';

/**
 * Le côté d'un dé, en unités de scène. Publié : les tests s'en servent pour
 * dire à quelle hauteur un dé posé se tient.
 *
 * De l'ordre d'un jeton numéroté, qui est la plus petite chose que le
 * plateau demande déjà de lire au zoom d'ensemble. Plus petit, on ne compte
 * plus les points ; plus grand, deux dés couvrent une tuile entière.
 */
export const COTE = 0.8;

/**
 * L'écart entre les deux dés au lâcher.
 *
 * Ce n'est plus celui de leur arrêt — c'est la simulation qui en décide, et
 * elle les fait parfois se heurter. Deux dés lancés dans la même main
 * partent côte à côte, à un dé l'un de l'autre.
 */
const ECART = COTE * 1.5;

/** De combien ils partent en arrière, vers celui qui lance. */
const RECUL = 1.6;

/** De quelle hauteur ils sont lâchés. Cinq hexagones : ils entrent par le haut. */
const HAUTEUR = 5;

/**
 * La poussée initiale, vers le centre de la carte.
 *
 * Assez pour qu'ils couvrent le recul pendant leur chute, pas assez pour
 * qu'ils dépassent le point visé : un dé jeté trop fort sort du plateau, et
 * un plateau n'a pas de bords pour le retenir.
 */
const ELAN = 2.6;

/** La rotation au lâcher, en tours par seconde. */
const VRILLE_MIN = 1.6;
const VRILLE_MAX = 3.2;

/**
 * Le total : sa taille, et sa hauteur au-dessus de la table.
 *
 * Deux hexagones de large. C'est beaucoup, et c'est le but — le lancer est ce
 * que toute la table lit en même temps, depuis l'autre bout de la pièce et
 * parfois depuis un téléphone. Il se tient assez haut pour ne pas recouvrir
 * les dés qui viennent de le produire : on doit pouvoir vérifier l'addition.
 */
const TAILLE_TOTAL = 2.2;
const HAUTEUR_TOTAL = 1.7;

const HAUT = new Vector3(0, 1, 0);

export class Des {
  private readonly des: readonly [Mesh, Mesh];
  private readonly materiaux: readonly MeshStandardMaterial[];
  private readonly geometrie: RoundedBoxGeometry;

  /** Le total annoncé : un panneau sans cadre, toujours face au joueur. */
  private readonly total: Mesh;
  private readonly matTotal: MeshBasicMaterial;
  private readonly geoTotal: PlaneGeometry;
  /**
   * Les onze totaux possibles, dessinés à la demande.
   *
   * Une partie n'en voit jamais que quelques-uns dans ses premières minutes,
   * et rien n'oblige à peindre le douze avant qu'il sorte.
   */
  private readonly totaux = new Map<number, Texture | undefined>();
  private readonly ancre = new Vector3();

  /** Les deux chutes calculées, telles qu'elles seront rejouées. */
  private trajectoires: readonly Trajectoire[] = [];
  /** L'instant où le dernier dé s'arrête : c'est là que le total se déclare. */
  private repos = 0;

  /** L'instant du lâcher, sur l'horloge de la scène. Négatif : aucun lancer. */
  private lance = -1;

  constructor(private readonly parent: Object3D) {
    /*
     * Les six faces, dans l'ordre où la boîte attend ses matériaux.
     *
     * Les deux dés les partagent : ce sont les mêmes images, et six textures
     * de plus pour un second dé n'apporteraient rien qu'un dessin identique.
     * L'effacement s'applique donc aux deux à la fois, ce qui est justement
     * ce qu'on veut — ils s'en vont ensemble.
     */
    this.materiaux = ORDRE_FACES.map((valeur) => {
      const texture = textureFaceDe(valeur);
      return new MeshStandardMaterial({
        ...(texture ? { map: texture } : {}),
        color: 0xffffff,
        roughness: 0.42,
        metalness: 0.03,
        // L'os n'est pas transparent : il ne l'est qu'au moment de s'effacer.
        transparent: true,
        opacity: 1,
      });
    });

    /*
     * Un cube aux arêtes cassées.
     *
     * Un dé à arêtes vives se lit comme une boîte, et une boîte ne roule pas.
     * Le congé attrape la lumière rasante du plateau tout au long du
     * roulement : c'est lui, plus que le mouvement, qui donne la matière.
     */
    this.geometrie = new RoundedBoxGeometry(COTE, COTE, COTE, 3, COTE * 0.14);
    this.des = [this.fabriquer(this.geometrie), this.fabriquer(this.geometrie)];

    /*
     * Le total ne reçoit pas la lumière.
     *
     * C'est le seul élément de la scène qui ne représente aucun objet : ni
     * pièce, ni terrain, ni jeton. Un chiffre éclairé de biais s'assombrit du
     * côté de l'ombre et devient illisible au moment précis où toute la table
     * le cherche — comme l'anneau des emplacements proposés, il n'appartient
     * pas au monde et n'en subit pas l'éclairage.
     */
    this.geoTotal = new PlaneGeometry(TAILLE_TOTAL, TAILLE_TOTAL);
    this.matTotal = new MeshBasicMaterial({
      transparent: true, opacity: 0, depthWrite: false, toneMapped: false,
    });
    this.total = new Mesh(this.geoTotal, this.matTotal);
    this.total.visible = false;
    this.total.renderOrder = 7;
    this.parent.add(this.total);
  }

  /** La texture d'un total, peinte au premier lancer qui le sort. */
  private textureDu(valeur: number): Texture | undefined {
    if (!this.totaux.has(valeur)) this.totaux.set(valeur, textureTotal(valeur));
    return this.totaux.get(valeur);
  }

  private fabriquer(geometrie: RoundedBoxGeometry): Mesh {
    const mesh = new Mesh(geometrie, [...this.materiaux]);
    mesh.castShadow = true;
    mesh.visible = false;
    // Ils passent au-dessus de la mer et des anneaux d'emplacement, qui sont
    // transparents : sans cet ordre, un dé posé sur l'eau disparaît dedans.
    mesh.renderOrder = 6;
    this.parent.add(mesh);
    return mesh;
  }

  /**
   * Lance les dés sur `ancre`, vus depuis `versCamera`.
   *
   * Le point de chute et la direction viennent de la scène, qui seule sait où
   * regarde le joueur : les dés arrivent du bord de l'écran le plus proche
   * de lui et roulent vers la carte, comme s'il venait de les jeter — geste
   * que personne n'a fait, mais que tout le monde reconnaît.
   *
   * `a` et `b` viennent du moteur et ne sont jamais tirés ici. La graine ne
   * décide que de l'allure du roulement, jamais de son résultat.
   */
  lancer(
    a: number, b: number, graine: number,
    ancre: Vector3, versCamera: Vector3, temps: number,
  ): void {
    this.matTotal.map = this.textureDu(a + b) ?? null;
    this.matTotal.needsUpdate = true;

    /*
     * Le lâcher : deux dés jetés vers le centre, de la main du joueur.
     *
     * Tout ce qui varie d'un lancer à l'autre sort de la graine, et rien du
     * hasard local — deux navigateurs qui tireraient chacun le leur
     * montreraient deux lancers différents pour le même résultat, ce qui est
     * précisément ce qu'on veut éviter à douze autour d'une table.
     */
    const tirage = tirages(graine);
    const droite = new Vector3().crossVectors(HAUT, versCamera).normalize();
    const lachers = [0, 1].map((i) => {
      const cote = i === 0 ? -0.5 : 0.5;
      const ecart = (tirage() - 0.5) * COTE * 0.5;
      const depart = new Vector3()
        .copy(ancre)
        .addScaledVector(droite, ECART * cote + ecart)
        .addScaledVector(versCamera, RECUL + tirage() * 0.5)
        .setY(ancre.y + HAUTEUR + tirage() * 0.4);

      // La poussée vise le point de chute : ils arrivent en cloche, pas à la
      // verticale, ce qui est la différence entre un dé jeté et un dé lâché.
      const vers = new Vector3().subVectors(ancre, depart).setY(0).normalize();
      const vitesse = vers.multiplyScalar(ELAN * (0.85 + tirage() * 0.3));
      vitesse.y = -tirage() * 0.8;

      // Une rotation quelconque, mais franche : un dé qui tombe sans tourner
      // n'est pas un lancer, c'est une pièce qu'on pose.
      const tours = VRILLE_MIN + tirage() * (VRILLE_MAX - VRILLE_MIN);
      const rotation = new Vector3(tirage() - 0.5, tirage() - 0.5, tirage() - 0.5)
        .normalize()
        .multiplyScalar(tours * Math.PI * 2);

      return {
        p: depart,
        v: vitesse,
        // L'orientation de départ est quelconque elle aussi : c'est celle de
        // la main, et elle ne dit rien du résultat.
        q: new Quaternion().setFromEuler(
          new Euler(tirage() * Math.PI * 2, tirage() * Math.PI * 2, tirage() * Math.PI * 2),
        ),
        w: rotation,
      };
    });

    const chutes = simuler(lachers, ancre.y, COTE);

    /*
     * La repeinture.
     *
     * La simulation a donné une face ; le moteur en voulait une autre. On
     * fait donc tourner le dé dans son propre repère — c'est-à-dire ses
     * points, et non son mouvement — de la rotation qui amène le nombre voulu
     * là où la chute a laissé sa face du dessus. Comme cette rotation est une
     * symétrie du cube, la trajectoire reste exactement celle qui a été
     * calculée : mêmes chocs, mêmes rebonds, même arrêt. Le dé n'a pas été
     * dévié d'un millimètre ; il a été repeint.
     */
    const valeurs = [a, b];
    this.trajectoires = chutes.map((chute, i) => {
      const voulue = NORMALES[valeurs[i] as number] ?? [0, 1, 0];
      const symetrie = new Quaternion().setFromUnitVectors(
        new Vector3(voulue[0], voulue[1], voulue[2]),
        chute.axeHaut,
      );
      return {
        ...chute,
        images: chute.images.map(({ p, q }) => ({ p, q: q.clone().multiply(symetrie) })),
      };
    });

    this.repos = Math.max(...chutes.map((c) => c.repos));
    // Le total se pose au-dessus des dés arrêtés, pas au-dessus du point
    // visé : la chute décide de l'endroit, et le nombre suit.
    const derniere = (t: Trajectoire): Vector3 => (t.images[t.images.length - 1] as { p: Vector3 }).p;
    this.ancre
      .addVectors(derniere(this.trajectoires[0] as Trajectoire), derniere(this.trajectoires[1] as Trajectoire))
      .multiplyScalar(0.5);

    /*
     * Sous `prefers-reduced-motion`, on recule le lâcher.
     *
     * Les dés apparaissent alors déjà posés sur leur résultat, et s'effacent
     * après le même temps de lecture. Le mouvement qu'on n'a pas demandé
     * disparaît sans que l'information disparaisse avec lui.
     */
    this.lance = mouvementReduit() ? temps - this.repos : temps;
    this.animer(temps);
  }

  /** L'instant où le dernier lancer aura fini de s'effacer. */
  get finDuJet(): number {
    return this.lance < 0 ? 0 : this.lance + DUREE_TOTALE;
  }

  animer(temps: number, camera?: Camera): void {
    if (this.lance < 0) return;

    const age = temps - this.lance;
    if (age >= DUREE_TOTALE) {
      // Le lancer est fini : on éteint, et la boucle n'y revient plus.
      this.lance = -1;
      for (const de of this.des) de.visible = false;
      this.total.visible = false;
      return;
    }

    const voile = opacite(age);
    for (const materiau of this.materiaux) materiau.opacity = voile;

    for (let i = 0; i < 2; i++) {
      const de = this.des[i] as Mesh;
      const chute = this.trajectoires[i];
      de.visible = chute !== undefined && voile > 0;
      if (!de.visible || !chute) continue;

      /*
       * L'image de l'instant, interpolée entre deux pas de calcul.
       *
       * La simulation avance à cent vingt pas par seconde et l'écran en
       * demande soixante, cent vingt ou cent quarante-quatre selon la
       * machine : sans interpolation, un même pas serait montré deux fois de
       * suite sur un écran rapide, et le roulement saccaderait au moment où
       * on le regarde le plus.
       */
      const t = Math.max(0, age) / PAS_IMAGE;
      const k = Math.min(chute.images.length - 1, Math.floor(t));
      const suivant = Math.min(chute.images.length - 1, k + 1);
      const fraction = Math.min(1, t - k);
      const ici = chute.images[k] as { p: Vector3; q: Quaternion };
      const la = chute.images[suivant] as { p: Vector3; q: Quaternion };

      de.position.lerpVectors(ici.p, la.p, fraction);
      de.quaternion.copy(ici.q).slerp(la.q, fraction);
      // Une ombre pleine sous un dé qui s'efface le ferait réapparaître en
      // creux : elle s'en va avant lui.
      de.castShadow = voile > 0.6;
    }

    /*
     * Le total, tourné vers celui qui regarde.
     *
     * Douze joueurs autour d'une table virtuelle n'ont pas le même point de
     * vue : un panneau posé à plat serait lu de travers par la moitié d'entre
     * eux, et un panneau dressé dans un sens fixe le serait par tous. Il
     * prend donc l'orientation de la caméra, celle de l'écran où il s'affiche.
     */
    const etape = annonce(age, this.repos);
    this.total.visible = etape.eclat > 0 && voile > 0;
    if (this.total.visible) {
      if (camera) this.total.quaternion.copy(camera.quaternion);
      this.total.position.copy(this.ancre).setY(this.ancre.y + HAUTEUR_TOTAL + etape.dy);
      this.total.scale.setScalar(etape.echelle);
      this.matTotal.opacity = etape.eclat * voile;
    }
  }

  detruire(): void {
    for (const de of this.des) {
      this.parent.remove(de);
    }
    this.parent.remove(this.total);

    this.geometrie.dispose();
    for (const materiau of this.materiaux) {
      materiau.map?.dispose();
      materiau.dispose();
    }
    this.geoTotal.dispose();
    this.matTotal.dispose();
    for (const texture of this.totaux.values()) texture?.dispose();
  }
}
