/**
 * Journal de partie et restauration (§8 du plan).
 *
 * Le test qui compte n'est pas qu'un fichier s'écrive : c'est qu'une partie
 * relue depuis son journal soit **la même partie**. Le moteur est
 * déterministe et testé comme tel ; ce qui restait à prouver, c'est que la
 * recette et la suite des commandes suffisent à le rejouer — donc qu'on n'a
 * rien oublié de ce qu'il fallait conserver.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Command } from '@grandes-colonies/engine';

import { JournalWriter, readJournal } from '../src/journal.js';
import { GameSession, restoreSession } from '../src/session.js';

function clock(start = 0) {
  let time = start;
  return { now: () => time, advance: (ms: number) => { time += ms; } };
}

const dossier = (): string => mkdtempSync(join(tmpdir(), 'gc-journal-'));

/** Une partie menée assez loin pour que le rejeu ait quelque chose à prouver. */
function partieJouee(): { session: GameSession; writer: JournalWriter; path: string } {
  const time = clock(1_000);
  const session = new GameSession({
    seed: 'journal', playerNames: ['A', 'B', 'C', 'D'], now: time.now,
  });
  for (const seat of session.allSeats()) session.reconnect(seat.token);
  session.start();

  const path = join(dossier(), 'partie.jsonl');
  const writer = new JournalWriter(path, {
    gameId: 'g1', startedAt: time.now(), recipe: session.recipe,
  });

  // On déroule la partie par expiration du chronomètre : elle avance seule,
  // et tout ce qu'elle joue passe par `submit`, donc est journalisé.
  let n = 0;
  while (session.state.cycle < 3 && n < 400) {
    time.advance(200_000);
    const avant = session.commandLog().length;
    session.tick();
    for (const command of session.commandLog().slice(avant)) writer.append(command, time.now());
    n++;
  }
  return { session, writer, path };
}

/** Une empreinte de l'état : si quoi que ce soit diverge, elle change. */
function empreinte(session: GameSession): string {
  const view = session.publicView();
  return JSON.stringify({
    phase: view.phase,
    cycle: view.cycle,
    active: view.activePlayer,
    roll: view.lastRoll,
    joueurs: view.players.map((p) => [p.id, p.publicPoints, p.handSize, p.hand, p.roadsLeft]),
    batiments: view.buildings,
    routes: view.roads,
    hexes: view.hexes,
    pioche: view.deckRemaining,
  });
}

describe('journal de partie', () => {
  it('écrit un en-tête puis une ligne par commande', () => {
    const { path, session } = partieJouee();
    const lignes = readFileSync(path, 'utf8').trim().split('\n');

    expect(JSON.parse(lignes[0]!).kind).toBe('header');
    expect(lignes.length).toBe(session.commandLog().length + 1);
    for (const ligne of lignes.slice(1)) {
      expect(JSON.parse(ligne).kind).toBe('command');
    }
  });

  it('conserve tout ce qu il faut pour refabriquer le plateau', () => {
    const { path } = partieJouee();
    const journal = readJournal(path)!;

    expect(journal.header.recipe.seed).toBe('journal');
    expect(journal.header.recipe.playerNames).toEqual(['A', 'B', 'C', 'D']);
    expect(journal.header.recipe.config).toBeDefined();
  });

  /** Les horodatages sont relatifs : c'est ce dont les métriques ont besoin. */
  it('horodate chaque commande depuis le lancement', () => {
    const { path } = partieJouee();
    const { entries } = readJournal(path)!;

    expect(entries[0]!.at).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.at).toBeGreaterThanOrEqual(entries[i - 1]!.at);
    }
  });

  /**
   * Une coupure de courant tronque la dernière ligne. Refuser de charger la
   * partie pour cette seule ligne reviendrait à jeter les deux heures qui
   * précèdent — exactement le cas où l'on a besoin du journal.
   */
  it('relit un fichier dont la fin a été coupée', () => {
    const { path } = partieJouee();
    const complet = readJournal(path)!;

    const brut = readFileSync(path, 'utf8');
    const tronque = join(dossier(), 'coupe.jsonl');
    writeFileSync(tronque, brut.slice(0, brut.length - 12));

    const relu = readJournal(tronque)!;
    expect(relu.header).toEqual(complet.header);
    expect(relu.entries.length).toBe(complet.entries.length - 1);
  });

  it('ne rend rien pour un fichier absent', () => {
    expect(readJournal(join(dossier(), 'jamais-ecrit.jsonl'))).toBeUndefined();
  });
});

describe('restauration', () => {
  /**
   * Le test central : la partie relue est la même partie.
   *
   * L'empreinte couvre le plateau, les constructions, les mains, la pioche et
   * le tour courant. Si la recette omettait quoi que ce soit — la graine, la
   * taille des terres, la configuration — elle divergerait.
   */
  it('rejoue une partie à l identique', () => {
    const { session, path } = partieJouee();
    const journal = readJournal(path)!;

    const restaure = restoreSession(journal);
    expect(restaure.ok).toBe(true);
    if (!restaure.ok) return;

    expect(empreinte(restaure.session)).toBe(empreinte(session));
    expect(restaure.session.commandLog()).toEqual(session.commandLog());
  });

  /**
   * Les noms survivent, et c'est loin d'être cosmétique.
   *
   * Ils ne passent pas par le moteur — on se baptise en rejoignant, pas en
   * jouant — donc rien ne les journalisait. La partie revenait techniquement
   * intacte et peuplée de « Joueur 1 » : la même partie, mais plus celle de
   * personne.
   */
  it('rend à chaque siège le nom qu il portait', () => {
    const { session, path } = partieJouee();
    session.renameSeat('p1', 'Ariane');
    session.renameSeat('p3', 'Eirène');

    const journal = readJournal(path)!;
    const avec = {
      ...journal,
      seats: [
        { kind: 'seat' as const, at: 1, playerId: 'p1', name: 'Ariane' },
        { kind: 'seat' as const, at: 2, playerId: 'p3', name: 'Eirène' },
      ],
    };

    const restaure = restoreSession(avec);
    expect(restaure.ok).toBe(true);
    if (!restaure.ok) return;

    expect(restaure.session.publicView().players.map((p) => p.name))
      .toEqual(session.publicView().players.map((p) => p.name));
    expect(restaure.session.seatOf('p1')?.name).toBe('Ariane');
  });

  /** Le dernier baptême l'emporte : un joueur peut se renommer en cours de route. */
  it('garde le dernier nom quand un siège en a porté plusieurs', () => {
    const { path } = partieJouee();
    const journal = readJournal(path)!;
    const restaure = restoreSession({
      ...journal,
      seats: [
        { kind: 'seat' as const, at: 1, playerId: 'p2', name: 'Premier' },
        { kind: 'seat' as const, at: 9, playerId: 'p2', name: 'Second' },
      ],
    });
    expect(restaure.ok).toBe(true);
    if (restaure.ok) expect(restaure.session.seatOf('p2')?.name).toBe('Second');
  });

  it('reprend une partie qui n a pas dépassé la mise en place', () => {
    const time = clock(500);
    const session = new GameSession({
      seed: 'court', playerNames: ['A', 'B', 'C', 'D'], now: time.now,
    });
    session.start();
    const path = join(dossier(), 'court.jsonl');
    new JournalWriter(path, { gameId: 'g2', startedAt: time.now(), recipe: session.recipe });

    const restaure = restoreSession(readJournal(path)!);
    expect(restaure.ok).toBe(true);
    if (restaure.ok) expect(restaure.session.state.phase).toBe('setup');
  });

  /**
   * Une divergence doit s'arrêter net et se dire.
   *
   * Poursuivre donnerait un état qui ne correspond plus à la partie qu'on
   * croit avoir rechargée, sans que rien à l'écran ne le signale.
   */
  it('s arrête sur la première commande refusée, et dit laquelle', () => {
    const { path } = partieJouee();
    const journal = readJournal(path)!;

    const faux: Command = { type: 'ROLL_DICE', playerId: 'p3', actionId: 'intrus' } as Command;
    const abime = {
      path: journal.path,
      seats: journal.seats,
      header: journal.header,
      entries: [...journal.entries.slice(0, 3), { kind: 'command' as const, at: 1, command: faux }],
    };

    const restaure = restoreSession(abime);
    expect(restaure.ok).toBe(false);
    if (!restaure.ok) {
      expect(restaure.at).toBe(3);
      expect(restaure.command.actionId).toBe('intrus');
    }
  });
});
