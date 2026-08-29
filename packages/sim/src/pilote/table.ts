/**
 * Composer une table d'adversaires.
 *
 * Un seul endroit décide qui est qui, et il sert aux deux mondes : le bot
 * réseau de `scripts/bots.ts` et le simulateur de `runner.ts`. Sans lui, le
 * réglage « niveau 3, caractères variés » aurait deux implémentations, et
 * ce qu'on mesure en simulation cesserait d'être ce qui s'assoit à la table.
 */

import { type Caractere, type CaractereId, caractereDe, estCaractere } from './caractere.js';
import { type Niveau, niveauDe } from './niveau.js';
import { Pilote, type Profil } from './pilote.js';

/** Des noms grecs, pour que la table ait l'air d'une table. */
export const NOMS = [
  'Ariane', 'Démétrios', 'Eirène', 'Phaidon', 'Kallisto', 'Lysandre',
  'Myrto', 'Nikandre', 'Xanthippe', 'Sophos', 'Thalassa', 'Zéno',
] as const;

export interface ReglageTable {
  /** Niveau demandé, de 1 à 4. Trois par défaut. */
  readonly niveau?: unknown;
  /** Un caractère imposé à tous, ou `varie` pour les distribuer. */
  readonly caracteres?: CaractereId | 'varie' | undefined;
  /** Graine du hasard, pour rejouer exactement la même table. */
  readonly graine?: string;
  /** Le pilote clôt-il ses tours lui-même ? Vrai en réseau, faux en simulation. */
  readonly conclut?: boolean;
}

export interface Place {
  readonly index: number;
  /** Le nom affiché aux joueurs, caractère compris. */
  readonly nom: string;
  readonly caractere: Caractere;
  readonly niveau: Niveau;
  readonly pilote: Pilote;
}

/**
 * Le nom d'un adversaire, avec son caractère entre parenthèses.
 *
 * On pourrait s'en passer, mais alors douze bots seraient douze prénoms
 * interchangeables. L'étiquette dit en un mot à quoi s'attendre — et
 * connaître son adversaire est la moitié du plaisir d'une négociation.
 */
export function nomDe(index: number, caractere: Caractere, avecEtiquette = true): string {
  const prenom = NOMS[index % NOMS.length] ?? `Bot ${index + 1}`;
  // Au-delà de douze, on numérote : deux « Ariane » à la même table seraient
  // impossibles à distinguer dans une négociation.
  const suffixe = index >= NOMS.length ? ` ${Math.floor(index / NOMS.length) + 1}` : '';
  return avecEtiquette ? `${prenom}${suffixe} (${caractere.etiquette})` : `${prenom}${suffixe}`;
}

/** Les places d'une table de `combien` adversaires. */
export function composerLaTable(combien: number, reglage: ReglageTable = {}): Place[] {
  const niveau = niveauDe(reglage.niveau);
  const impose = estCaractere(reglage.caracteres) ? reglage.caracteres : 'varie';
  const graine = reglage.graine ?? 'table';

  return Array.from({ length: Math.max(0, Math.round(combien)) }, (_, index) => {
    const caractere = caractereDe(index, impose);
    const profil: Profil = {
      niveau,
      caractere,
      graine: `${graine}:${index}:${caractere.id}`,
      conclut: reglage.conclut ?? true,
    };
    return { index, nom: nomDe(index, caractere), caractere, niveau, pilote: new Pilote(profil) };
  });
}
