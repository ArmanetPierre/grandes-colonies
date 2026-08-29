/**
 * Les niveaux — de quoi un adversaire est capable.
 *
 * Le caractère dit ce qu'un bot **veut** ; le niveau dit ce qu'il **sait
 * faire**. Séparer les deux est le seul moyen d'obtenir une table réglable :
 * on veut pouvoir mettre six caractères différents à un niveau qui laisse
 * gagner les enfants, puis remonter la même table d'un cran sans que les
 * adversaires deviennent six copies du même optimiseur.
 *
 * Un niveau n'ajoute donc jamais un droit que le jeu refuse — tous passent
 * par le même WebSocket et les mêmes vues. Il ouvre des **facultés** :
 * regarder la valeur d'un emplacement plutôt que prendre le premier,
 * planifier la construction suivante, proposer un échange, viser le meneur.
 *
 * Le premier niveau est délibérément faible. C'est le seul qui donne un sens
 * aux autres : un jeu où le débutant perd quand même n'a pas de niveaux, il
 * a des décors.
 */

export const NIVEAU_IDS = [1, 2, 3, 4] as const;
export type NiveauId = (typeof NIVEAU_IDS)[number];

/**
 * Comment le voleur choisit sa cible.
 *
 * `premier` : le premier hexagone venu — l'apprenti ne regarde pas.
 * `riche` : celui qui coûte le plus à la table, main la plus grosse d'abord.
 * `meneur` : comme `riche`, mais on freine celui qui mène **dès qu'il touche
 * au but**. Pas avant : le voleur posé sur le meneur ne rapporte rien à
 * celui qui le pose, et le faire trop tôt revient à jouer pour les autres
 * (voir `Pilote.designer`, où la mesure est chiffrée).
 */
export type Visee = 'premier' | 'riche' | 'meneur';

export interface Niveau {
  readonly id: NiveauId;
  readonly nom: string;
  readonly description: string;
  /**
   * Finesse du regard porté sur un emplacement, de 0 à 1.
   *
   * À 0 le bot prend le premier emplacement légal — c'est ce que faisaient
   * les bots jusqu'ici, et c'est ce qui les condamnait : une colonie posée
   * sur un 2 et un 12 ne produit presque jamais, et la partie était perdue
   * avant le premier lancer. À 1 il pèse les jetons, la diversité, les
   * ports et ce que l'emplacement retire aux autres.
   */
  readonly regard: number;
  /**
   * Planifie-t-il la construction suivante ?
   *
   * Sans plan, un bot convertit son surplus vers « ce dont il a le moins »,
   * ce qui ne mène nulle part : il lui manque toujours quelque chose. Avec
   * un plan, chaque échange le rapproche d'un coût précis.
   */
  readonly plan: boolean;
  /** Propose-t-il des échanges, au lieu de seulement les accepter ? */
  readonly negocie: boolean;
  /** Adresse-t-il ses offres à qui peut réellement les honorer ? */
  readonly negocieCible: boolean;
  /** Où pose-t-il le voleur. */
  readonly visee: Visee;
  /** Annonce-t-il une construction hors de son tour (§8) ? */
  readonly annonce: boolean;
  /** Choisit-il son objectif secret, ou laisse-t-il le premier venu ? */
  readonly objectif: boolean;
  /** Se défausse-t-il de ce qui ne sert pas, plutôt que du plus abondant ? */
  readonly defausseFine: boolean;
  /** Dépense-t-il avant d'atteindre la limite de main, pour éviter le sept ? */
  readonly tientSaMain: boolean;
  /**
   * À combien de points de la victoire il cesse de préparer l'avenir.
   *
   * Un bâtisseur qui pose encore des routes à deux points de la fin perd la
   * partie qu'il avait gagnée. Plus l'horizon est long, plus tôt le bot
   * bascule sur ce qui marque — et plus il abandonne tôt ce qui aurait
   * rapporté davantage plus tard. C'est le dernier réglage qui sépare
   * l'aguerri du stratège.
   */
  readonly horizon: number;
  /**
   * Part de coups délibérément moins bons, de 0 à 1.
   *
   * Ce n'est pas du bruit gratuit : c'est ce qui rend un adversaire battable
   * sans le rendre absurde. Il joue un coup légal et plausible, simplement
   * pas le meilleur — exactement ce que fait un joueur qui débute.
   */
  readonly distraction: number;
  /** Bornes du temps de réflexion, en millisecondes. */
  readonly reflexionMs: readonly [number, number];
}

function niveau(
  id: NiveauId, nom: string, description: string, reste: Omit<Niveau, 'id' | 'nom' | 'description'>,
): Niveau {
  return Object.freeze({ id, nom, description, ...reste });
}

export const NIVEAUX: Readonly<Record<NiveauId, Niveau>> = Object.freeze({
  1: niveau(1, 'Apprenti',
    'Joue des coups légaux sans les peser. Se laisse battre sans rancune.',
    {
      regard: 0, plan: false, negocie: false, negocieCible: false, visee: 'premier',
      annonce: false, objectif: false, defausseFine: false, tientSaMain: false, horizon: 2,
      distraction: 0.35, reflexionMs: [900, 1800],
    }),
  2: niveau(2, 'Colon',
    'Regarde les jetons avant de poser, construit par ordre de valeur, propose des échanges simples.',
    {
      regard: 0.7, plan: true, negocie: true, negocieCible: false, visee: 'riche',
      annonce: false, objectif: true, defausseFine: true, tientSaMain: false, horizon: 2,
      distraction: 0.15, reflexionMs: [700, 1400],
    }),
  3: niveau(3, 'Aguerri',
    'Propose des échanges, exploite ses ports, annonce hors de son tour, joue ses cartes à propos.',
    {
      regard: 0.9, plan: true, negocie: true, negocieCible: true, visee: 'riche',
      annonce: true, objectif: true, defausseFine: true, tientSaMain: true, horizon: 3,
      distraction: 0.06, reflexionMs: [500, 1100],
    }),
  4: niveau(4, 'Stratège',
    'Freine le meneur quand il touche au but, dispute les emplacements, et ne se trompe plus.',
    {
      regard: 1, plan: true, negocie: true, negocieCible: true, visee: 'meneur',
      annonce: true, objectif: true, defausseFine: true, tientSaMain: true, horizon: 5,
      distraction: 0, reflexionMs: [400, 900],
    }),
});

export function estNiveau(valeur: unknown): valeur is NiveauId {
  return valeur === 1 || valeur === 2 || valeur === 3 || valeur === 4;
}

/**
 * Le niveau demandé, ramené dans les bornes. Trois par défaut.
 *
 * Accepte aussi un niveau déjà constitué : c'est ce qui permet aux mesures
 * d'en fabriquer un sur mesure — le même niveau moins une faculté — pour
 * savoir laquelle des quatre pèse vraiment sur une partie.
 */
export function niveauDe(valeur: unknown): Niveau {
  if (typeof valeur === 'object' && valeur !== null && 'regard' in valeur && 'visee' in valeur) {
    return valeur as Niveau;
  }
  const n = Math.round(Number(valeur));
  if (!Number.isFinite(n)) return NIVEAUX[3];
  const borne = Math.min(4, Math.max(1, n)) as NiveauId;
  return NIVEAUX[borne];
}
