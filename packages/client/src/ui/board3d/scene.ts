/**
 * La scène du plateau.
 *
 * Tout ce qui est visible tient dans une poignée de couches instanciées, et
 * chaque mise à jour les réécrit entièrement. C'est délibéré : réconcilier
 * l'ancien état et le nouveau — deviner qu'une route a été posée ici et une
 * annonce retirée là — coûterait plus de code qu'il n'en faut pour tout
 * reposer, et se tromperait un jour. Reposer deux cents matrices prend une
 * fraction de milliseconde, et n'arrive qu'à l'arrivée d'un événement, pas à
 * chaque image.
 *
 * Ce que la boucle d'affichage fait, elle, à chaque image : avancer la
 * houle, faire respirer les emplacements proposés, et dessiner.
 */

import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, type BufferGeometry, CircleGeometry, Color,
  CylinderGeometry, DirectionalLight, DoubleSide, Fog, Group, HemisphereLight,
  type Material, Matrix4, MeshBasicMaterial, MeshStandardMaterial, PCFSoftShadowMap,
  PerspectiveCamera, PlaneGeometry, Quaternion, Raycaster, Scene, SRGBColorSpace,
  Vector2, Vector3, WebGLRenderer,
} from 'three';

import type { PublicGameView } from '@grandes-colonies/protocol';

import { Cadrage } from './camera.js';
import { CASCADE, DUREE_CHUTE, DUREE_RECOLTE, chute, poussiere, recolte } from './chute.js';
import { Couche } from './couche.js';
import { Des } from './des.js';
import { azimutDepuisTorsion, ecartAngulaire, estGlissement, TORSION_MORTE } from './gestes.js';
import {
  EPAISSEUR, MER, SOL, type Point3, barycentre, bornes, centreHex, hexDe, ilesDuLarge,
  rotationArete,
} from './geometrie.js';
import {
  geoAnneau, geoAnneauAnnonce, geoCible, geoCibleArete, geoColonie, geoEcume,
  geoFaceJeton, geoFantomeRoute, geoJeton, geoMetropole, geoMonument, geoPoussiere,
  geoRoute, geoRouteMaritime, geoVille, geoVoleur,
} from './pieces.js';
import { creerCiel, type Ciel } from './ciel.js';
import { baseDe, geoRelief, hauteurRelative, orientationDe, sommetDe } from './relief.js';
import { CRETE, creerMer, type Mer } from './mer.js';
import { graineDepuis } from './roulement.js';
import { textureEcume, textureGel, textureJeton, texturePort, textureTerrain } from './textures.js';

/** Les douze identités : mêmes couleurs que le plateau plat, à la lettre. */
export const COULEURS_JOUEURS = [
  '#A63A17', '#2D6E8E', '#5F7038', '#B8862B', '#7B3457', '#2E8B7A',
  '#3B4F91', '#C4692A', '#6B3F8F', '#2F7A4A', '#7A4A2E', '#3A3A3A',
] as const;

export function couleurDe(joueur: string, ordre: readonly string[]): string {
  const index = ordre.indexOf(joueur);
  return COULEURS_JOUEURS[(index < 0 ? 0 : index) % COULEURS_JOUEURS.length] as string;
}

/** La teinte du large : celle de la mer, pour que la brume s'y fonde. */
const TEINTE_MER = 0x14384f;

/**
 * Le plus haut que l'eau puisse monter.
 *
 * Tout ce qui doit rester visible sur la mer se pose au-dessus de cette
 * ligne, et non à quelques centièmes du niveau moyen. Les panneaux de port
 * étaient posés à une hauteur devinée : les crêtes passaient par-dessus, et
 * un port apparaissait puis disparaissait au rythme de la houle sans que
 * rien, dans le code, ne relie les deux réglages.
 */
const SURFACE = MER + CRETE;

export interface EtatPlateau {
  readonly view: PublicGameView;
  readonly highlightVertices: readonly string[];
  readonly highlightEdges: readonly string[];
  readonly robberTargets: readonly string[];
}

export interface RappelsPlateau {
  onVertexClick?: ((vertex: string) => void) | undefined;
  onEdgeClick?: ((edge: string) => void) | undefined;
  onHexClick?: ((hex: string) => void) | undefined;
  /** Prévient quand le joueur a bougé la caméra, pour offrir le recentrage. */
  onCadrage?: ((deplace: boolean) => void) | undefined;
}

/**
 * Le niveau de détail, décidé une fois au démarrage.
 *
 * On ne mesure pas la puissance de la machine, on lit son genre : un écran
 * tactile ou quatre cœurs annoncent un téléphone, et un téléphone préfère
 * une image stable à une image parfaite. Le pas de la grille marine et la
 * définition de la carte d'ombres sont les deux seuls réglages qui pèsent
 * vraiment, et ce sont eux qu'on baisse.
 */
function detailReduit(): boolean {
  const tactile = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const petitProcesseur = (navigator.hardwareConcurrency ?? 8) <= 4;
  return tactile || petitProcesseur;
}

export class ScenePlateau {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(42, 1, 0.5, 600);
  private readonly cadrage = new Cadrage();
  private readonly leger = detailReduit();

  private readonly mer: Mer;
  private readonly ciel: Ciel | undefined;
  /** Les deux dés, qui ne se posent nulle part sur la maille. */
  private des!: Des;
  private readonly groupeStatique = new Group();

  /** Les couches réécrites à chaque mise à jour. */
  private readonly dessus = new Map<string, Couche>();
  private readonly faces = new Map<number, Couche>();
  private readonly panneaux = new Map<string, Couche>();
  private prismes!: Couche;
  private ecume!: Couche;
  private jetons!: Couche;
  private voleur!: Couche;
  private routes!: Couche;
  private routesMer!: Couche;
  private readonly batiments = new Map<string, Couche>();
  private poussieres!: Couche;
  private annonces!: Couche;
  private gels!: Couche;
  private anneaux!: Couche;
  private fantomes!: Couche;
  private cibleSommets!: Couche;
  private cibleAretes!: Couche;
  private cibleHexes!: Couche;

  /** Les matériaux vivent aussi longtemps que la scène : on les garde. */
  /*
   * Le matériau des emplacements proposés.
   *
   * `toneMapped: false` est ce qui compte ici. La scène passe par un
   * rendu tonal cinématographique, qui comprime les hautes lumières pour que
   * le soleil sur l'eau ne brûle pas — et qui délavait du même coup la seule
   * couleur de la scène qui ne représente rien de physique. L'anneau ressort
   * de la carte parce qu'il n'appartient pas au monde : il ne doit pas en
   * subir l'éclairage.
   */
  private readonly matPulsant = new MeshBasicMaterial({
    color: 0xffd24a, transparent: true, opacity: 0.9, depthWrite: false,
    side: DoubleSide, toneMapped: false,
  });
  private readonly aJeter: { dispose(): void }[] = [];

  private cadreObserve?: ResizeObserver;
  private image = 0;
  private debut = performance.now();
  /**
   * L'instant de la passe en cours.
   *
   * Figé le temps d'une mise à jour : sinon deux couches remplies à quelques
   * dixièmes de milliseconde d'écart donneraient à leurs pièces des dates de
   * naissance différentes, et une route poserait son ombre avant la colonie
   * qu'elle touche.
   */
  private poseA = 0;
  /** La première mise à jour ne fait rien tomber : ces pièces étaient déjà là. */
  private premiere = true;
  /** Jusqu'à quel instant il reste quelque chose à animer. */
  private animerJusqua = 0;
  private cadrageSignale = false;
  private detruit = false;

  private etat: EtatPlateau | undefined;
  private ordre: readonly string[] = [];
  /**
   * L'altitude du bord de chaque terre.
   *
   * Consultée par tout ce qui se pose sur la carte. Un sommet est partagé par
   * trois tuiles qui peuvent être à des hauteurs différentes : on retient la
   * plus haute, faute de quoi une colonie bâtie au pied d'une montagne
   * s'enfoncerait dedans.
   */
  private readonly altitudes = new Map<string, number>();
  /** Le point culminant de chaque terre : jeton, voleur, départ des vols. */
  private readonly sommets = new Map<string, number>();
  /**
   * Le terrain de chaque terre.
   *
   * Deux nombres ne suffisent pas aux dés : ils tombent n'importe où sur la
   * carte, pas au centre d'une tuile, et il faut le profil du terrain pour
   * savoir à quelle hauteur ils s'arrêtent — au flanc d'une montagne, ce
   * n'est ni la base ni le sommet.
   */
  private readonly terrains = new Map<string, string>();

  private readonly rayon = new Raycaster();
  private readonly pointeur = new Vector2();

  constructor(
    private readonly hote: HTMLElement,
    private readonly rappels: RappelsPlateau,
  ) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, this.leger ? 1.6 : 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    this.renderer.setClearColor(TEINTE_MER, 1);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';
    hote.appendChild(this.renderer.domElement);

    /*
     * Le ciel avant tout le reste.
     *
     * Les matériaux le réfléchissent : l'assigner après leur création
     * marcherait aussi — Three.js recompile — mais la première image
     * partirait sans lui, et c'est celle qu'on voit au chargement.
     */
    this.ciel = creerCiel(this.renderer);
    this.scene.background = this.ciel ? this.ciel.fond : new Color(TEINTE_MER);
    if (this.ciel) {
      this.scene.environment = this.ciel.environnement;
      this.scene.environmentIntensity = 1.0;
    }
    this.scene.add(this.groupeStatique);

    this.mer = creerMer(760, this.leger ? 96 : 168);
    this.mer.mesh.position.y = MER;
    this.scene.add(this.mer.mesh);

    this.eclairer();
    this.creerCouches();
    this.des = new Des(this.scene);
    this.brancherGestes();

    this.cadreObserve = new ResizeObserver(() => this.redimensionner());
    this.cadreObserve.observe(hote);
    this.redimensionner();

    this.image = requestAnimationFrame(this.boucle);
  }

  // ── mise en place ────────────────────────────────────────────────────

  /**
   * L'éclairage : une lumière rasante et deux lueurs d'ambiance.
   *
   * Une seule source projette des ombres. C'est ce qui donne son relief au
   * plateau — sans ombre portée, les prismes de terre paraissent collés sur
   * la mer — et c'est aussi la passe la plus chère de la scène : il n'en
   * faut qu'une. Les deux autres lumières ne servent qu'à empêcher les
   * faces à l'ombre de tomber au noir.
   */
  private eclairer(): void {
    const soleil = new DirectionalLight(0xfff1d6, 2.1);
    soleil.position.set(-26, 40, 22);
    soleil.castShadow = true;
    soleil.shadow.mapSize.set(this.leger ? 1024 : 2048, this.leger ? 1024 : 2048);
    soleil.shadow.bias = -0.0012;
    soleil.shadow.normalBias = 0.02;
    this.scene.add(soleil);
    this.scene.add(soleil.target);
    this.soleil = soleil;

    // Le ciel au-dessus, le sable en dessous : un dégradé plutôt qu'un
    // ambiant plat, pour que les toits restent plus clairs que les murs.
    this.scene.add(new HemisphereLight(0xcfe4f2, 0x3b3226, 0.85));
    this.scene.add(new AmbientLight(0xffffff, 0.18));
  }

  private soleil!: DirectionalLight;

  /**
   * Crée une couche et retient de quoi la démonter.
   *
   * Géométries et matériaux détiennent de la mémoire graphique que le
   * ramasse-miettes ne voit pas : sans `dispose`, quitter une partie pour en
   * relancer une autre laisse la précédente entière sur la carte.
   */
  private couche(
    geo: BufferGeometry,
    mat: Material,
    options: ConstructorParameters<typeof Couche>[3] = {},
    partage = false,
  ): Couche {
    const c = new Couche(this.scene, geo, mat, options);
    this.aJeter.push(geo);
    if (!partage) this.aJeter.push(mat);
    return c;
  }

  /**
   * Les couches, créées une fois pour toutes.
   *
   * Leur ordre de création est sans importance ; leur ordre de rendu, lui,
   * compte pour les éléments transparents posés à plat les uns sur les
   * autres — écume, anneaux, croix — qui se masqueraient mutuellement selon
   * l'humeur du tampon de profondeur.
   */
  private creerCouches(): void {
    const roche = new MeshStandardMaterial({ color: 0x8d7355, roughness: 0.95, metalness: 0.02 });
    this.prismes = this.couche(
      // Le prisme est très légèrement plus étroit que la maille : un liseré
      // d'eau court alors entre deux terres voisines, et la carte se lit
      // comme un archipel plutôt que comme un bloc.
      cylindreHex(0.985, EPAISSEUR),
      roche,
      { colore: true, ombrePortee: true, ombreRecue: true },
    );

    const ecume = textureEcume();
    this.ecume = this.couche(
      geoEcume(),
      new MeshBasicMaterial({
        ...(ecume ? { map: ecume } : {}),
        // Discrète : à pleine opacité, l'anneau se lisait comme un banc de
        // brume posé sur l'eau, et deux terres voisines noyaient la mer qui
        // les sépare. L'écume doit se deviner, pas se regarder.
        transparent: true, depthWrite: false, opacity: 0.32,
      }),
      { ordreRendu: 1 },
    );

    this.jetons = this.couche(
      geoJeton(),
      new MeshStandardMaterial({ color: 0xe9dfc8, roughness: 0.8 }),
      { ombrePortee: true, animation: recolte },
    );

    // Le voleur tombe aussi : c'est le seul pion qui se déplace, et le voir
    // atterrir dit d'un coup où il vient d'arriver.
    this.voleur = this.couche(
      geoVoleur(),
      new MeshStandardMaterial({ color: 0x1c1a1c, roughness: 0.55, metalness: 0.1 }),
      { ombrePortee: true, animation: chute },
    );

    /*
     * Tout ce qu'un joueur pose tombe du ciel.
     *
     * `cascade` égrène les poses simultanées : à la mise en place, vingt-quatre
     * pièces arrivent dans le même message, et vingt-quatre chutes rigoureusement
     * synchrones se lisent comme un seul objet qui tombe.
     */
    const chuteur = { colore: true, ombrePortee: true, animation: chute, cascade: CASCADE };

    const bois = new MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.04 });
    this.routes = this.couche(geoRoute(), bois, chuteur);
    this.routesMer = this.couche(
      geoRouteMaritime(),
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.75 }),
      chuteur,
    );

    const pierre = (): MeshStandardMaterial =>
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.06 });
    this.batiments.set('settlement', this.couche(geoColonie(), pierre(), chuteur));
    this.batiments.set('city', this.couche(geoVille(), pierre(), chuteur));
    this.batiments.set('metropolis', this.couche(geoMetropole(), pierre(), chuteur));
    this.batiments.set('monument', this.couche(geoMonument(), pierre(), chuteur));

    this.annonces = this.couche(
      geoAnneauAnnonce(),
      new MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, emissive: 0x222222 }),
      { colore: true, ordreRendu: 3 },
    );

    const gel = textureGel();
    this.gels = this.couche(
      plaquePlate(0.34),
      new MeshBasicMaterial({
        ...(gel ? { map: gel } : {}),
        transparent: true, depthWrite: false,
      }),
      { ordreRendu: 4 },
    );

    /*
     * La poussière d'impact.
     *
     * Le mélange additif est ce qui permet de la faire disparaître : une
     * couleur d'instance qui tend vers le noir devient invisible sans rien
     * ajouter à l'image. C'est le seul moyen de donner une opacité propre à
     * chaque instance d'un même maillage — le tampon des couleurs existe,
     * celui des opacités n'existe pas — et donc de faire retomber vingt
     * poussières nées à vingt instants différents.
     */
    const halo = textureEcume();
    this.poussieres = this.couche(
      geoPoussiere(),
      new MeshBasicMaterial({
        ...(halo ? { map: halo } : {}),
        transparent: true, depthWrite: false, blending: AdditiveBlending, toneMapped: false,
      }),
      { colore: true, animation: poussiere, cascade: CASCADE, ordreRendu: 4 },
    );

    this.anneaux = this.couche(geoAnneau(), this.matPulsant, { ordreRendu: 5 }, true);
    this.fantomes = this.couche(geoFantomeRoute(), this.matPulsant, { ordreRendu: 5 }, true);

    // Les cibles ne sont jamais peintes : `colorWrite` coupé, elles laissent
    // passer l'image et n'existent que pour le lancer de rayon.
    const invisible = (): MeshBasicMaterial =>
      new MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    this.cibleSommets = this.couche(geoCible(), invisible(), { ordreRendu: 9 });
    this.cibleAretes = this.couche(geoCibleArete(), invisible(), { ordreRendu: 9 });
    this.cibleHexes = this.couche(cylindreHex(1, 0.4), invisible(), { ordreRendu: 9 });
  }

  // ── mise à jour depuis la vue ────────────────────────────────────────

  mettreAJour(etat: EtatPlateau): void {
    if (this.detruit) return;
    const premiere = this.etat === undefined;
    this.poseA = this.horloge();
    this.etat = etat;
    this.ordre = etat.view.players.map((p) => p.id);

    const idsHexes = etat.view.hexes.map((h) => h.id);
    if (premiere) {
      const emprise = bornes(idsHexes);
      this.poserLeLarge(new Set(idsHexes));
      this.scene.fog = new Fog(TEINTE_MER, emprise.rayon * 1.7, emprise.rayon * 5.2);
      this.cadrerTout(etat.view);
      this.reglerOmbres(emprise.centreX, emprise.centreZ, emprise.rayon);
    }

    this.poserTerres(etat);
    this.poserJetons(etat);
    this.poserRoutes(etat);
    this.poserBatiments(etat);
    this.poserPorts(etat);
    this.poserAnnonces(etat);
    this.poserPropositions(etat);
    this.poserPoussieres();

    // À partir d'ici, tout ce qui apparaît est réellement neuf et doit tomber.
    this.premiere = false;
  }

  /**
   * À quelle hauteur poser une pièce, depuis la clé de son emplacement.
   *
   * La clé nomme les hexagones qui se rejoignent là — un sommet en cite
   * trois, une arête deux — et il n'y a donc rien à chercher : la géométrie
   * du moteur porte déjà la réponse.
   */
  /** Le point culminant d'une tuile, ou le niveau commun si elle n'est pas terre. */
  private sommetHex(id: string): number {
    return this.sommets.get(id) ?? 0;
  }

  private hauteurSol(cle: string): number {
    let haut = SOL;
    for (const id of cle.split('|')) {
      const base = this.altitudes.get(id);
      if (base !== undefined) haut = Math.max(haut, SOL + base);
    }
    return haut;
  }

  /** Le temps de la scène, en secondes — la même horloge que la houle. */
  private horloge(): number {
    return (performance.now() - this.debut) / 1000;
  }

  /** Les couches dont les pièces tombent. */
  private couchesQuiTombent(): Couche[] {
    return [this.routes, this.routesMer, this.voleur, ...this.batiments.values()];
  }

  /** Tout ce qui peut bouger sans que la vue change. */
  private couchesAnimees(): Couche[] {
    return [...this.couchesQuiTombent(), this.poussieres, this.jetons, ...this.faces.values()];
  }

  /**
   * Fait sauter les jetons des hexagones qui viennent de produire.
   *
   * Déclenché par un événement et non par un état : la production est un
   * instant, pas une situation. Le dernier lancer reste inscrit dans la vue
   * pendant tout le tour, et s'y fier ferait rejouer le sursaut à chaque
   * redessin — au moindre échange, au moindre déplacement de caméra.
   */
  signalerProduction(hexes: readonly string[]): void {
    if (this.detruit) return;
    const maintenant = this.horloge();
    for (const hex of hexes) {
      this.jetons.raviver(hex, maintenant);
      for (const face of this.faces.values()) face.raviver(hex, maintenant);
    }
    this.animerJusqua = Math.max(this.animerJusqua, maintenant + DUREE_RECOLTE + 0.05);
  }

  /**
   * Lance les dés sur la carte.
   *
   * Déclenché par l'événement `DiceRolled` et non par la vue, pour la même
   * raison que le sursaut des jetons : `lastRoll` reste inscrit tout le tour,
   * et s'y fier relancerait les dés à chaque redessin.
   *
   * `a` et `b` sont ceux du moteur. La clé, elle, ne sert qu'à tirer l'allure
   * du roulement : composée de ce que tous les clients connaissent — le
   * cycle, le joueur actif, les deux dés — elle donne à toute la table
   * exactement le même lancer, ce qui est la moitié de l'intérêt de le
   * montrer sur le plateau.
   */
  lancerDes(a: number, b: number, cle: string): void {
    if (this.detruit) return;
    const { ancre, versCamera } = this.pointDeChute();
    this.des.lancer(a, b, graineDepuis(cle), ancre, versCamera, this.horloge());
  }

  /**
   * Où les dés tombent, et de quel côté ils arrivent.
   *
   * Au centre du plateau, comme sur une vraie table : c'est le seul endroit
   * que les douze joueurs désignent du même mot, et le lancer est le seul
   * moment de la partie qui appartient à tout le monde en même temps. Un
   * point calculé sur l'écran de chacun aurait fait tomber les dés à douze
   * endroits différents de la carte.
   *
   * La contrepartie est assumée : qui s'est approché d'un coin de l'archipel
   * ne les verra pas tomber. Il a le bouton « Recentrer » sous la main, et le
   * bandeau garde le résultat.
   *
   * La direction, elle, reste celle de chaque écran : les dés arrivent du
   * bord d'où l'on regarde et roulent vers la carte, ce qui se lit comme un
   * geste et non comme une chute verticale.
   */
  private pointDeChute(): { ancre: Vector3; versCamera: Vector3 } {
    const emprise = bornes(this.etat?.view.hexes.map((h) => h.id) ?? []);
    const cible = new Vector3(emprise.centreX, 0, emprise.centreZ);

    // La vraie hauteur du décor à cet endroit : sur une terre, les dés se
    // posent sur la tuile, pas au niveau de l'eau qui la borde.
    cible.y = this.hauteurAu(cible.x, cible.z);

    const versCamera = new Vector3(
      this.camera.position.x - cible.x, 0, this.camera.position.z - cible.z,
    );
    // Caméra à la verticale du point : n'importe quelle direction fait
    // l'affaire, mais il en faut une, sinon la normalisation donne un zéro.
    if (versCamera.lengthSq() < 1e-6) versCamera.set(0, 0, 1);

    return { ancre: cible, versCamera: versCamera.normalize() };
  }

  /**
   * L'altitude du décor en un point quelconque de la carte.
   *
   * Le relief est décrit par tuile et par distance au centre : c'est
   * exactement ce qu'il faut pour poser un objet qui ne tombe pas sur un
   * emplacement du plateau. Hors des terres, c'est la surface de la mer —
   * crête comprise, faute de quoi la houle passerait par-dessus les dés.
   */
  private hauteurAu(x: number, z: number): number {
    const terrain = this.terrains.get(hexDe({ x, z }));
    if (terrain === undefined) return SURFACE;
    const centre = centreHex(hexDe({ x, z }));
    const t = Math.hypot(x - centre.x, z - centre.z) / 0.955;
    return SOL + hauteurRelative(terrain, t);
  }

  /**
   * Où se trouve un hexagone à l'écran, en pixels de la fenêtre.
   *
   * C'est le pont entre la scène et le reste de l'interface : les ressources
   * gagnées partent d'un hexagone et rejoignent la barre du bas, qui n'a
   * jamais entendu parler de la caméra. On projette au niveau du jeton, pas
   * du sol, pour que le vol semble partir de ce qui vient de sauter.
   */
  projeterHex(hex: string): { x: number; y: number } | undefined {
    if (this.detruit) return undefined;
    const { x, z } = centreHex(hex);
    // On projette depuis le sommet de la tuile, là où le jeton vient de
    // sauter : c'est de ce point que le joueur regarde partir sa récolte.
    const point = new Vector3(x, SOL + this.sommetHex(hex) + 0.24, z).project(this.camera);
    if (point.z > 1) return undefined;

    const cadre = this.renderer.domElement.getBoundingClientRect();
    return {
      x: cadre.left + (point.x * 0.5 + 0.5) * cadre.width,
      y: cadre.top + (-point.y * 0.5 + 0.5) * cadre.height,
    };
  }

  /**
   * Une poussière sous chaque pièce qui vient d'arriver.
   *
   * La couche est remplie depuis les autres plutôt que depuis la vue : c'est
   * l'endroit du programme qui sait ce qui est neuf, et le savoir se trouve
   * déjà dans les couches — inutile de rejouer la comparaison ici, avec le
   * risque de la faire autrement.
   *
   * Elle partage les clés des pièces, donc leurs dates de naissance : la
   * poussière d'une route se lève exactement quand la route touche le sol,
   * sans qu'aucune horloge n'ait à être synchronisée à la main.
   */
  private poserPoussieres(): void {
    this.poussieres.reinitialiser(this.poseA, this.premiere);

    let nombre = 0;
    const m = new Matrix4();
    for (const couche of this.couchesQuiTombent()) {
      for (const cle of couche.posesRecentes()) {
        const { x, z } = barycentre(cle);
        this.poussieres.ajouter(cle, m.makeTranslation(x, this.hauteurSol(cle) + 0.02, z), '#ffe9c4');
        nombre++;
      }
    }
    this.poussieres.finir();

    /*
     * Jusqu'à quand il faudra animer.
     *
     * Sans cette borne, la boucle réécrirait deux cents matrices à chaque
     * image pour l'éternité. Avec elle, l'animation coûte ce qu'elle dure :
     * une seconde après la dernière pose, la scène redevient une scène
     * immobile qu'on se contente de dessiner.
     */
    if (!this.premiere && nombre > 0) {
      this.animerJusqua = this.poseA + DUREE_CHUTE + CASCADE * nombre + 0.1;
    }
  }

  /**
   * Tout ce qui doit rester dans le cadre.
   *
   * Les six sommets de chaque tuile, et les quatre coins de chaque panneau de
   * port. Donner au cadrage les centres seuls aurait coupé la moitié des
   * tuiles du bord ; lui donner un rectangle englobant aurait réservé de la
   * place pour quatre coins d'océan vide.
   */
  private pointsACadrer(view: PublicGameView): Point3[] {
    const points: Point3[] = [];
    const terres = this.terresDe(view);

    /*
     * On cadre sur les terres, pas sur la mer.
     *
     * Toutes les tuiles y passaient, bordure de mer comprise — et l'archipel
     * en pose une large tout autour. Le cadrage tenait donc cette bordure, et
     * les îles n'occupaient qu'une fraction de l'écran ; sur un téléphone
     * tenu debout, un petit quart de la hauteur. La mer n'a pas besoin d'être
     * cadrée : elle est continue jusqu'à la brume, et il en restera toujours
     * assez autour des terres pour qu'on voie qu'on est sur un archipel.
     *
     * Le rayon qui borne la course de zoom suit la même règle, sans quoi la
     * butée avant, calculée sur un rayon gonflé par la mer, interdisait de
     * s'approcher assez pour lire un carrefour.
     */
    for (const hex of view.hexes) {
      if (!terres.has(hex.id)) continue;
      const { x, z } = centreHex(hex.id);
      for (let k = 0; k < 6; k++) {
        const angle = (k * Math.PI) / 3;
        points.push({ x: x + Math.sin(angle), z: z + Math.cos(angle) });
      }
    }

    for (const port of view.ports) {
      const { x, z } = this.positionPort(port.vertex, terres);
      for (const dx of [-0.42, 0.42]) for (const dz of [-0.42, 0.42]) {
        points.push({ x: x + dx, z: z + dz });
      }
    }

    return points;
  }

  /**
   * Le panneau d'un port, poussé vers l'eau que touche son sommet.
   *
   * Un sommet est le trio d'hexagones qui s'y rejoignent : il suffit de
   * regarder lesquels sont de la mer, et de pousser le panneau dans leur
   * direction. Le premier essai poussait « vers l'extérieur du plateau »,
   * ce qui marche sur une côte convexe et enfonce le panneau sous la terre
   * voisine dès que la côte rentre — et un archipel n'est fait que de côtes
   * qui rentrent.
   */
  private positionPort(vertex: string, terres: ReadonlySet<string>): Point3 {
    const { x, z } = barycentre(vertex);
    const eaux = vertex.split('|').filter((id) => !terres.has(id)).map(centreHex);
    if (eaux.length === 0) return { x, z };

    const large = eaux.reduce((acc, c) => ({ x: acc.x + c.x, z: acc.z + c.z }), { x: 0, z: 0 });
    const dx = large.x / eaux.length - x;
    const dz = large.z / eaux.length - z;
    const norme = Math.hypot(dx, dz) || 1;
    // Assez loin pour que le panneau entier soit sur l'eau. À 0,62 son bord
    // intérieur restait sous la tuile voisine, et le port disparaissait
    // presque entièrement — un coin dépassait, ce qui avait l'air d'un bogue
    // d'affichage plutôt que d'un panneau mal posé.
    return { x: x + (dx / norme) * 0.98, z: z + (dz / norme) * 0.98 };
  }

  /** Les hexagones qui ne sont pas de la mer. */
  private terresDe(view: PublicGameView): Set<string> {
    return new Set(view.hexes.filter((h) => h.terrain !== 'sea').map((h) => h.id));
  }

  /** Applique le cadrage d'ensemble : c'est lui que « Recentrer » rétablit. */
  private cadrerTout(view: PublicGameView): void {
    const points = this.pointsACadrer(view);
    const terres = [...this.terresDe(view)];
    const emprise = bornes(terres.length > 0 ? terres : view.hexes.map((h) => h.id));

    // Le point visé est le barycentre de ce qu'on cadre. Viser le centre du
    // rectangle englobant décentrait le plateau dès qu'il n'était pas
    // symétrique — et un archipel ne l'est jamais.
    const somme = points.reduce((acc, p) => ({ x: acc.x + p.x, z: acc.z + p.z }), { x: 0, z: 0 });
    const centre = points.length > 0
      ? { x: somme.x / points.length, z: somme.z / points.length }
      : { x: emprise.centreX, z: emprise.centreZ };

    this.cadrage.cadrer(points, centre, emprise.rayon, this.camera);
  }

  /** La carte d'ombres suit le plateau : cadrée trop large, elle se dilue. */
  private reglerOmbres(cx: number, cz: number, rayon: number): void {
    const cam = this.soleil.shadow.camera;
    const portee = rayon * 1.25;
    cam.left = -portee; cam.right = portee;
    cam.top = portee; cam.bottom = -portee;
    cam.near = 1; cam.far = rayon * 6;
    cam.updateProjectionMatrix();
    this.soleil.position.set(cx - rayon * 1.1, rayon * 1.8, cz + rayon * 0.9);
    this.soleil.target.position.set(cx, 0, cz);
    this.soleil.target.updateMatrixWorld();
  }

  /**
   * Les terres du large : posées une fois, jamais retouchées.
   *
   * Elles ne dépendent d'aucune donnée du moteur — ce sont des silhouettes
   * décidées d'avance. Les reposer à chaque mise à jour serait travailler
   * pour rien, et les mêler aux tuiles jouables exposerait le joueur à
   * cliquer sur une île qui n'existe pas.
   */
  private poserLeLarge(ids: ReadonlySet<string>): void {
    const geo = cylindreHex(0.985, EPAISSEUR * 0.8);
    const mat = new MeshStandardMaterial({ color: 0x2f3f42, roughness: 1, metalness: 0 });
    const couche = new Couche(this.groupeStatique, geo, mat, { ombreRecue: true });
    this.aJeter.push(geo, mat);
    const m = new Matrix4();
    for (const { x, z } of ilesDuLarge(ids)) {
      /*
       * Chaque île du large a sa hauteur.
       *
       * Toutes taillées au même niveau, elles formaient des plateaux — la
       * silhouette qu'on voit en reculant est justement ce pour quoi elles
       * existent. La variation est tirée de leur position, donc stable d'un
       * rendu à l'autre et identique pour tous les joueurs.
       */
      const empreinte = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
      const etirement = 0.7 + empreinte * 1.9;
      couche.ajouter(
        'large',
        m.makeScale(1, etirement, 1)
          .setPosition(x, MER + EPAISSEUR * 0.4 * etirement, z),
      );
    }
    couche.finir();
  }

  private poserTerres(etat: EtatPlateau): void {
    const cibles = new Set(etat.robberTargets);
    const terres = new Set(etat.view.hexes.filter((h) => h.terrain !== 'sea').map((h) => h.id));

    this.prismes.reinitialiser(this.poseA, this.premiere);
    this.ecume.reinitialiser(this.poseA, this.premiere);
    this.voleur.reinitialiser(this.poseA, this.premiere);
    this.cibleHexes.reinitialiser(this.poseA, this.premiere);
    for (const c of this.dessus.values()) c.reinitialiser(this.poseA, this.premiere);

    this.altitudes.clear();
    this.sommets.clear();
    this.terrains.clear();
    for (const hex of etat.view.hexes) {
      if (hex.terrain === 'sea') continue;
      this.altitudes.set(hex.id, baseDe(hex.terrain));
      this.sommets.set(hex.id, sommetDe(hex.terrain));
      this.terrains.set(hex.id, hex.terrain);
    }

    const m = new Matrix4();
    for (const hex of etat.view.hexes) {
      const { x, z } = centreHex(hex.id);
      const base = this.altitudes.get(hex.id) ?? 0;

      // Seules les terres sont des volumes. La mer, elle, est la nappe
      // animée : la pavée d'hexagones aurait répété la même image cinquante
      // fois, et la répétition se voyait plus que l'eau.
      if (hex.terrain !== 'sea') {
        // Une tuile bloquée s'assombrit. C'est la seule information de la
        // carte qui change en cours de partie sans rien déplacer, et il faut
        // qu'elle se voie sans lire le pion.
        const teinte = hex.blocked ? '#6d6257' : cibles.has(hex.id) ? '#ffd9a8' : '#ffffff';

        /*
         * La falaise s'étire vers le haut, pas vers le bas.
         *
         * Une seule géométrie de prisme sert toutes les terres : on l'allonge
         * par la matrice d'instance. Le pied reste où il était — sous le
         * niveau de la mer, sans quoi un jour apparaîtrait entre la roche et
         * l'eau — et seul le sommet monte à l'altitude du terrain.
         */
        const etirement = (EPAISSEUR + base) / EPAISSEUR;
        this.prismes.ajouter(
          hex.id,
          m.makeScale(1, etirement, 1).setPosition(x, base / 2, z),
          teinte,
        );

        this.dessusDe(hex.terrain).ajouter(
          hex.id,
          pose(x, SOL + base + 0.004, z, orientationDe(hex.id)),
          teinte,
        );

        if (estCotier(hex.id, terres)) {
          this.ecume.ajouter(hex.id, m.makeTranslation(x, SURFACE + 0.012, z));
        }
        if (hex.blocked) {
          /*
           * Le voleur se tient à côté du jeton, sur la pente.
           *
           * À l'altitude du sommet il aurait flotté au-dessus du versant
           * d'une montagne ; au centre, il aurait disputé sa place au jeton.
           */
          const ECART = 0.3;
          this.voleur.ajouter(
            hex.id,
            m.makeTranslation(x, SOL + hauteurRelative(hex.terrain, ECART / 0.955), z + ECART),
          );
        }
      }

      // Seules les tuiles où le voleur peut aller sont cliquables — comme
      // sur le plateau plat, où le reste de la carte ne réagissait pas.
      if (cibles.has(hex.id)) {
        // Le volume de visée enveloppe tout le relief de la tuile : viser un
        // sommet de montagne ne doit pas demander de viser à côté.
        this.cibleHexes.ajouter(hex.id, m.makeScale(1, 3, 1).setPosition(x, SOL + base, z));
      }
    }

    this.prismes.finir();
    this.ecume.finir();
    this.voleur.finir();
    this.cibleHexes.finir();
    for (const c of this.dessus.values()) c.finir();
  }

  /** La face peinte d'un terrain, créée à la première tuile qui l'emploie. */
  private dessusDe(terrain: string): Couche {
    const connue = this.dessus.get(terrain);
    if (connue) return connue;
    const couche = this.couche(
      geoRelief(terrain, 0.955),
      new MeshStandardMaterial({
        map: textureTerrain(terrain), roughness: 0.88, metalness: 0.02,
      }),
      // Les terres se font de l'ombre entre elles : une montagne qui n'en
      // projette pas reste une image de montagne, quelle que soit sa forme.
      { colore: true, ombreRecue: true, ombrePortee: true, ordreRendu: 0 },
    );
    this.dessus.set(terrain, couche);
    return couche;
  }

  private poserJetons(etat: EtatPlateau): void {
    this.jetons.reinitialiser(this.poseA, this.premiere);
    for (const c of this.faces.values()) c.reinitialiser(this.poseA, this.premiere);

    const m = new Matrix4();
    for (const hex of etat.view.hexes) {
      if (hex.token === undefined) continue;
      const { x, z } = centreHex(hex.id);
      // Le jeton couronne la tuile : sur le plateau du sommet pour une
      // montagne, à peine soulevé pour un champ.
      const haut = SOL + this.sommetHex(hex.id);
      this.jetons.ajouter(hex.id, m.makeTranslation(x, haut + 0.038, z));
      this.faceJeton(hex.token).ajouter(hex.id, m.makeTranslation(x, haut + 0.078, z));
    }

    this.jetons.finir();
    for (const c of this.faces.values()) c.finir();
  }

  /**
   * Une couche par valeur de jeton.
   *
   * Onze couches là où un atlas de textures en aurait fait une seule. C'est
   * onze appels de dessin pour toute la carte — le prix d'un seul bâtiment
   * non instancié — contre un shader à écrire et à maintenir. Le compromis
   * penche du côté du code qu'on n'écrit pas.
   */
  private faceJeton(valeur: number): Couche {
    const connue = this.faces.get(valeur);
    if (connue) return connue;
    const texture = textureJeton(valeur);
    const couche = this.couche(
      geoFaceJeton(),
      new MeshBasicMaterial({
        ...(texture ? { map: texture } : {}),
        transparent: true, depthWrite: false,
      }),
      // Le nombre suit son disque : même clé, même animation, donc les deux
      // sautent ensemble sans qu'aucune horloge n'ait à être accordée.
      { ordreRendu: 2, animation: recolte },
    );
    this.faces.set(valeur, couche);
    return couche;
  }

  private poserRoutes(etat: EtatPlateau): void {
    this.routes.reinitialiser(this.poseA, this.premiere);
    this.routesMer.reinitialiser(this.poseA, this.premiere);

    for (const route of etat.view.roads) {
      const { x, z } = barycentre(route.edge);
      const maritime = route.kind === 'maritime';
      const couche = maritime ? this.routesMer : this.routes;
      couche.ajouter(
        route.edge,
        pose(
          x,
          maritime ? SURFACE + 0.07 : this.hauteurSol(route.edge) + 0.04,
          z,
          rotationArete(route.edge),
        ),
        couleurDe(route.owner, this.ordre),
      );
    }

    this.routes.finir();
    this.routesMer.finir();
  }

  private poserBatiments(etat: EtatPlateau): void {
    for (const c of this.batiments.values()) c.reinitialiser(this.poseA, this.premiere);

    const m = new Matrix4();
    for (const batiment of etat.view.buildings) {
      const couche = this.batiments.get(batiment.kind) ?? this.batiments.get('settlement');
      if (!couche) continue;
      const { x, z } = barycentre(batiment.vertex);
      couche.ajouter(
        batiment.vertex,
        m.makeTranslation(x, this.hauteurSol(batiment.vertex), z),
        couleurDe(batiment.owner, this.ordre),
      );
    }

    for (const c of this.batiments.values()) c.finir();
  }

  /**
   * Les panneaux de port.
   *
   * Posés à plat sur l'eau, décalés vers le large. Debout, ils auraient
   * fallu tourner vers la caméra à chaque image ; à plat, ils se lisent sous
   * tous les angles et ne coûtent rien. Le décalage les sort de sous la
   * colonie qui finira par occuper le même sommet.
   */
  private poserPorts(etat: EtatPlateau): void {
    for (const c of this.panneaux.values()) c.reinitialiser(this.poseA, this.premiere);

    const terres = this.terresDe(etat.view);
    const m = new Matrix4();
    for (const port of etat.view.ports) {
      const { x, z } = this.positionPort(port.vertex, terres);
      this.panneauPort(port.kind).ajouter(port.vertex, m.makeTranslation(x, SURFACE + 0.05, z));
    }

    for (const c of this.panneaux.values()) c.finir();
  }

  private panneauPort(kind: string): Couche {
    const connue = this.panneaux.get(kind);
    if (connue) return connue;
    const texture = texturePort(kind);
    const couche = this.couche(
      plaquePlate(0.40),
      new MeshBasicMaterial({
        ...(texture ? { map: texture } : {}),
        transparent: true, depthWrite: false,
      }),
      { ordreRendu: 2 },
    );
    this.panneaux.set(kind, couche);
    return couche;
  }

  private poserAnnonces(etat: EtatPlateau): void {
    this.annonces.reinitialiser(this.poseA, this.premiere);
    this.gels.reinitialiser(this.poseA, this.premiere);

    const contestees = new Set(etat.view.intents.filter((i) => i.contested).map((i) => i.location));
    const m = new Matrix4();

    for (const intent of etat.view.intents) {
      // Les emplacements arrivent préfixés du type : deux caractères à ôter
      // pour retrouver la clé que la géométrie sait situer.
      const { x, z } = barycentre(intent.location.slice(2));
      this.annonces.ajouter(
        intent.id,
        m.makeTranslation(x, this.hauteurSol(intent.location.slice(2)) + 0.06, z),
        contestees.has(intent.location) ? '#E4432B' : couleurDe(intent.player, this.ordre),
      );
    }

    for (const gele of etat.view.frozenLocations) {
      const { x, z } = barycentre(gele.slice(2));
      this.gels.ajouter(gele, m.makeTranslation(x, this.hauteurSol(gele.slice(2)) + 0.09, z));
    }

    this.annonces.finir();
    this.gels.finir();
  }

  /**
   * Les emplacements proposés, et leurs cibles.
   *
   * Le visible et le cliquable sont deux couches distinctes, et c'est ce qui
   * rend le plateau jouable au doigt : l'anneau fait la taille qu'il doit
   * avoir pour ne pas masquer la carte, la cible fait la taille d'un pouce.
   */
  private poserPropositions(etat: EtatPlateau): void {
    this.anneaux.reinitialiser(this.poseA, this.premiere);
    this.fantomes.reinitialiser(this.poseA, this.premiere);
    this.cibleSommets.reinitialiser(this.poseA, this.premiere);
    this.cibleAretes.reinitialiser(this.poseA, this.premiere);

    const m = new Matrix4();
    for (const sommet of etat.highlightVertices) {
      const { x, z } = barycentre(sommet);
      const haut = this.hauteurSol(sommet);
      this.anneaux.ajouter(sommet, m.makeTranslation(x, haut + 0.03, z));
      this.cibleSommets.ajouter(sommet, m.makeTranslation(x, haut + 0.1, z));
    }

    for (const arete of etat.highlightEdges) {
      const { x, z } = barycentre(arete);
      const angle = rotationArete(arete);
      const haut = this.hauteurSol(arete);
      this.fantomes.ajouter(arete, pose(x, haut + 0.05, z, angle));
      this.cibleAretes.ajouter(arete, pose(x, haut + 0.1, z, angle));
    }

    this.anneaux.finir();
    this.fantomes.finir();
    this.cibleSommets.finir();
    this.cibleAretes.finir();
  }

  // ── gestes ───────────────────────────────────────────────────────────

  private readonly pointeurs = new Map<number, { x: number; y: number }>();
  /** Où chaque doigt s'est posé : c'est de là que se mesure la dérive. */
  private readonly origines = new Map<number, { x: number; y: number }>();
  private ecart = 0;
  private angleDoigts = 0;
  /** Le couple de doigts qui sert de base au pincement, dans l'ordre. */
  private paire: [number, number] | null = null;
  /** Torsion cumulée depuis que la paire s'est formée, en valeur absolue. */
  private torsion = 0;
  private glisse = false;
  private orbite = false;

  /**
   * Un doigt déplace, deux doigts zooment et tournent, un appui construit.
   *
   * Le fil ténu de tout cela est la distinction entre un geste et un appui.
   * Sans elle, chaque déplacement de la carte finissait par poser une route
   * là où le doigt s'était levé ; avec une tolérance trop serrée, c'est
   * l'inverse qui se produit et le voleur ne se pose plus. Les deux seuils
   * qui l'arbitrent sont dans `gestes.ts`, où ils se testent.
   */
  private brancherGestes(): void {
    const toile = this.renderer.domElement;

    toile.addEventListener('pointerdown', (e) => {
      const point = { x: e.clientX, y: e.clientY };
      this.pointeurs.set(e.pointerId, point);
      this.origines.set(e.pointerId, point);

      // Un second doigt qui se pose ne relance pas le geste. Sans cette
      // garde, il effaçait le glissement en cours : on faisait glisser la
      // carte, on posait un second doigt, et le lever reposait une route.
      if (this.pointeurs.size === 1) {
        this.glisse = false;
        // Le clic droit et la touche majuscule font tourner : sur un
        // ordinateur il n'y a pas de second doigt, et sans eux la caméra
        // restait figée dans l'axe où elle était née.
        this.orbite = e.button === 2 || e.shiftKey;
      }

      // La base du pincement se refera au premier mouvement, avec les doigts
      // réellement posés à ce moment-là.
      this.paire = null;
      toile.setPointerCapture(e.pointerId);
    });

    toile.addEventListener('pointermove', (e) => {
      const avant = this.pointeurs.get(e.pointerId);
      if (!avant) return;
      const apres = { x: e.clientX, y: e.clientY };
      this.pointeurs.set(e.pointerId, apres);

      if (this.pointeurs.size >= 2) {
        const ids = [...this.pointeurs.keys()].slice(0, 2) as [number, number];
        const a = this.pointeurs.get(ids[0]);
        const b = this.pointeurs.get(ids[1]);
        if (!a || !b) return;

        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        const angle = Math.atan2(b.y - a.y, b.x - a.x);

        /*
         * La base se refait dès que le couple change de doigts.
         *
         * L'ordre du couple suit l'ordre d'arrivée : un doigt relevé puis
         * reposé passe derrière l'autre, et l'angle mesuré bascule d'un
         * demi-tour d'un coup. Repartir de zéro coûte une image ; ne pas le
         * faire coûte une embardée.
         */
        if (!this.paire || this.paire[0] !== ids[0] || this.paire[1] !== ids[1]) {
          this.paire = ids;
          this.ecart = distance;
          this.angleDoigts = angle;
          this.torsion = 0;
          return;
        }

        this.glisse = true;
        if (this.ecart > 0 && distance > 0) this.cadrage.zoomer(distance / this.ecart);

        // La torsion des deux doigts fait pivoter la carte. C'est le seul
        // geste dont un joueur n'a pas idée avant de l'essayer, et le seul
        // qui ne manque à personne s'il l'ignore.
        const torsion = ecartAngulaire(this.angleDoigts, angle);
        this.torsion += Math.abs(torsion);
        if (this.torsion > TORSION_MORTE) this.cadrage.tourner(azimutDepuisTorsion(torsion), 0);

        this.ecart = distance;
        this.angleDoigts = angle;
        this.signalerCadrage();
        return;
      }

      // La dérive se mesure depuis le point de départ, pas depuis le dernier
      // événement : c'est ce qui distingue un doigt qui s'étale d'un doigt
      // qui glisse.
      const origine = this.origines.get(e.pointerId);
      if (!this.glisse && origine && estGlissement(origine, apres, e.pointerType)) {
        this.glisse = true;
      }
      if (!this.glisse) return;

      const dx = apres.x - avant.x;
      const dy = apres.y - avant.y;
      if (this.orbite) {
        this.cadrage.tourner(dx * 0.006, -dy * 0.005);
      } else {
        this.cadrage.deplacer(dx, dy, this.hote.clientHeight, this.camera);
      }
      this.signalerCadrage();
    });

    const relacher = (e: PointerEvent): void => {
      const avait = this.pointeurs.delete(e.pointerId);
      this.origines.delete(e.pointerId);
      if (!avait) return;
      // Le couple a changé : la base du pincement ne vaut plus rien.
      this.paire = null;
      this.ecart = 0;
      if (this.pointeurs.size >= 1) return;
      if (!this.glisse) this.viser(e.clientX, e.clientY);
      this.glisse = false;
      this.orbite = false;
    };
    toile.addEventListener('pointerup', relacher);
    toile.addEventListener('pointercancel', relacher);
    toile.addEventListener('contextmenu', (e) => e.preventDefault());

    toile.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.cadrage.zoomer(e.deltaY < 0 ? 1.12 : 1 / 1.12);
      this.signalerCadrage();
    }, { passive: false });
  }

  private signalerCadrage(): void {
    const deplace = this.cadrage.deplace;
    if (deplace === this.cadrageSignale) return;
    this.cadrageSignale = deplace;
    this.rappels.onCadrage?.(deplace);
  }

  /**
   * Ce que le joueur a touché.
   *
   * Les cibles sont interrogées dans l'ordre où elles comptent : un sommet
   * et une arête proposés se recouvrent souvent, et lorsque les deux sont
   * sous le doigt c'est presque toujours le sommet qu'on visait — c'est la
   * pièce qui rapporte, l'arête n'est qu'un chemin. Les tuiles ne viennent
   * qu'en dernier, quand le voleur cherche où se poser.
   */
  private viser(clientX: number, clientY: number): void {
    const cadre = this.renderer.domElement.getBoundingClientRect();
    this.pointeur.set(
      ((clientX - cadre.left) / cadre.width) * 2 - 1,
      -((clientY - cadre.top) / cadre.height) * 2 + 1,
    );
    this.rayon.setFromCamera(this.pointeur, this.camera);

    const ordre: readonly [Couche, ((cle: string) => void) | undefined][] = [
      [this.cibleSommets, this.rappels.onVertexClick],
      [this.cibleAretes, this.rappels.onEdgeClick],
      [this.cibleHexes, this.rappels.onHexClick],
    ];

    for (const [couche, rappel] of ordre) {
      if (couche.vide || !rappel) continue;
      const touches = this.rayon.intersectObject(couche.mesh, false);
      const cle = couche.cleDe(touches[0]?.instanceId);
      if (cle !== undefined) { rappel(cle); return; }
    }
  }

  // ── boucle ───────────────────────────────────────────────────────────

  private readonly boucle = (): void => {
    if (this.detruit) return;
    this.image = requestAnimationFrame(this.boucle);

    const temps = (performance.now() - this.debut) / 1000;
    this.mer.animer(temps);

    /*
     * Les emplacements proposés respirent.
     *
     * Un anneau fixe se confond avec un motif de la tuile ; un anneau qui
     * pulse est la seule chose qui bouge sur une carte immobile, et l'œil y
     * va tout seul. C'est ce qui remplace le survol, dont un téléphone ne
     * dispose pas.
     */
    this.matPulsant.opacity = 0.62 + 0.36 * (0.5 + 0.5 * Math.sin(temps * 3.2));

    // Les chutes en cours, s'il y en a. La borne évite de réécrire deux cents
    // matrices à chaque image d'une partie où personne ne construit.
    if (temps < this.animerJusqua) {
      for (const couche of this.couchesAnimees()) couche.animer(temps);
    }

    /*
     * Les dés, hors de cette borne.
     *
     * Elle est réécrite — et non repoussée — à chaque pose de pièce : une
     * construction annoncée pendant que les dés roulent les figerait en
     * l'air. Deux maillages qui s'interrogent à chaque image ne coûtent rien,
     * et le module se tait de lui-même entre deux lancers.
     */
    this.des.animer(temps, this.camera);

    this.cadrage.appliquer(this.camera);
    this.renderer.render(this.scene, this.camera);
  };

  private redimensionner(): void {
    const largeur = this.hote.clientWidth;
    const hauteur = this.hote.clientHeight;
    if (largeur === 0 || hauteur === 0) return;
    this.renderer.setSize(largeur, hauteur, false);
    this.camera.aspect = largeur / hauteur;
    this.camera.updateProjectionMatrix();
    // Le cadrage dépend du format : une fenêtre qui s'étrécit doit reculer,
    // sinon le plateau sort par les côtés sans que personne l'ait demandé.
    if (this.etat && !this.cadrage.deplace) this.cadrerTout(this.etat.view);
  }

  recentrer(): void {
    if (this.etat) this.cadrerTout(this.etat.view);
    this.cadrage.recentrer();
    this.signalerCadrage();
  }

  /**
   * Le zoom par bouton, même course que la molette.
   *
   * Il existe parce que le pincement est le seul moyen de cadrer au doigt, et
   * qu'un geste raté laissait le joueur sans recours : la carte restait où
   * elle était, sans qu'aucune commande ne permette d'y revenir.
   */
  zoomer(facteur: number): void {
    this.cadrage.zoomer(facteur);
    this.signalerCadrage();
  }

  detruire(): void {
    this.detruit = true;
    cancelAnimationFrame(this.image);
    this.cadreObserve?.disconnect();
    this.mer.detruire();
    this.ciel?.detruire();
    this.des.detruire();
    for (const objet of this.aJeter) objet.dispose();
    this.matPulsant.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ── petits outils de géométrie ─────────────────────────────────────────

/**
 * Un prisme hexagonal pointe en haut, centré sur sa hauteur.
 *
 * `CylinderGeometry` à six segments place ses sommets aux angles mesurés
 * depuis l'axe des `z` : il en tombe donc un sur `(0, ±rayon)`, et
 * l'hexagone naît déjà pointe en haut. C'est ce qui dispense de la rotation
 * qu'on croit toujours devoir ajouter — et qui, ajoutée, décale la maille
 * d'un demi-pas sans qu'on voie pourquoi.
 */
function cylindreHex(rayon: number, hauteur: number): BufferGeometry {
  return new CylinderGeometry(rayon, rayon, hauteur, 6);
}

/** Une plaque carrée posée à plat, pour tout ce qui s'imprime au sol. */
function plaquePlate(demiCote: number): BufferGeometry {
  const geo = new PlaneGeometry(demiCote * 2, demiCote * 2);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Une matrice de pose : translation et rotation autour de la verticale. */
const _q = new Quaternion();
const _axe = new Vector3(0, 1, 0);
const _pos = new Vector3();
const _un = new Vector3(1, 1, 1);
function pose(x: number, y: number, z: number, angle: number): Matrix4 {
  return new Matrix4().compose(_pos.set(x, y, z), _q.setFromAxisAngle(_axe, angle), _un);
}

/** Une terre est côtière si l'un de ses six voisins n'est pas une terre. */
const VOISINS: readonly (readonly [number, number])[] = [
  [1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1],
];
function estCotier(id: string, terres: ReadonlySet<string>): boolean {
  const [q, r] = id.split(',').map(Number);
  return VOISINS.some(([dq, dr]) => !terres.has(`${(q ?? 0) + dq},${(r ?? 0) + dr}`));
}
