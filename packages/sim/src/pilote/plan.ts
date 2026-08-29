/**
 * Le plan — ce que le bot construit ensuite, et ce qui lui manque pour ça.
 *
 * C'est la pièce qui sépare un bot qui joue d'un bot qui pioche au hasard
 * dans ce qu'il peut payer. Sans plan, un adversaire convertit son surplus
 * vers « la ressource dont il a le moins », ce qui ne le rapproche de rien :
 * il lui manque toujours quelque chose, et la mesure le montrait bien — des
 * mains pleines, des défausses en série, et presque aucune construction.
 *
 * Avec un plan, tout le reste s'aligne : l'échange bancaire vise le coût
 * exact, l'offre proposée demande précisément la carte qui bloque, la
 * défausse épargne ce qui sert, et la carte Invention ne tombe plus au
 * hasard. Un seul choix, pris une fois, discipline six décisions.
 *
 * Le plan ne regarde qu'un coup en avant. Aller plus loin demanderait de
 * simuler la table, et une soirée à douze n'attend pas.
 */

import type { PublicGameView, PrivatePlayerView } from '@grand-colonies/protocol';
import {
  type ResourceCounts,
  type VertexId,
  COSTS,
  missingFor,
  total,
} from '@grand-colonies/engine';

import type { Caractere } from './caractere.js';
import type { Lecture } from './regard.js';

export type ButKind =
  | 'monument' | 'metropolis' | 'city' | 'settlement'
  | 'road' | 'maritimeRoute' | 'devCard';

export interface But {
  readonly kind: ButKind;
  readonly cout: ResourceCounts;
  /** Ce qui manque en main pour le payer. Vide quand il est payable. */
  readonly manque: ResourceCounts;
  /** Ce qu'il vaut, pour départager deux buts également accessibles. */
  readonly valeur: number;
}

/**
 * Métropoles supposées disponibles.
 *
 * Trois, comme le §8, mais déduites du plateau et non lues dans la
 * configuration : le bot compte celles qui sont posées, ce que n'importe quel
 * joueur peut faire en regardant la table. S'il se trompe, le serveur refuse
 * la commande et le plan repart au coup suivant.
 */
const METROPOLES = 3;

/**
 * Le but courant.
 *
 * Chaque candidat reçoit une valeur en « points par carte dépensée », puis
 * le caractère la penche. Le rapport brut ne suffirait pas : il donnerait la
 * même partie à tout le monde — monument, ville, ville, ville — et c'est
 * précisément ce qu'on cherche à éviter.
 */
export function choisirLeBut(
  vue: PublicGameView,
  moi: PrivatePlayerView,
  lecture: Lecture,
  caractere: Caractere,
): But | undefined {
  const monEtat = lecture.joueurs.get(moi.id);
  if (!monEtat) return undefined;

  const t = caractere.traits;
  const main = moi.hand;

  const miennes = [...lecture.batiments.entries()].filter(([, b]) => b.owner === moi.id);
  const colonies = miennes.filter(([, b]) => b.kind === 'settlement').length;
  const cites = miennes.filter(([, b]) => b.kind !== 'settlement').length;
  const metropoles = [...lecture.batiments.values()].filter((b) => b.kind === 'metropolis').length;

  // Un but dont l'emplacement n'existe pas est un but qui bloque la partie :
  // le bot thésauriserait pour une ville qu'il ne peut poser nulle part.
  // Les listes du serveur font foi quand elles sont remplies ; sinon on se
  // rabat sur ce que le plateau public permet de déduire.
  const peutPoser = (spots: readonly VertexId[], sinon: boolean): boolean =>
    spots.length > 0 || sinon;

  const candidats: But[] = [];
  const ajouter = (kind: ButKind, cout: ResourceCounts, valeur: number): void => {
    if (valeur <= 0) return;
    candidats.push({ kind, cout, manque: missingFor(main, cout), valeur });
  };

  /*
   * Le monument : deux points pour cinq cartes, une seule fois dans la
   * partie, et sans emplacement à disputer. C'est le meilleur rapport du
   * jeu — mais il exige une carte de chaque nature, donc il force à passer
   * par le commerce, ce qui est exactement ce que le §12 cherchait.
   */
  if (!monEtat.hasMonument && peutPoser(moi.spots.monuments, cites > 0)) {
    ajouter('monument', COSTS.monument, 2.4 * (0.6 + t.developpement));
  }

  if (monEtat.citiesLeft > 0 && peutPoser(moi.spots.cities, colonies > 0)) {
    // Une ville vaut un point de plus qu'une colonie, et double sa
    // production : c'est ce doublement, pas le point, qui gagne les parties.
    ajouter('city', COSTS.city, 2.1 * (0.6 + t.developpement));
  }

  if (monEtat.settlementsLeft > 0 && moi.spots.settlements.length > 0) {
    ajouter('settlement', COSTS.settlement, 2.0 * (0.6 + t.expansion));
  }

  if (metropoles < METROPOLES && peutPoser(moi.spots.metropolises, cites > 0)) {
    // Elles ne sont que trois : un bot qui attend d'avoir tout le reste n'en
    // aura jamais. L'urgence monte à mesure qu'elles se prennent.
    const rarete = 1 + (METROPOLES - metropoles === 1 ? 0.6 : 0.2);
    ajouter('metropolis', COSTS.metropolis, 1.5 * (0.5 + t.developpement) * rarete);
  }

  if (monEtat.roadsLeft > 0 && moi.spots.roads.length > 0) {
    // Une route ne rapporte aucun point : elle ouvre. Elle ne vaut donc que
    // s'il reste de la place où aller, et vaut beaucoup s'il n'y en a plus
    // ici — c'est le cas où le bot est enfermé.
    const enferme = moi.spots.settlements.length === 0;
    ajouter('road', COSTS.road, (enferme ? 1.9 : 1.1) * (0.5 + t.expansion));
  }

  if (monEtat.roadsLeft > 0 && moi.spots.maritime.length > 0) {
    const enferme = moi.spots.settlements.length === 0;
    ajouter('maritimeRoute', COSTS.maritimeRoute, (enferme ? 2.0 : 1.0) * (0.4 + t.marine));
  }

  if (vue.deckRemaining > 0) {
    // Le pari : un point de victoire caché, un chevalier vers la plus grande
    // puissance militaire, ou une carte qui débloque une construction.
    ajouter('devCard', COSTS.devCard, 1.4 * (0.35 + t.cartes));
  }

  if (candidats.length === 0) return undefined;

  /*
   * Le prix se paie en cartes, et toutes ne se valent pas.
   *
   * Une carte qui manque coûte plus cher qu'une carte qu'on a déjà : il faut
   * la produire, ou la payer au cours. On divise donc la valeur par le coût
   * ressenti — celui qui reste à réunir — et non par le coût affiché.
   */
  const score = (but: But): number => {
    const aTrouver = total(but.manque);
    const ressenti = total(but.cout) * 0.35 + aTrouver;
    return but.valeur / Math.max(1, ressenti);
  };

  return [...candidats].sort((a, b) => score(b) - score(a))[0];
}

/**
 * Le but qui rapporte des points le plus vite, quand la victoire est proche.
 *
 * Un bâtisseur qui pose encore des routes à deux points de la fin perd la
 * partie qu'il avait gagnée. On bascule alors sur ce qui marque, sans
 * regarder ce que le caractère préférait. `horizon` dit à combien de points
 * de la fin ce basculement se fait — c'est un réglage de niveau, pas de
 * caractère : savoir compter les points qui restent s'apprend.
 */
export function butDeFin(
  moi: PrivatePlayerView,
  lecture: Lecture,
  restant: number,
  horizon = 3,
): But | undefined {
  if (restant > horizon) return undefined;

  const monEtat = lecture.joueurs.get(moi.id);
  if (!monEtat) return undefined;

  const candidats: But[] = [];
  const ajouter = (kind: ButKind, cout: ResourceCounts, points: number): void => {
    candidats.push({ kind, cout, manque: missingFor(moi.hand, cout), valeur: points });
  };

  if (!monEtat.hasMonument && moi.spots.monuments.length > 0) ajouter('monument', COSTS.monument, 2);
  if (moi.spots.metropolises.length > 0) ajouter('metropolis', COSTS.metropolis, 1);
  if (monEtat.citiesLeft > 0 && moi.spots.cities.length > 0) ajouter('city', COSTS.city, 1);
  if (monEtat.settlementsLeft > 0 && moi.spots.settlements.length > 0) ajouter('settlement', COSTS.settlement, 1);

  if (candidats.length === 0) return undefined;

  // Le moins de cartes à réunir pour le plus de points : à ce stade, c'est
  // tout ce qui compte.
  return [...candidats]
    .sort((a, b) => (total(a.manque) - a.valeur * 2) - (total(b.manque) - b.valeur * 2))[0];
}
