/**
 * La physique des dés : deux cubes, une table, et rien d'autre.
 *
 * **Comment un dé simulé tombe-t-il sur le nombre que le serveur a tiré ?**
 * C'est la seule question que pose ce fichier, et sa réponse tient à une
 * propriété du cube : il a vingt-quatre orientations qui le laissent
 * identique à lui-même. On simule donc une chute honnête, sans savoir ce
 * qu'elle donnera ; on regarde quelle face se retrouve en haut ; puis on
 * fait tourner la **peinture** du dé — pas sa trajectoire — d'une de ces
 * vingt-quatre rotations, pour que le nombre voulu soit celui qui regarde le
 * ciel. Le mouvement reste rigoureusement celui qui a été calculé : mêmes
 * chocs, mêmes rebonds, mêmes appuis. Seuls les points ont changé de face,
 * et un cube repeint est un cube.
 *
 * C'est ce qui distingue cette simulation d'une animation déguisée. Rien
 * n'est corrigé en fin de course, aucune trajectoire n'est tordue pour
 * arriver quelque part : le dé roule où il veut, et c'est nous qui adaptons
 * ce qui est écrit dessus.
 *
 * **Pourquoi tout calculer d'avance.** Le lancer entier est simulé au moment
 * du lâcher, en une fraction de milliseconde, puis rejoué image par image.
 * Trois raisons : on connaît la face qui sortira avant d'afficher quoi que
 * ce soit — sans quoi la repeinture serait impossible ; on sait où les dés
 * s'arrêteront, donc où poser le total ; et la boucle d'affichage ne fait
 * plus que lire un tableau, ce qui la rend insensible aux images perdues.
 *
 * **Pourquoi le même lancer partout.** Le pas est fixe et le calcul n'emploie
 * que les quatre opérations et une racine carrée, toutes exactes au bit près
 * dans la norme des flottants. À graine égale, douze navigateurs différents
 * calculent la même chute — ce qui compte pour un jeu où la table entière
 * regarde le même lancer.
 */

import { Quaternion, Vector3 } from 'three';

/**
 * La pesanteur, en unités de scène par seconde carrée.
 *
 * Pas celle du monde. Un hexagone mesure cinq centimètres sur une vraie
 * table, donc une unité de scène en vaut cinq : la pesanteur réelle
 * s'écrirait ici 196, et un dé lâché de cinq unités toucherait la table en
 * moins d'un quart de seconde — trop vite pour qu'on voie tourner quoi que
 * ce soit. On garde donc la chute d'un objet dix fois plus grand, c'est-à-dire
 * le poids d'un dé de la taille d'une maison. C'est faux, et c'est exactement
 * ce qu'il faut : la lisibilité prime sur l'exactitude quand le joueur est
 * assis à trois mètres.
 */
const PESANTEUR = 26;

/** Ce que le dé rend au choc. Un dé sur un plateau de bois rebondit peu. */
const REBOND = 0.34;

/** Le frottement au contact : c'est lui qui arrête la rotation. */
const FROTTEMENT = 0.42;

/** Ce que l'air prend au dé à chaque seconde, en vitesse et en rotation. */
const TRAINEE = 0.4;
const TRAINEE_ANGULAIRE = 1.1;

/** Le pas du calcul. Fin, parce qu'un cube qui tourne vite traverse le sol. */
export const PAS_CALCUL = 1 / 480;

/** Le pas des images retenues : de quoi interpoler sans tout garder. */
export const PAS_IMAGE = 1 / 120;

/** En dessous, le dé est considéré immobile. */
const SEUIL_VITESSE = 0.35;
const SEUIL_ROTATION = 0.9;

/** Combien de temps il doit rester calme avant qu'on le déclare posé. */
const CALME = 0.1;

/**
 * Le temps qu'on lui laisse pour s'arrêter tout seul.
 *
 * C'est aussi ce que le reste de l'interface attend avant de reprendre la
 * main : le total, la récolte, la défausse. Un dé met en général une seconde
 * à se poser ; celui qui roule encore au bout de ce délai est couché de
 * force, parce qu'un plateau où l'on attend est pire qu'un dé un peu pressé.
 */
export const DUREE_MAX = 1.45;

/** Une image de la trajectoire : où est le dé, et comment il est tourné. */
export interface Image {
  readonly p: Vector3;
  readonly q: Quaternion;
}

/** Comment un dé est lâché. */
export interface Lacher {
  readonly p: Vector3;
  readonly v: Vector3;
  readonly q: Quaternion;
  /** Rotation initiale, en radians par seconde, dans le repère du monde. */
  readonly w: Vector3;
}

export interface Trajectoire {
  readonly images: readonly Image[];
  /** L'instant où le dé s'immobilise, en secondes depuis le lâcher. */
  readonly repos: number;
  /**
   * L'axe du dé, dans son propre repère, qui regarde le ciel au repos.
   *
   * C'est de là que vient la repeinture : on sait quelle face s'est arrêtée
   * en haut, il reste à décider ce qu'on y écrit.
   */
  readonly axeHaut: Vector3;
}

/** Un corps en cours de calcul. */
interface Corps {
  p: Vector3;
  v: Vector3;
  q: Quaternion;
  w: Vector3;
  /** Depuis combien de temps il est calme. */
  calme: number;
  pose: boolean;
}

/** Les huit coins d'un cube de côté 1, en demi-côtés. */
const COINS: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1], [1, -1, -1], [-1, 1, -1], [1, 1, -1],
  [-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1],
];

/** Les six axes d'un cube, pour savoir lequel finit en haut. */
const AXES: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/*
 * Des vecteurs de travail, partagés par tout le module.
 *
 * La simulation tourne huit cents fois par lancer sur deux corps et huit
 * coins : allouer un vecteur par contact donnerait au ramasse-miettes de quoi
 * faire hoqueter la première image du roulement, celle qu'on regarde.
 */
const _r = new Vector3();
const _c = new Vector3();
const _vc = new Vector3();
const _t = new Vector3();
const _j = new Vector3();
const _axe = new Vector3();
const _dq = new Quaternion();

/**
 * Le lancer, du lâcher à l'immobilité.
 *
 * Les deux dés sont calculés ensemble parce qu'ils se rencontrent : lancés
 * côte à côte, ils se heurtent une fois sur trois, et c'est précisément ce
 * choc-là qui fait qu'un lancer ressemble à un lancer.
 *
 * `table` est l'altitude du plan sur lequel ils tombent — le dessus de la
 * tuile visée, ou la mer. Le monde n'a pas d'autre obstacle : un plateau n'a
 * pas de bords, et des murs invisibles se verraient au premier dé qui
 * ricoche sur rien.
 */
export function simuler(lachers: readonly Lacher[], table: number, cote: number): Trajectoire[] {
  const demi = cote / 2;
  // Le moment d'inertie d'un cube homogène. Il est le même dans les trois
  // directions, ce qui dispense de promener un tenseur d'un repère à l'autre
  // à chaque contact : le cube est la seule forme qui offre cette économie.
  const inertie = (cote * cote) / 6;

  const corps: Corps[] = lachers.map((l) => ({
    p: l.p.clone(), v: l.v.clone(), q: l.q.clone(), w: l.w.clone(), calme: 0, pose: false,
  }));

  const suites: Image[][] = corps.map(() => []);
  const repos = corps.map(() => DUREE_MAX);

  let temps = 0;
  let prochaineImage = 0;
  while (temps <= DUREE_MAX + 1e-9) {
    if (temps >= prochaineImage - 1e-9) {
      corps.forEach((c, i) => (suites[i] as Image[]).push({ p: c.p.clone(), q: c.q.clone() }));
      prochaineImage += PAS_IMAGE;
    }

    for (let i = 0; i < corps.length; i++) {
      const c = corps[i] as Corps;
      if (c.pose) continue;

      avancer(c, PAS_CALCUL);
      contactTable(c, table, demi, inertie);

      if (calme(c)) {
        c.calme += PAS_CALCUL;
        if (c.calme >= CALME) {
          c.pose = true;
          repos[i] = temps;
          poser(c, table, demi);
        }
      } else {
        c.calme = 0;
      }
    }

    if (corps.length === 2) choc(corps[0] as Corps, corps[1] as Corps, cote, inertie);
    temps += PAS_CALCUL;
  }

  /*
   * Ceux qui roulent encore à la fin du budget sont couchés de force.
   *
   * Non pas d'un coup — un dé qui se téléporte à plat est exactement ce que
   * cette simulation existe pour éviter — mais sur les dernières images, en
   * les ramenant peu à peu vers leur pose. Cela arrive rarement, et se lit
   * comme un dé qui s'immobilise vite plutôt que comme une correction.
   */
  corps.forEach((c, i) => {
    if (c.pose) return;
    const suite = suites[i] as Image[];
    poser(c, table, demi);
    const atterrissage = Math.min(suite.length, Math.round(0.2 / PAS_IMAGE));
    for (let k = suite.length - atterrissage; k < suite.length; k++) {
      const image = suite[k] as Image;
      const part = (k - (suite.length - atterrissage) + 1) / atterrissage;
      (suite[k] as { p: Vector3; q: Quaternion }) = {
        p: image.p.clone().lerp(c.p, part),
        q: image.q.clone().slerp(c.q, part),
      };
    }
    repos[i] = DUREE_MAX;
  });

  return corps.map((c, i) => ({
    images: suites[i] as Image[],
    repos: repos[i] as number,
    axeHaut: axeVersLeHaut(c.q),
  }));
}

/** Un pas de vol : la pesanteur, la traînée, et la rotation. */
function avancer(c: Corps, dt: number): void {
  c.v.y -= PESANTEUR * dt;
  c.v.multiplyScalar(Math.max(0, 1 - TRAINEE * dt));
  c.w.multiplyScalar(Math.max(0, 1 - TRAINEE_ANGULAIRE * dt));
  c.p.addScaledVector(c.v, dt);

  /*
   * L'orientation avance par sa dérivée : q' = ½ ω q.
   *
   * On l'intègre puis on renormalise. Composer une petite rotation d'angle
   * |ω|dt aurait demandé un sinus et un cosinus par pas — donc des fonctions
   * dont la norme des flottants ne garantit pas le dernier bit, et deux
   * navigateurs finiraient par diverger sur le même lancer.
   */
  _dq.set(c.w.x, c.w.y, c.w.z, 0).multiply(c.q);
  c.q.set(
    c.q.x + _dq.x * 0.5 * dt,
    c.q.y + _dq.y * 0.5 * dt,
    c.q.z + _dq.z * 0.5 * dt,
    c.q.w + _dq.w * 0.5 * dt,
  ).normalize();
}

/**
 * Les contacts avec la table, coin par coin.
 *
 * Un cube ne touche pas un plan « en un point » : il le touche par un coin,
 * puis par une arête, puis par une face, et c'est cette suite qui donne au
 * rebond d'un dé son allure si reconnaissable. Traiter les huit coins à
 * chaque pas produit cette suite gratuitement, sans avoir à distinguer les
 * cas.
 */
function contactTable(c: Corps, table: number, demi: number, inertie: number): void {
  for (const coin of COINS) {
    _r.set(coin[0] * demi, coin[1] * demi, coin[2] * demi).applyQuaternion(c.q);
    _c.copy(c.p).add(_r);
    const enfoncement = table - _c.y;
    if (enfoncement <= 0) continue;

    // On ressort d'abord le coin du sol : sans cela, les enfoncements
    // s'accumulent et le dé finit par traverser la table.
    c.p.y += enfoncement;

    // La vitesse du point de contact : celle du centre, plus celle que lui
    // donne la rotation.
    _vc.copy(c.v).add(_t.crossVectors(c.w, _r));
    const normale = _vc.y;
    if (normale >= 0) continue;

    // Le dénominateur d'un choc contre un corps immobile de masse infinie.
    // Pour une normale verticale, il se simplifie à ceci.
    const bras = (_r.x * _r.x + _r.z * _r.z) / inertie;
    const impulsion = (-(1 + REBOND) * normale) / (1 + bras);

    c.v.y += impulsion;
    _j.set(0, impulsion, 0);
    c.w.add(_t.crossVectors(_r, _j).divideScalar(inertie));

    /*
     * Le frottement, qui fait le plus gros du travail.
     *
     * C'est lui qui arrête le dé : sans lui, un cube parfaitement élastique
     * en rotation glisse sur la table jusqu'à sortir du plateau. Il est borné
     * par la loi de Coulomb — on ne freine jamais plus que ce que la pression
     * autorise — faute de quoi le dé s'arrête net, comme collé.
     */
    _vc.copy(c.v).add(_t.crossVectors(c.w, _r));
    _t.set(_vc.x, 0, _vc.z);
    const glisse = _t.length();
    if (glisse < 1e-6) continue;

    _t.divideScalar(glisse);
    const brasT = (_r.y * _r.y + (_r.x * _t.z - _r.z * _t.x) ** 2) / inertie;
    const freinage = Math.min(glisse / (1 + brasT), FROTTEMENT * impulsion);
    _j.copy(_t).multiplyScalar(-freinage);
    c.v.add(_j);
    c.w.add(_axe.crossVectors(_r, _j).divideScalar(inertie));
  }
}

/**
 * Le choc entre les deux dés.
 *
 * Approché par deux sphères : deux cubes qui se rencontrent demanderaient de
 * chercher le plan qui les sépare, ce qui est le gros morceau d'un moteur
 * physique. Ce qu'on veut ici est plus modeste — qu'ils se repoussent au lieu
 * de se traverser, et qu'ils repartent en tournant. Une sphère de la taille
 * du dé le fait, et personne ne voit la différence sur un choc qui dure trois
 * images.
 */
function choc(a: Corps, b: Corps, cote: number, inertie: number): void {
  const rayon = cote * 0.58;
  _r.subVectors(b.p, a.p);
  const distance = _r.length();
  if (distance > rayon * 2 || distance < 1e-6) return;

  _r.divideScalar(distance);
  const chevauchement = rayon * 2 - distance;
  a.p.addScaledVector(_r, -chevauchement / 2);
  b.p.addScaledVector(_r, chevauchement / 2);

  _vc.subVectors(b.v, a.v);
  const approche = _vc.dot(_r);
  if (approche >= 0) return;

  // Deux masses égales et libres : l'impulsion se partage.
  const impulsion = (-(1 + REBOND) * approche) / 2;
  a.v.addScaledVector(_r, -impulsion);
  b.v.addScaledVector(_r, impulsion);

  // Et le choc les fait tourner : un dé heurté de côté part en vrille, c'est
  // ce qui rend un lancer à deux dés vivant.
  _j.copy(_r).multiplyScalar(impulsion * rayon * 0.6);
  a.w.addScaledVector(_axe.set(_j.z, _j.x, -_j.y).divideScalar(inertie), -1);
  b.w.addScaledVector(_axe.set(_j.z, _j.x, -_j.y).divideScalar(inertie), 1);

  a.calme = 0;
  b.calme = 0;
  a.pose = false;
  b.pose = false;
}

function calme(c: Corps): boolean {
  return c.v.lengthSq() < SEUIL_VITESSE * SEUIL_VITESSE
    && c.w.lengthSq() < SEUIL_ROTATION * SEUIL_ROTATION;
}

/**
 * Coucher le dé bien à plat.
 *
 * Un cube qui s'immobilise sous impulsions garde un ou deux degrés
 * d'inclinaison : invisible à l'œil, mais c'est la différence entre un
 * nombre qu'on lit et un nombre qu'on déchiffre. On aligne donc l'axe déjà
 * le plus proche de la verticale sur la verticale, sans toucher au reste — le
 * lacet, lui, est celui que la chute a produit.
 */
function poser(c: Corps, table: number, demi: number): void {
  const axe = axeVersLeHaut(c.q);
  _axe.copy(axe).applyQuaternion(c.q);
  _dq.setFromUnitVectors(_axe, HAUT);
  c.q.premultiply(_dq);
  c.p.y = table + demi;
  c.v.set(0, 0, 0);
  c.w.set(0, 0, 0);
}

const HAUT = new Vector3(0, 1, 0);

/** Lequel des six axes du dé regarde le ciel, dans le repère du dé. */
function axeVersLeHaut(q: Quaternion): Vector3 {
  let meilleur = AXES[0] as readonly [number, number, number];
  let score = -Infinity;
  for (const axe of AXES) {
    const haut = _t.set(axe[0], axe[1], axe[2]).applyQuaternion(q).y;
    if (haut > score) { score = haut; meilleur = axe; }
  }
  return new Vector3(meilleur[0], meilleur[1], meilleur[2]);
}
