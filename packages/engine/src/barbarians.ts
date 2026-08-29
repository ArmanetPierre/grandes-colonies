/**
 * Les barbares — §16 du game design.
 *
 * Une piste de menace avance à chaque cycle. Arrivée au bout, les barbares
 * attaquent, et toute la table est concernée d'un coup.
 *
 * **La menace est collective, les récompenses individuelles.** C'est toute
 * l'idée, reprise de Cities & Knights : la force des barbares dépend de ce que
 * la table a bâti — plus elle est riche, plus elle attire — mais la défense se
 * paie en chevaliers, individuellement. Un joueur qui ne joue aucun chevalier
 * profite de la protection des autres jusqu'au jour où l'attaque passe, et
 * c'est alors lui qui paie.
 *
 * **Pourquoi les cités et non les points.** La force suit le nombre de cités
 * et de métropoles, pas le score : un joueur peut mener aux points par ses
 * routes, ses titres ou son objectif secret sans avoir rien bâti qui se
 * pille. Ce sont les villes qui appellent l'invasion, et ce sont elles qu'on
 * perd.
 */

import type { Board, PlayerId } from './board/board.js';

export interface BarbarianConfig {
  /** Cycles entre deux avancées de la piste. */
  readonly cyclesPerStep: number;
  /** Cases de la piste. Arrivé au bout, les barbares attaquent. */
  readonly trackLength: number;
  /** Force apportée par chaque cité adverse. */
  readonly strengthPerCity: number;
  /** Force apportée par chaque métropole — elles sont plus grasses. */
  readonly strengthPerMetropolis: number;
  /** Défense apportée par chaque chevalier joué. */
  readonly defencePerKnight: number;
}

/**
 * Réglage par défaut, calibré pour qu'une invasion soit un événement et non
 * une routine : à cinq cycles par case et huit cases, une table de douze
 * joueurs voit les barbares environ tous les trois tours de table.
 */
export const GRAND_COLONIES_BARBARIANS: BarbarianConfig = Object.freeze({
  cyclesPerStep: 5,
  trackLength: 8,
  strengthPerCity: 1,
  strengthPerMetropolis: 2,
  defencePerKnight: 1,
});

export interface BarbarianState {
  /** Position sur la piste, de zéro à `trackLength`. */
  progress: number;
  /** Invasions déjà survenues — sert aux métriques et à l'affichage. */
  attacks: number;
  /** Cycle de la dernière avancée, pour ne pas avancer deux fois. */
  lastStepCycle: number;
}

export function initialBarbarians(): BarbarianState {
  return { progress: 0, attacks: 0, lastStepCycle: 0 };
}

/** Ce qu'une table a bâti de pillable. */
export function barbarianStrength(
  board: Board,
  config: BarbarianConfig,
): number {
  let strength = 0;
  for (const [, building] of board.allBuildings()) {
    if (building.kind === 'city') strength += config.strengthPerCity;
    else if (building.kind === 'metropolis') strength += config.strengthPerMetropolis;
  }
  return strength;
}

/** Ce que chaque joueur apporte à la défense commune. */
export function defenceOf(knightsPlayed: number, config: BarbarianConfig): number {
  return knightsPlayed * config.defencePerKnight;
}

export interface Invasion {
  readonly strength: number;
  readonly defence: number;
  readonly repelled: boolean;
  /**
   * Le meilleur défenseur — il reçoit le jeton « Défenseur de Catan ».
   *
   * Absent quand personne n'a joué le moindre chevalier : récompenser un zéro
   * partagé n'aurait aucun sens, et le tirer au sort récompenserait le hasard.
   */
  readonly champion: PlayerId | undefined;
  /**
   * Le plus faible défenseur — il perd une cité, mais seulement si l'attaque
   * passe. Absent quand personne n'a de cité à perdre.
   */
  readonly weakest: PlayerId | undefined;
}

/**
 * Résout une invasion.
 *
 * Les égalités sont tranchées par l'ordre des joueurs plutôt que par le
 * hasard : le tirage rendrait la partie irrejouable depuis son journal, et
 * c'est tout ce qui permet de la restaurer.
 */
export function resolveInvasion(
  strength: number,
  defences: ReadonlyMap<PlayerId, number>,
  hasCity: (player: PlayerId) => boolean,
): Invasion {
  const entries = [...defences.entries()];
  const total = entries.reduce((sum, [, d]) => sum + d, 0);
  const repelled = total >= strength;

  // Le champion : la plus forte défense, et strictement positive.
  let champion: PlayerId | undefined;
  let best = 0;
  for (const [player, defence] of entries) {
    if (defence > best) { best = defence; champion = player; }
  }

  // Le maillon faible : la plus petite défense parmi ceux qui ont une cité à
  // perdre. Chercher parmi tous aurait désigné un joueur sans cité, et
  // l'attaque n'aurait alors coûté à personne.
  let weakest: PlayerId | undefined;
  let worst = Number.POSITIVE_INFINITY;
  for (const [player, defence] of entries) {
    if (!hasCity(player)) continue;
    if (defence < worst) { worst = defence; weakest = player; }
  }

  return { strength, defence: total, repelled, champion, weakest };
}
