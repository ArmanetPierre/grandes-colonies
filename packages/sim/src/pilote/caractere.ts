/**
 * Les caractères — ce qui distingue un adversaire d'un autre.
 *
 * Un bot n'a pas besoin d'être imprévisible pour être intéressant : il a
 * besoin d'être **reconnaissable**. Quand douze adversaires jouent la même
 * table, ce qui rend la soirée vivante n'est pas qu'ils jouent bien, c'est
 * qu'on apprenne au bout de trois cycles que celui-ci construit sans jamais
 * échanger, que celle-là propose tout le temps, et que le troisième met son
 * voleur sur le meneur — c'est-à-dire sur vous, dès que vous passez devant.
 *
 * Un caractère est donc un jeu de **poids**, pas un jeu de règles. Il ne
 * décide de rien tout seul : il incline chaque évaluation, et c'est le
 * niveau (voir `niveau.ts`) qui décide de la finesse avec laquelle ces
 * inclinaisons sont mises en œuvre. Les deux axes sont indépendants à
 * dessein — un corsaire débutant et un corsaire redoutable veulent la même
 * chose, mais l'un s'y prend mal.
 *
 * Toutes les valeurs vont de 0 à 1, et 0,5 est la neutralité. Un poids ne
 * multiplie jamais un coup jusqu'à l'exclure : un bâtisseur commerce quand
 * il n'a plus rien d'autre, sinon il resterait bloqué à contempler ses
 * quatre bois.
 */

/** Ce qu'un caractère veut, sur huit axes. */
export interface Traits {
  /** Colonies et routes : occuper le terrain avant les autres. */
  readonly expansion: number;
  /** Villes, métropoles, monument : concentrer plutôt qu'étendre. */
  readonly developpement: number;
  /** Fréquence des offres proposées, et générosité de leur taux. */
  readonly commerce: number;
  /** Voleur sur le meneur, chevaliers, emplacements disputés. */
  readonly agression: number;
  /** Appétit pour la pioche — le pari à trois ressources. */
  readonly cartes: number;
  /** Routes maritimes, îles voisines, ports. */
  readonly marine: number;
  /** Garder une main courte, redouter le sept, ne pas se découvrir. */
  readonly prudence: number;
  /** Attendre le gros coup plutôt que dépenser dès que c'est payable. */
  readonly patience: number;
}

export const CARACTERE_IDS = [
  'batisseur', 'marchand', 'corsaire', 'navigateur', 'erudit', 'prudent',
] as const;

export type CaractereId = (typeof CARACTERE_IDS)[number];

export interface Caractere {
  readonly id: CaractereId;
  /** Le nom qu'on lit dans la liste des joueurs. */
  readonly nom: string;
  /**
   * Le mot accolé au prénom du bot, entre parenthèses.
   *
   * Un nom commun et non un adjectif : « Ariane (négoce) » se lit sans
   * genre, alors que « la marchande » impose d'en choisir un pour douze
   * prénoms tirés d'une liste.
   */
  readonly etiquette: string;
  /** Une phrase, pour l'écran de l'hôte et la documentation. */
  readonly description: string;
  readonly traits: Traits;
}

const NEUTRE: Traits = Object.freeze({
  expansion: 0.5, developpement: 0.5, commerce: 0.5, agression: 0.5,
  cartes: 0.5, marine: 0.5, prudence: 0.5, patience: 0.5,
});

/** Un caractère, décrit par ce qui s'écarte de la neutralité. */
function caractere(
  id: CaractereId, nom: string, etiquette: string, description: string, traits: Partial<Traits>,
): Caractere {
  return Object.freeze({ id, nom, etiquette, description, traits: Object.freeze({ ...NEUTRE, ...traits }) });
}

export const CARACTERES: Readonly<Record<CaractereId, Caractere>> = Object.freeze({
  batisseur: caractere(
    'batisseur', 'Bâtisseur', 'bâtisse',
    'Prend le terrain tôt et le garde : colonies, routes, puis villes.',
    { expansion: 0.9, developpement: 0.7, commerce: 0.4, cartes: 0.25, patience: 0.3 },
  ),
  marchand: caractere(
    'marchand', 'Marchand', 'négoce',
    'Propose sans arrêt, occupe les ports, et vit du cours plutôt que des dés.',
    { commerce: 0.95, expansion: 0.55, agression: 0.25, marine: 0.65, prudence: 0.6, patience: 0.4 },
  ),
  corsaire: caractere(
    'corsaire', 'Corsaire', 'abordage',
    'Chevaliers, voleur sur le meneur, et les emplacements qu’un autre convoitait.',
    { agression: 0.95, cartes: 0.7, expansion: 0.6, commerce: 0.3, prudence: 0.25, marine: 0.6 },
  ),
  navigateur: caractere(
    'navigateur', 'Navigateur', 'voile',
    'Quitte l’île centrale tôt, quitte à y laisser un tour d’avance.',
    { marine: 0.95, expansion: 0.75, developpement: 0.4, commerce: 0.6, patience: 0.35 },
  ),
  erudit: caractere(
    'erudit', 'Érudit', 'étude',
    'Achète des cartes, vise le monument et la métropole, et attend son heure.',
    { cartes: 0.9, developpement: 0.85, patience: 0.8, expansion: 0.35, commerce: 0.5 },
  ),
  prudent: caractere(
    'prudent', 'Prudent', 'prudence',
    'Ne garde jamais dix cartes, préfère une ville sûre à une colonie exposée.',
    { prudence: 0.95, developpement: 0.7, expansion: 0.4, agression: 0.2, commerce: 0.55, patience: 0.6 },
  ),
});

export function estCaractere(valeur: unknown): valeur is CaractereId {
  return typeof valeur === 'string' && (CARACTERE_IDS as readonly string[]).includes(valeur);
}

/**
 * Le caractère d'un bot, par son rang à la table.
 *
 * Le tour de rôle est volontaire plutôt qu'aléatoire : à six caractères et
 * onze adversaires, il garantit qu'aucun ne manque et qu'aucun ne soit là
 * cinq fois. Une table où quatre corsaires se disputent le même voleur ne
 * ressemble à rien.
 */
export function caractereDe(index: number, choisi?: CaractereId | 'varie'): Caractere {
  if (choisi !== undefined && choisi !== 'varie') return CARACTERES[choisi];
  const id = CARACTERE_IDS[((index % CARACTERE_IDS.length) + CARACTERE_IDS.length) % CARACTERE_IDS.length];
  return CARACTERES[id ?? 'batisseur'];
}
