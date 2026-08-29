/**
 * Métriques de playtest — Phase 8 du plan.
 *
 * « Chaque vraie partie LAN doit produire automatiquement des métriques. »
 * Elle en produit désormais une, complète : son journal. Ce module le relit et
 * en tire les chiffres que le plan demande.
 *
 * **Pourquoi relire plutôt que compter en direct.** Un compteur incrémenté
 * pendant la partie ne mesure que ce qu'on avait pensé à mesurer le jour où on
 * l'a posé. Le journal, lui, garde tout : une question nouvelle — « combien de
 * temps entre l'annonce et sa résolution ? » — se répond après coup, sur les
 * parties déjà jouées, sans avoir rien instrumenté à l'avance.
 *
 * **Ce qui manque, et pourquoi.** Le journal ne retient que les commandes
 * *acceptées*. Les actions invalides et les déconnexions n'y sont pas : les
 * premières ne changent pas l'état, les secondes n'en sont pas. Les compter
 * demanderait de les y écrire, ce qui alourdirait chaque partie pour une
 * mesure dont on n'a pas encore l'usage. Le plan les liste ; elles attendent
 * qu'on en ait besoin.
 */

import type { Command } from '@grand-colonies/engine';

import type { Journal } from './journal.js';

/** Ce qu'on mesure pour un joueur. */
export interface PlayerMetrics {
  readonly player: string;
  readonly commands: number;
  /** Tours joués d'office par le serveur, faute de réponse. */
  readonly timeouts: number;
  readonly tradesOffered: number;
  readonly tradesAccepted: number;
  readonly buildsDeclared: number;
  /**
   * Plus longue attente entre deux de ses gestes, en millisecondes.
   *
   * C'est **la** mesure du plan : « le joueur a-t-il eu l'impression de jouer
   * régulièrement ? ». Un total d'inactivité ne dirait rien — à douze joueurs
   * on attend forcément beaucoup — alors que la plus longue attente dit
   * précisément le moment où quelqu'un a décroché.
   */
  readonly longestSilenceMs: number;
  readonly averageGapMs: number;
}

export interface CycleMetrics {
  readonly cycle: number;
  readonly durationMs: number;
  readonly commands: number;
}

export interface GameMetrics {
  readonly gameId: string;
  readonly playerCount: number;
  readonly totalMs: number;
  readonly commands: number;
  readonly cycles: readonly CycleMetrics[];
  /** Durée médiane d'un cycle — plus robuste que la moyenne aux pauses. */
  readonly medianCycleMs: number;
  readonly players: readonly PlayerMetrics[];
  readonly tradesOffered: number;
  readonly tradesAccepted: number;
  /** Annonces de construction, et celles qui ont perdu leur emplacement. */
  readonly buildsDeclared: number;
  readonly buildsCancelled: number;
  /** Tours joués d'office, toutes places confondues. */
  readonly timeouts: number;
  /** Interventions du maître de jeu — une partie truquée n'est pas une mesure. */
  readonly hostInterventions: number;
}

/** Un tour joué d'office porte un identifiant préfixé par la session. */
const isTimeout = (command: Command): boolean => command.actionId.startsWith('sys-');

const median = (values: readonly number[]): number => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
};

/** Lit un journal et en tire les mesures du plan. */
export function measure(journal: Journal): GameMetrics {
  const { header, entries } = journal;
  const players = header.recipe.playerNames.map((_, i) => `p${i + 1}`);

  const perPlayer = new Map(players.map((id) => [id, {
    player: id,
    commands: 0,
    timeouts: 0,
    tradesOffered: 0,
    tradesAccepted: 0,
    buildsDeclared: 0,
    lastAt: 0,
    longestSilenceMs: 0,
    gaps: [] as number[],
  }]));

  const cycles: CycleMetrics[] = [];
  let cycle = 0;
  let cycleStart = 0;
  let cycleCommands = 0;

  let tradesOffered = 0;
  let tradesAccepted = 0;
  let buildsDeclared = 0;
  let buildsCancelled = 0;
  let timeouts = 0;
  let hostInterventions = 0;

  for (const entry of entries) {
    const { command, at } = entry;

    if (command.type === 'CREATE_TRADE') tradesOffered++;
    if (command.type === 'ACCEPT_TRADE') tradesAccepted++;
    if (command.type === 'DECLARE_BUILD') buildsDeclared++;
    if (command.type === 'CANCEL_BUILD') buildsCancelled++;
    if (command.type.startsWith('GM_')) hostInterventions++;
    if (isTimeout(command)) timeouts++;

    // Un cycle se ferme sur `END_CYCLE` : c'est la seule commande qui le
    // marque à coup sûr, qu'elle vienne d'un joueur ou du chronomètre.
    if (command.type === 'END_CYCLE') {
      cycles.push({ cycle, durationMs: at - cycleStart, commands: cycleCommands });
      cycle++;
      cycleStart = at;
      cycleCommands = 0;
    } else {
      cycleCommands++;
    }

    const stats = perPlayer.get(command.playerId);
    if (!stats) continue;

    stats.commands++;
    if (isTimeout(command)) stats.timeouts++;
    if (command.type === 'CREATE_TRADE') stats.tradesOffered++;
    if (command.type === 'ACCEPT_TRADE') stats.tradesAccepted++;
    if (command.type === 'DECLARE_BUILD') stats.buildsDeclared++;

    const gap = at - stats.lastAt;
    stats.gaps.push(gap);
    if (gap > stats.longestSilenceMs) stats.longestSilenceMs = gap;
    stats.lastAt = at;
  }

  const totalMs = entries.length === 0 ? 0 : (entries[entries.length - 1]?.at ?? 0);

  return {
    gameId: header.gameId,
    playerCount: players.length,
    totalMs,
    commands: entries.length,
    cycles,
    medianCycleMs: median(cycles.map((c) => c.durationMs)),
    tradesOffered,
    tradesAccepted,
    buildsDeclared,
    buildsCancelled,
    timeouts,
    hostInterventions,
    players: [...perPlayer.values()].map((s) => ({
      player: s.player,
      commands: s.commands,
      timeouts: s.timeouts,
      tradesOffered: s.tradesOffered,
      tradesAccepted: s.tradesAccepted,
      buildsDeclared: s.buildsDeclared,
      longestSilenceMs: s.longestSilenceMs,
      averageGapMs: s.gaps.length === 0
        ? 0
        : s.gaps.reduce((sum, g) => sum + g, 0) / s.gaps.length,
    })),
  };
}
