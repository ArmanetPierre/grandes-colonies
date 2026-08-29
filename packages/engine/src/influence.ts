/**
 * L'Influence — §17 du game design.
 *
 * Cinquième statistique du jeu, à côté des points, des ressources, des
 * chevaliers et des routes. Elle représente le poids politique d'un joueur :
 * pouvoir, réputation, puissance commerciale.
 *
 * **Elle ne rapporte pas de points.** C'est ce qui la distingue de tout le
 * reste du barème, et c'est délibéré : une statistique qui donnerait des
 * points serait une seconde piste de victoire, et le §22 n'en prévoit qu'une.
 * L'Influence sert à *trancher* — qui construit sur l'emplacement que deux
 * joueurs convoitent — et c'est bien assez pour qu'on la veuille.
 *
 * **Ce qui en donne, aujourd'hui.** Le port royal, qu'on occupe. La défense
 * contre les barbares, qu'on paie en chevaliers. L'objectif secret, qu'on
 * accomplit. Le game design cite aussi les comptoirs : leur coût existe
 * (`BUILD_COSTS.tradingPost`) mais rien ne les construit encore, et les
 * inventer ici aurait fait dépendre l'Influence d'un bâtiment qui n'existe
 * pas. La table est écrite pour qu'ils s'y ajoutent en une ligne.
 */

import type { Board, PlayerId } from './board/board.js';
import { hasPort } from './ports.js';

/**
 * Ce que rapporte chaque source, en points d'Influence.
 *
 * Le port royal vaut double : il ne se prend qu'une fois, il est unique sur
 * le plateau, et il exige d'aller poser une colonie sur une côte précise —
 * ce qui coûte bien plus qu'un chevalier joué.
 */
export interface InfluenceConfig {
  readonly royalPort: number;
  readonly barbarianDefence: number;
  readonly secretObjective: number;
  readonly tradingPost: number;
  /** Pénalité pour un contrat rompu (§19). Comptée en négatif. */
  readonly brokenContract: number;
}

export const GRAND_COLONIES_INFLUENCE: InfluenceConfig = Object.freeze({
  royalPort: 2,
  barbarianDefence: 1,
  secretObjective: 1,
  tradingPost: 1,
  brokenContract: 2,
});

/** Ce que l'Influence d'un joueur doit à chacune de ses sources. */
export interface InfluenceBreakdown {
  readonly royalPorts: number;
  readonly barbarianDefences: number;
  readonly secretObjectives: number;
  readonly tradingPosts: number;
  readonly brokenContracts: number;
  readonly total: number;
}

/** Ce que le plateau ne peut pas dire de lui-même. */
export interface InfluenceExtras {
  /** Jetons de défense gagnés contre les barbares. */
  readonly barbarianDefences?: number;
  readonly secretObjectivesCompleted?: number;
  readonly tradingPosts?: number;
  readonly brokenContracts?: number;
}

/**
 * L'Influence d'un joueur, recalculée depuis ses sources.
 *
 * Dérivée et non accumulée, comme les points de victoire : un compteur
 * incrémenté à chaque événement finit par diverger de la réalité dès qu'une
 * cité change de main ou qu'une partie est rejouée depuis son journal.
 */
export function influenceOf(
  board: Board,
  player: PlayerId,
  config: InfluenceConfig,
  extras: InfluenceExtras = {},
): InfluenceBreakdown {
  // Le port royal est unique sur le plateau : on le tient ou non.
  const royal = hasPort(board, player, 'royal') ? 1 : 0;
  const defences = extras.barbarianDefences ?? 0;
  const objectives = extras.secretObjectivesCompleted ?? 0;
  const posts = extras.tradingPosts ?? 0;
  const broken = extras.brokenContracts ?? 0;

  const royalPorts = royal * config.royalPort;
  const barbarianDefences = defences * config.barbarianDefence;
  const secretObjectives = objectives * config.secretObjective;
  const tradingPosts = posts * config.tradingPost;
  const brokenContracts = broken * config.brokenContract;

  return {
    royalPorts,
    barbarianDefences,
    secretObjectives,
    tradingPosts,
    brokenContracts,
    // Jamais négative : un joueur qui rompt tous ses contrats tombe à zéro et
    // n'y va pas plus loin. Une Influence négative n'aurait aucun sens face à
    // un joueur qui n'a simplement rien fait.
    total: Math.max(
      0,
      royalPorts + barbarianDefences + secretObjectives + tradingPosts - brokenContracts,
    ),
  };
}
