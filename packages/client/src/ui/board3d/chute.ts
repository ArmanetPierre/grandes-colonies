/**
 * La chute d'une pièce qu'on vient de poser.
 *
 * Une maison qui apparaît d'un coup ne se remarque pas. À douze joueurs, où
 * l'on pose hors de son tour et où la carte change pendant qu'on regarde
 * ailleurs, c'est un vrai problème de lecture : on découvre une route sans
 * savoir quand elle est arrivée. Une pièce qui tombe attire l'œil au bon
 * endroit et au bon moment, et le mouvement dit ce qu'aucune couleur ne dit.
 *
 * Les courbes sont écrites ici plutôt que dans la couche qui les applique :
 * ce sont des décisions de sensation, pas de rendu, et on veut pouvoir les
 * régler sans toucher aux matrices.
 */

/** D'où tombe la pièce, en unités de scène — deux hexagones et demi. */
const HAUTEUR = 2.6;

/** Quand elle touche le sol. Le reste est le rebond. */
const IMPACT = 0.3;

/** Durée totale, rebond compris. Au-delà, la pièce est posée pour de bon. */
export const DUREE_CHUTE = 0.78;

/** Décalage entre deux pièces posées ensemble : elles tombent en cascade. */
export const CASCADE = 0.07;

/** Ce qu'il faut appliquer à une pièce à un instant de sa chute. */
export interface Etape {
  /** Hauteur au-dessus de sa position finale. */
  readonly dy: number;
  readonly echelleXZ: number;
  readonly echelleY: number;
  /** Inclinaison autour de l'axe long, en radians. */
  readonly inclinaison: number;
  /** 0 : éteint. 1 : pleine couleur. Sert aux effets additifs. */
  readonly eclat: number;
  readonly fini: boolean;
}

const POSEE: Etape = { dy: 0, echelleXZ: 1, echelleY: 1, inclinaison: 0, eclat: 1, fini: true };

/** Avant son tour, la pièce n'existe pas encore : échelle nulle. */
const ATTENTE: Etape = { dy: 0, echelleXZ: 0, echelleY: 0, inclinaison: 0, eclat: 0, fini: false };

/**
 * Où en est une pièce, `age` secondes après avoir été posée.
 *
 * La descente suit `1 − u²` : la pièce part immobile et accélère, ce qui est
 * la seule façon qu'une chute paraisse pesante. Une interpolation linéaire —
 * ou, pire, un `ease-out` — donne une pièce qui freine en arrivant, et la
 * main la repose au lieu de la lâcher.
 */
export function chute(age: number): Etape {
  if (age < 0) return ATTENTE;
  if (age >= DUREE_CHUTE) return POSEE;

  if (age < IMPACT) {
    const u = age / IMPACT;
    return {
      dy: HAUTEUR * (1 - u * u),
      echelleXZ: 1,
      echelleY: 1,
      // Elle arrive de travers et se redresse en tombant : c'est le geste
      // d'une main qui lâche, pas d'une pièce téléportée à la verticale.
      inclinaison: 0.34 * (1 - u) * (1 - u),
      eclat: 1,
      fini: false,
    };
  }

  /*
   * Le rebond.
   *
   * Une oscillation amortie : la pièce s'écrase d'abord, s'étire ensuite en
   * se soulevant, puis se calme. L'écrasement conserve grossièrement le
   * volume — ce qui s'aplatit s'élargit — parce que l'œil accepte mal une
   * masse qui rétrécit dans tous les sens à la fois.
   */
  const t = (age - IMPACT) / (DUREE_CHUTE - IMPACT);
  const oscillation = Math.sin(t * Math.PI * 2.2) * Math.exp(-3.4 * t);

  return {
    dy: Math.max(0, -oscillation) * 0.22,
    echelleXZ: 1 + 0.18 * oscillation,
    echelleY: 1 - 0.3 * oscillation,
    inclinaison: 0,
    eclat: 1,
    fini: false,
  };
}

/** Combien de temps la poussière d'impact reste visible. */
export const DUREE_POUSSIERE = IMPACT + 0.42;

/**
 * L'anneau de poussière soulevé à l'atterrissage.
 *
 * Il ne commence qu'au moment de l'impact — avant, la pièce est encore en
 * l'air et un halo au sol annoncerait une arrivée qui n'a pas eu lieu.
 *
 * Il s'efface en s'éteignant plutôt qu'en rétrécissant : le matériau est
 * additif, et une couleur qui tend vers le noir y devient invisible. C'est
 * le seul moyen de faire disparaître une instance parmi d'autres, chacune
 * avec son propre âge, sans un shader pour porter une opacité par instance.
 */
export function poussiere(age: number): Etape {
  if (age < IMPACT || age >= DUREE_POUSSIERE) return { ...POSEE, eclat: 0, echelleXZ: 0, echelleY: 0 };

  const t = (age - IMPACT) / (DUREE_POUSSIERE - IMPACT);
  return {
    dy: 0.02,
    // L'anneau s'ouvre vite puis ralentit : la poussière perd son élan.
    echelleXZ: 0.35 + 1.45 * Math.sqrt(t),
    echelleY: 1,
    inclinaison: 0,
    eclat: (1 - t) * (1 - t),
    fini: false,
  };
}

/** Combien de temps un jeton fête sa production. */
export const DUREE_RECOLTE = 0.72;

/** De combien il se soulève. Un demi-rayon d'hexagone : visible, pas acrobatique. */
const HAUTEUR_RECOLTE = 0.34;

/** La montée, avant le retour et les rebonds. */
const MONTEE = 0.15;

/**
 * Le sursaut d'un jeton dont l'hexagone vient de produire.
 *
 * Le joueur qui encaisse voit ses cartes changer dans la barre du bas ; ce
 * qu'il ne voit pas, c'est *d'où* elles viennent. À douze joueurs sur une
 * carte de cinquante tuiles, retrouver soi-même les hexagones qui portent le
 * chiffre sorti est un travail — et un travail qu'on refait à chaque lancer.
 * Le jeton qui saute le fait à sa place.
 *
 * Il saute plutôt qu'il ne clignote : le clignotement se confond avec les
 * emplacements proposés, qui pulsent déjà, et un plateau où deux choses
 * différentes battent au même rythme ne dit plus rien.
 */
export function recolte(age: number): Etape {
  if (age < 0 || age >= DUREE_RECOLTE) return POSEE;

  if (age < MONTEE) {
    const u = age / MONTEE;
    return {
      // Un quart de sinusoïde : le jeton part vite et arrive amorti en haut,
      // comme s'il avait été chassé par-dessous.
      dy: HAUTEUR_RECOLTE * Math.sin((u * Math.PI) / 2),
      echelleXZ: 1 + 0.14 * u,
      echelleY: 1,
      inclinaison: 0,
      eclat: 1,
      fini: false,
    };
  }

  // Puis il retombe et rebondit deux fois, de moins en moins haut.
  const t = (age - MONTEE) / (DUREE_RECOLTE - MONTEE);
  const amorti = Math.exp(-3.6 * t);
  return {
    dy: HAUTEUR_RECOLTE * Math.abs(Math.cos(t * Math.PI * 1.6)) * amorti,
    echelleXZ: 1 + 0.14 * amorti,
    echelleY: 1,
    inclinaison: 0,
    eclat: 1,
    fini: false,
  };
}
