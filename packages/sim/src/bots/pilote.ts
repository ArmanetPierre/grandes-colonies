/**
 * Le pilote, branché sur le simulateur.
 *
 * Le simulateur travaille sur `GameState` — l'état complet, celui que le
 * serveur seul possède. Les pilotes, eux, ne savent lire que les deux vues
 * d'un joueur. L'adaptateur fait la conversion, et ce sens-là est le bon :
 * on **restreint** ce que le bot voit avant de le laisser décider.
 *
 * C'est ce qui donne sa valeur à la mesure. Ce qu'on éprouve en dix mille
 * parties simulées n'est pas un cousin des adversaires de la soirée, c'est
 * exactement eux — même code, même information, mêmes erreurs.
 */

import type { Command, GameState, PlayerId } from '@grand-colonies/engine';
import { privateView, publicView } from '@grand-colonies/protocol';

import type { Bot } from '../bot.js';
import { type Caractere, type CaractereId, CARACTERES, caractereDe, estCaractere } from '../pilote/caractere.js';
import { type Niveau, niveauDe } from '../pilote/niveau.js';
import { Pilote } from '../pilote/pilote.js';

export interface PiloteBotOptions {
  readonly niveau?: unknown;
  /** Un caractère imposé, par son identifiant ou en entier. Sinon, par rang. */
  readonly caractere?: CaractereId | Caractere;
  readonly graine?: string;
  /**
   * Le bot clôt-il lui-même ses tours ?
   *
   * Faux par défaut : le simulateur ferme tours et cycles lui-même, et deux
   * clôtures pour un tour font échouer la seconde à chaque fois.
   */
  readonly conclut?: boolean;
}

/** Un adversaire complet, vu comme un `Bot` de simulation. */
export class PiloteBot implements Bot {
  readonly name: string;
  readonly caractere: Caractere;
  readonly niveau: Niveau;
  private readonly pilote: Pilote;

  constructor(index: number, options: PiloteBotOptions = {}) {
    this.caractere = options.caractere === undefined
      ? caractereDe(index)
      : estCaractere(options.caractere) ? CARACTERES[options.caractere] : options.caractere;
    this.niveau = niveauDe(options.niveau);
    this.name = `${this.caractere.id}-${this.niveau.id}`;
    this.pilote = new Pilote({
      niveau: this.niveau,
      caractere: this.caractere,
      graine: `${options.graine ?? 'sim'}:${index}:${this.caractere.id}`,
      conclut: options.conclut ?? false,
    });
  }

  decide(state: GameState, playerId: PlayerId, actionId: string): Command | undefined {
    const moi = privateView(state, playerId);
    if (!moi) return undefined;

    const coup = this.pilote.decider(publicView(state), moi);
    if (coup === undefined) return undefined;

    return { ...coup, actionId, playerId } as Command;
  }
}
