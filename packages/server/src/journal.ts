/**
 * Journal de partie : ce qu'il faut garder pour rejouer une soirée.
 *
 * La §8 du plan le demandait depuis le début, et `GameSession` tenait déjà la
 * liste ordonnée des commandes acceptées — mais en mémoire seule. Elle
 * disparaissait avec le processus : une partie de deux heures ne laissait
 * strictement rien derrière elle, ni pour la reprendre après un plantage, ni
 * pour mesurer quoi que ce soit.
 *
 * **Pourquoi les commandes et non l'état.** Sérialiser l'état complet aurait
 * demandé de le rendre lisible dans les deux sens — plateau, graphe, mains,
 * pioche — et de refaire ce travail à chaque changement de structure. Le
 * moteur est déterministe et testé comme tel : même graine et mêmes commandes
 * donnent la même partie. Il suffit donc de garder la recette et la suite des
 * gestes, ce qui tient en quelques kilo-octets et ne vieillit pas.
 *
 * **Le format.** Une ligne JSON par événement, l'en-tête d'abord. Ajouter en
 * fin de fichier survit à une coupure : ce qui a été écrit reste lisible,
 * même si la dernière ligne est tronquée. Un unique objet JSON aurait exigé
 * de le refermer proprement, donc de perdre tout le fichier sur un plantage —
 * exactement le cas où l'on en a besoin.
 */

import { appendFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

import type { BoardSize, Command, GameConfig } from '@grandes-colonies/engine';

/** De quoi refabriquer le plateau et la partie à l'identique. */
export interface GameRecipe {
  readonly seed: string;
  readonly playerNames: readonly string[];
  readonly config: GameConfig;
  readonly boardKind?: 'archipelago' | 'disc';
  readonly boardSize?: BoardSize;
}

export interface JournalHeader {
  readonly kind: 'header';
  readonly gameId: string;
  /** Horodatage serveur du lancement, en millisecondes. */
  readonly startedAt: number;
  readonly recipe: GameRecipe;
}

export interface JournalEntry {
  readonly kind: 'command';
  /**
   * Millisecondes écoulées depuis le lancement.
   *
   * Relatif et non absolu : c'est ce qui sert aux métriques — durée d'un
   * cycle, temps passé en commerce, inactivité d'un joueur — et une date
   * absolue aurait obligé chaque lecteur à refaire la soustraction.
   */
  readonly at: number;
  readonly command: Command;
}

/**
 * Le nom que porte un siège, et depuis quand.
 *
 * Les noms ne sont pas des commandes : ils s'attribuent à l'arrivée, hors du
 * moteur, et ne laissaient donc aucune trace. Une partie reprise revenait
 * peuplée de « Joueur 1 » — techniquement la même partie, mais plus celle de
 * personne. On les journalise à part, et le rejeu les repose.
 */
export interface JournalSeat {
  readonly kind: 'seat';
  readonly at: number;
  readonly playerId: string;
  readonly name: string;
}

export type JournalLine = JournalHeader | JournalEntry | JournalSeat;

export interface Journal {
  /** D'où il a été lu — pour continuer à y écrire après une reprise. */
  readonly path: string;
  readonly header: JournalHeader;
  readonly entries: readonly JournalEntry[];
  /** Les baptêmes de sièges, dans l'ordre : le dernier fait foi. */
  readonly seats: readonly JournalSeat[];
}

/**
 * Écrit un journal, ligne par ligne, au fil de la partie.
 *
 * Les écritures sont synchrones. C'est délibéré : une partie produit quelques
 * commandes par seconde, de quelques dizaines d'octets, et le coût est sans
 * commune mesure avec celui de perdre la fin d'une soirée parce qu'un tampon
 * n'avait pas été vidé.
 */
export class JournalWriter {
  private readonly startedAt: number;

  /**
   * `reprise` vraie n'écrit pas d'en-tête : le fichier en a déjà un, et un
   * second au milieu ferait perdre au lecteur la moitié de la partie.
   */
  constructor(
    private readonly path: string,
    header: Omit<JournalHeader, 'kind'>,
    reprise = false,
  ) {
    this.startedAt = header.startedAt;
    mkdirSync(dirname(path), { recursive: true });
    if (!reprise) this.write({ kind: 'header', ...header });
  }

  /**
   * Reprend l'écriture d'un journal existant.
   *
   * Une partie relancée après un plantage doit continuer **le même** fichier.
   * En ouvrir un second n'aurait gardé que les commandes postérieures à la
   * reprise : rejoué seul il aurait sauté tout le début, et l'origine des
   * horodatages aurait glissé au passage.
   */
  static continuing(journal: Journal): JournalWriter {
    return new JournalWriter(journal.path, journal.header, true);
  }

  /** Journalise une commande acceptée. */
  append(command: Command, at: number): void {
    this.write({ kind: 'command', at: at - this.startedAt, command });
  }

  /** Journalise le nom que prend un siège. */
  seat(playerId: string, name: string, at: number): void {
    this.write({ kind: 'seat', at: at - this.startedAt, playerId, name });
  }

  private write(line: JournalLine): void {
    appendFileSync(this.path, `${JSON.stringify(line)}\n`, 'utf8');
  }
}

/**
 * Relit un journal.
 *
 * Une ligne illisible est ignorée plutôt que fatale : c'est très exactement
 * ce que laisse une coupure de courant en fin de fichier, et refuser de
 * charger la partie pour sa dernière ligne tronquée reviendrait à jeter les
 * deux heures qui précèdent.
 */
export function readJournal(path: string): Journal | undefined {
  if (!existsSync(path)) return undefined;

  let header: JournalHeader | undefined;
  const entries: JournalEntry[] = [];
  const seats: JournalSeat[] = [];

  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    if (raw.trim() === '') continue;
    let line: JournalLine;
    try {
      line = JSON.parse(raw) as JournalLine;
    } catch {
      continue;
    }
    if (line.kind === 'header') header = line;
    else if (line.kind === 'command') entries.push(line);
    else if (line.kind === 'seat') seats.push(line);
  }

  return header ? { path, header, entries, seats } : undefined;
}

