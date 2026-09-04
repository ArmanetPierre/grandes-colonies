/**
 * Métriques de playtest (Phase 8).
 *
 * Elles servent à confronter les impressions des joueurs aux chiffres : « j'ai
 * eu l'impression d'attendre » se vérifie sur la plus longue attente, et non
 * sur un souvenir. Ces tests vérifient donc surtout que les chiffres disent
 * bien ce qu'on croit qu'ils disent.
 */

import { describe, expect, it } from 'vitest';

import type { Command } from '@grandes-colonies/engine';

import type { Journal, JournalEntry } from '../src/journal.js';
import { measure } from '../src/metrics.js';

const cmd = (type: string, playerId: string, actionId: string): Command =>
  ({ type, playerId, actionId } as Command);

function journal(entries: readonly { at: number; command: Command }[]): Journal {
  return {
    path: '/nulle-part.jsonl',
    header: {
      kind: 'header',
      gameId: 'g1',
      startedAt: 0,
      recipe: {
        seed: 'm',
        playerNames: ['A', 'B', 'C'],
        config: {} as never,
      },
    },
    seats: [],
    entries: entries.map((e) => ({ kind: 'command', ...e })) as JournalEntry[],
  };
}

describe('mesures d une partie', () => {
  it('ne s effondre pas sur un journal vide', () => {
    const m = measure(journal([]));
    expect(m.commands).toBe(0);
    expect(m.totalMs).toBe(0);
    expect(m.cycles).toEqual([]);
    expect(m.players).toHaveLength(3);
  });

  it('découpe les cycles sur les fins de cycle', () => {
    const m = measure(journal([
      { at: 1_000, command: cmd('ROLL_DICE', 'p1', 'a1') },
      { at: 30_000, command: cmd('END_CYCLE', 'p1', 'a2') },
      { at: 35_000, command: cmd('ROLL_DICE', 'p2', 'a3') },
      { at: 90_000, command: cmd('END_CYCLE', 'p2', 'a4') },
    ]));

    expect(m.cycles).toHaveLength(2);
    expect(m.cycles[0]?.durationMs).toBe(30_000);
    expect(m.cycles[1]?.durationMs).toBe(60_000);
    expect(m.medianCycleMs).toBe(45_000);
  });

  it('compte les échanges proposés et acceptés', () => {
    const m = measure(journal([
      { at: 1, command: cmd('CREATE_TRADE', 'p1', 'a1') },
      { at: 2, command: cmd('CREATE_TRADE', 'p2', 'a2') },
      { at: 3, command: cmd('ACCEPT_TRADE', 'p3', 'a3') },
    ]));
    expect(m.tradesOffered).toBe(2);
    expect(m.tradesAccepted).toBe(1);
  });

  /**
   * Un tour joué d'office porte un identifiant préfixé : c'est ce qui
   * distingue une table qui joue d'une table qui subit le chronomètre.
   */
  it('distingue les tours joués d office', () => {
    const m = measure(journal([
      { at: 1, command: cmd('ROLL_DICE', 'p1', 'sys-1') },
      { at: 2, command: cmd('ROLL_DICE', 'p2', 'humain') },
    ]));
    expect(m.timeouts).toBe(1);
    expect(m.players.find((p) => p.player === 'p1')?.timeouts).toBe(1);
    expect(m.players.find((p) => p.player === 'p2')?.timeouts).toBe(0);
  });

  /**
   * La mesure du plan : « le joueur a-t-il eu l'impression de jouer
   * régulièrement ? ». Un total d'inactivité ne dirait rien — à douze joueurs
   * on attend forcément — alors que la plus longue attente dit le moment
   * précis où quelqu'un a décroché.
   */
  it('retient la plus longue attente de chaque joueur', () => {
    const m = measure(journal([
      { at: 10_000, command: cmd('ROLL_DICE', 'p1', 'a1') },
      { at: 12_000, command: cmd('ROLL_DICE', 'p1', 'a2') },
      { at: 300_000, command: cmd('ROLL_DICE', 'p1', 'a3') },
    ]));
    const p1 = m.players.find((p) => p.player === 'p1');
    // Trois gestes : à 10 s depuis le début, 2 s après, puis 288 s après.
    expect(p1?.longestSilenceMs).toBe(288_000);
    expect(p1?.commands).toBe(3);
  });

  /** Une partie truquée n'est pas une mesure : il faut que ça se voie. */
  it('signale les interventions du maître de jeu', () => {
    const m = measure(journal([
      { at: 1, command: cmd('GM_GRANT', 'p1', 'gm-0') },
      { at: 2, command: cmd('ROLL_DICE', 'p1', 'a1') },
    ]));
    expect(m.hostInterventions).toBe(1);
  });

  it('ignore un joueur inconnu sans tomber', () => {
    const m = measure(journal([
      { at: 1, command: cmd('ROLL_DICE', 'p99', 'a1') },
    ]));
    expect(m.commands).toBe(1);
    expect(m.players.every((p) => p.commands === 0)).toBe(true);
  });
});
