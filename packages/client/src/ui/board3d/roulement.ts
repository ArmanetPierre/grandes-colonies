/**
 * Ce qui entoure le lancer : les faces, le temps, et le total annoncé.
 *
 * La chute elle-même n'est plus écrite ici — elle est simulée, dans
 * `physique.ts`. Ce fichier garde ce qui n'est pas de la mécanique : quelle
 * face porte quel nombre, combien de temps les dés restent en vue, et
 * comment le total se déclare une fois qu'ils se sont arrêtés. Ce sont des
 * décisions de sensation et de lecture, et on veut pouvoir les régler sans
 * toucher au solveur.
 */

import { DUREE_MAX } from './physique.js';

/**
 * Le temps que les dés mettent à s'immobiliser, au pire.
 *
 * C'est le budget de la simulation, et c'est sur lui que le reste de
 * l'interface se règle. Un lancer se pose le plus souvent bien avant — le
 * total, lui, ne s'affiche pas au bout du budget mais à l'instant précis où
 * le dernier dé s'arrête.
 */
export const DUREE_ROULEMENT = DUREE_MAX;

/** Combien de temps ils restent en place, une fois arrêtés. */
export const DUREE_REPOS = 2.2;

/** Leur effacement : ils s'éteignent plutôt qu'ils ne disparaissent. */
export const DUREE_EFFACEMENT = 0.5;

/** Toute la vie d'un lancer, du lâcher à l'effacement. */
export const DUREE_TOTALE = DUREE_ROULEMENT + DUREE_REPOS + DUREE_EFFACEMENT;

/**
 * Quelle face porte quel nombre.
 *
 * L'ordre des matériaux d'une `BoxGeometry` est `+X, −X, +Y, −Y, +Z, −Z` :
 * cette table et `ORDRE_FACES` disent la même chose dans les deux sens, et
 * doivent donc être modifiées ensemble. Les faces opposées totalisent sept,
 * comme sur un dé du commerce, et 1-2-3 tournent dans le sens direct autour
 * de leur sommet commun — c'est ce qui distingue un vrai dé d'un cube
 * numéroté au hasard, et l'œil le remarque sans savoir pourquoi.
 */
export const NORMALES: Readonly<Record<number, readonly [number, number, number]>> = {
  1: [1, 0, 0],
  6: [-1, 0, 0],
  2: [0, 1, 0],
  5: [0, -1, 0],
  3: [0, 0, 1],
  4: [0, 0, -1],
};

/** Les six nombres dans l'ordre où `BoxGeometry` attend ses matériaux. */
export const ORDRE_FACES: readonly number[] = [1, 6, 2, 5, 3, 4];

/**
 * L'opacité du dé, qui ne s'efface qu'après avoir été lu.
 *
 * Deux dés laissés sur la carte masquent des tuiles, et la table finit par
 * ne plus les voir. Ils s'éteignent donc, une fois passé le temps qu'il faut
 * pour lire un nombre à trois mètres — le bandeau, lui, garde le résultat
 * jusqu'au lancer suivant.
 */
export function opacite(age: number): number {
  const debut = DUREE_ROULEMENT + DUREE_REPOS;
  if (age < debut) return 1;
  if (age >= DUREE_TOTALE) return 0;
  return 1 - (age - debut) / DUREE_EFFACEMENT;
}

/**
 * Une graine tirée d'une chaîne, pour que tout le monde voie le même lancer.
 *
 * À douze joueurs, le lancer est le seul instant où la table entière regarde
 * la même chose. Si chaque écran tirait sa propre trajectoire, ce serait
 * douze lancers différents arrivant sur le même nombre — le voisin qui
 * commente ce qu'il voit ne décrirait pas ce que vous voyez. La graine se
 * déduit donc de ce que tous les clients connaissent déjà : le cycle, le
 * joueur actif et les deux dés.
 *
 * FNV-1a, parce qu'elle tient en quatre lignes et disperse assez bien pour
 * que deux lancers voisins n'aient pas la même allure.
 */
export function graineDepuis(cle: string): number {
  let hachage = 0x811c9dc5;
  for (let i = 0; i < cle.length; i++) {
    hachage ^= cle.charCodeAt(i);
    hachage = Math.imul(hachage, 0x01000193);
  }
  return ((hachage >>> 0) % 100000) / 100000;
}

/**
 * Une suite de tirages, à partir d'une graine.
 *
 * Le lâcher demande une dizaine de nombres — deux positions, deux vitesses,
 * deux rotations — et il les faut tous identiques d'un écran à l'autre.
 * `mulberry32` tient en quatre lignes, ne dépend d'aucun état global, et
 * redonne la même suite à la même graine sur n'importe quel navigateur.
 */
export function tirages(graine: number): () => number {
  let etat = (graine * 4294967296) >>> 0;
  return () => {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Le mouvement qu'on n'a pas demandé peut gêner.
 *
 * Le reste de la scène le respecte en CSS ; ici il faut le lire en clair,
 * parce qu'aucune feuille de style ne gouverne une matrice.
 */
export function mouvementReduit(): boolean {
  return typeof matchMedia === 'function'
    && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Combien de temps le reste de l'interface doit attendre.
 *
 * Le bandeau des dés et les jetons qui sautent se règlent là-dessus : sans
 * cela, le total s'afficherait en haut de l'écran pendant que les dés
 * tournent encore, et personne ne regarderait la fin du lancer.
 */
export function dureeDuJet(): number {
  return mouvementReduit() ? 0 : DUREE_ROULEMENT;
}

/** Le temps qu'il met à monter et à s'affirmer. */
const MONTEE_ANNONCE = 0.32;

/** De combien il s'élève au-dessus de sa place de départ. */
const ELAN_ANNONCE = 0.34;

/** Ce qu'il advient du total annoncé, `age` secondes après le lâcher. */
export interface EtapeAnnonce {
  readonly dy: number;
  readonly echelle: number;
  /** 0 : absent. 1 : pleinement là. À multiplier par l'effacement général. */
  readonly eclat: number;
}

const ABSENTE: EtapeAnnonce = { dy: 0, echelle: 0, eclat: 0 };

/**
 * Le total, qui monte des dés une fois qu'ils sont arrêtés.
 *
 * Il n'apparaît pas avant : un nombre affiché pendant que les dés roulent
 * dirait le résultat avant eux, et l'on ne regarderait plus rouler. `repos`
 * est l'instant où le dernier dé s'est arrêté — celui que la simulation a
 * trouvé, et qui change à chaque lancer. Il monte
 * et grossit d'un coup, puis se tient tranquille — c'est le geste d'une chose
 * qui se déclare, quand la chute était celle d'une chose qui tombe.
 *
 * Le léger dépassement d'échelle au sommet de la montée n'est pas un ornement :
 * sans lui, un nombre qui grandit à vitesse constante a l'air de s'approcher
 * de la caméra plutôt que de s'annoncer.
 */
export function annonce(age: number, repos: number): EtapeAnnonce {
  if (age < repos) return ABSENTE;

  const u = Math.min(1, (age - repos) / MONTEE_ANNONCE);
  const doux = 1 - (1 - u) * (1 - u) * (1 - u);
  return {
    dy: ELAN_ANNONCE * doux,
    echelle: 0.74 + 0.26 * doux + 0.1 * Math.sin(Math.PI * u),
    eclat: Math.min(1, u * 1.6),
  };
}
