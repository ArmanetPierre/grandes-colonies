import { describe, expect, it } from 'vitest';

import { privateView, publicView } from '@grand-colonies/protocol';
import { createGame, classicBoard, defaultConfig, SeededRandom } from '@grand-colonies/engine';

import { GreedyBot } from '../src/bots/greedy.js';
import { PiloteBot } from '../src/bots/pilote.js';
import { CARACTERES, CARACTERE_IDS } from '../src/pilote/caractere.js';
import { NIVEAUX, niveauDe } from '../src/pilote/niveau.js';
import { composerLaTable, nomDe } from '../src/pilote/table.js';
import { playGame } from '../src/runner.js';

/**
 * Un duel à sièges alternés : la moitié de la table joue `a`, l'autre `b`.
 *
 * L'alternance n'est pas un détail — l'ordre du tour donne un avantage
 * mesurable, et mettre toujours le même camp en premier suffirait à conclure
 * l'inverse de la vérité.
 */
function duel(
  a: (index: number, graine: string) => PiloteBot | GreedyBot,
  b: (index: number, graine: string) => PiloteBot | GreedyBot,
  parties = 8,
  joueurs = 6,
): { victoiresA: number; victoiresB: number; pointsA: number; pointsB: number } {
  let victoiresA = 0, victoiresB = 0, pointsA = 0, pointsB = 0;

  for (let g = 0; g < parties; g++) {
    const graine = `duel-${g}`;
    const decale = g % 2;
    const partie = playGame({
      playerCount: joueurs,
      seed: graine,
      makeBot: (i) => ((i + decale) % 2 === 0 ? a(i, graine) : b(i, graine)),
    });
    partie.points.forEach((p, i) => { if ((i + decale) % 2 === 0) pointsA += p; else pointsB += p; });
    const gagnant = partie.winner === undefined ? -1 : Number(partie.winner.slice(1)) - 1;
    if (gagnant < 0) continue;
    if ((gagnant + decale) % 2 === 0) victoiresA++; else victoiresB++;
  }

  return { victoiresA, victoiresB, pointsA, pointsB };
}

/**
 * Tests de FORCE des adversaires. Comme ceux d'équilibrage, ils mesurent une
 * propriété statistique plutôt qu'un comportement, et ils échoueront le jour
 * où les niveaux cesseront de se départager — ce qui est exactement le
 * signal qu'on veut : un jeu qui propose quatre niveaux doit pouvoir montrer
 * que le quatrième bat le premier, sinon il propose quatre décors.
 */
describe('niveaux des adversaires', () => {
  it('fait gagner le stratège contre l apprenti', () => {
    const resultat = duel(
      (i, g) => new PiloteBot(i, { niveau: 4, graine: g }),
      (i, g) => new PiloteBot(i, { niveau: 1, graine: g }),
    );

    // Mesuré sur vingt-quatre parties : 19 victoires à 0, et 11,7 points de
    // moyenne contre 3,9. Huit parties suffisent à voir l'écart ; le seuil
    // reste bas pour ne pas transformer du bruit en échec.
    expect(resultat.victoiresA).toBeGreaterThan(resultat.victoiresB);
    expect(resultat.pointsA).toBeGreaterThan(resultat.pointsB * 1.5);
  });

  it('fait gagner le colon contre l apprenti', () => {
    const resultat = duel(
      (i, g) => new PiloteBot(i, { niveau: 2, graine: g }),
      (i, g) => new PiloteBot(i, { niveau: 1, graine: g }),
    );
    expect(resultat.victoiresA).toBeGreaterThan(resultat.victoiresB);
  });

  /**
   * Le repère d'avant : les bots qui construisaient par ordre de valeur sans
   * jamais regarder un jeton ni proposer un échange.
   */
  it('bat largement l ancien bot cupide', () => {
    const resultat = duel(
      (i, g) => new PiloteBot(i, { niveau: 2, graine: g }),
      () => new GreedyBot(),
    );
    expect(resultat.victoiresA).toBeGreaterThan(resultat.victoiresB * 3);
    expect(resultat.pointsA).toBeGreaterThan(resultat.pointsB * 2);
  });

  it('borne le niveau demandé au lieu de le refuser', () => {
    expect(niveauDe(0).id).toBe(1);
    expect(niveauDe(9).id).toBe(4);
    expect(niveauDe('3').id).toBe(3);
    expect(niveauDe(undefined).id).toBe(3);
    // Un niveau déjà constitué revient tel quel : c'est ce qui permet aux
    // mesures d'en fabriquer un amputé d'une faculté.
    expect(niveauDe({ ...NIVEAUX[4], annonce: false }).annonce).toBe(false);
  });

  it('ne fait proposer aucun échange à l apprenti, et beaucoup au colon', () => {
    const partie = (niveau: number) => playGame({
      playerCount: 6, seed: 'echanges', maxCycles: 120,
      makeBot: (i) => new PiloteBot(i, { niveau, graine: 'echanges' }),
    });

    expect(partie(1).tradesOffered).toBe(0);
    expect(partie(2).tradesOffered).toBeGreaterThan(50);
  });

  /**
   * L'annonce hors tour (§8) n'était jouée par aucun bot : la mécanique
   * existait dans le moteur sans jamais être exercée par une partie simulée.
   */
  it('fait annoncer des constructions hors tour à partir du niveau 3', () => {
    const partie = (niveau: number) => playGame({
      playerCount: 6, seed: 'annonces', maxCycles: 200,
      makeBot: (i) => new PiloteBot(i, { niveau, graine: 'annonces' }),
    });

    expect(partie(2).buildsDeclared).toBe(0);
    expect(partie(3).buildsDeclared).toBeGreaterThan(0);
  });
});

describe('caractères des adversaires', () => {
  const table = (caractere: string, graine: string) => playGame({
    playerCount: 6, seed: graine, maxCycles: 150,
    makeBot: (i) => new PiloteBot(i, { niveau: 3, caractere: caractere as never, graine }),
  });

  /**
   * Mesuré sur trois parties à six : le marchand dépose 1382 offres et passe
   * 122 fois par la banque, le corsaire 395 offres et 148 conversions. Ce
   * n'est pas un réglage cosmétique — les deux jouent la même partie par
   * deux chemins différents.
   */
  it('fait négocier le marchand bien plus que le corsaire', () => {
    let marchands = 0, corsaires = 0;
    for (const graine of ['c-0', 'c-1', 'c-2']) {
      marchands += table('marchand', graine).tradesOffered;
      corsaires += table('corsaire', graine).tradesOffered;
    }
    expect(marchands).toBeGreaterThan(corsaires * 2);
  });

  /**
   * Annoncer hors de son tour prend l'emplacement un cycle plus tôt, mais
   * immobilise les cartes : c'est un geste de tempérament, réservé à ceux
   * qui prennent le terrain.
   */
  it('ne fait annoncer que les caractères qui prennent le terrain', () => {
    expect(table('batisseur', 'c-0').buildsDeclared).toBeGreaterThan(0);
    expect(table('erudit', 'c-0').buildsDeclared).toBe(0);
  });

  it('donne à chaque caractère un nom et une étiquette distincts', () => {
    const etiquettes = new Set(CARACTERE_IDS.map((id) => CARACTERES[id].etiquette));
    expect(etiquettes.size).toBe(CARACTERE_IDS.length);
  });
});

describe('table d adversaires', () => {
  it('distribue les caractères à tour de rôle, sans en oublier', () => {
    const places = composerLaTable(12, { niveau: 2 });
    const vus = new Set(places.map((p) => p.caractere.id));
    expect(vus.size).toBe(CARACTERE_IDS.length);
    expect(places.every((p) => p.niveau.id === 2)).toBe(true);
  });

  it('impose un caractère unique quand on le demande', () => {
    const places = composerLaTable(4, { caracteres: 'corsaire' });
    expect(places.every((p) => p.caractere.id === 'corsaire')).toBe(true);
  });

  it('donne des noms distincts au-delà de la liste de prénoms', () => {
    const noms = composerLaTable(20).map((p) => p.nom);
    expect(new Set(noms).size).toBe(20);
    expect(nomDe(0, CARACTERES.marchand)).toContain('négoce');
  });

  it('rejoue exactement la même partie à graine égale', () => {
    const jouer = () => playGame({
      playerCount: 6, seed: 'rejeu', maxCycles: 120,
      makeBot: (i) => new PiloteBot(i, { niveau: 4, graine: 'rejeu' }),
    });
    expect(jouer().points).toEqual(jouer().points);
  });
});

describe('stabilité du pilote', () => {
  /**
   * Le bot réseau appelle `decider` à chaque message reçu, plusieurs fois par
   * seconde. Deux appels dans le même état doivent rendre le même coup, sans
   * quoi il inonderait la partie de variantes de la même idée — et le
   * garde-fou de `scripts/bots.ts`, qui compare la commande à la précédente,
   * ne servirait à rien.
   */
  it('rend deux fois le même coup dans le même état', () => {
    const rng = new SeededRandom('stabilite:board');
    const players = Array.from({ length: 4 }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
    const state = createGame({
      players, board: classicBoard(rng), config: defaultConfig(4), seed: 'stabilite',
    });

    const table = composerLaTable(1, { niveau: 4, graine: 'stabilite' });
    const pilote = table[0]?.pilote;
    expect(pilote).toBeDefined();

    const vue = publicView(state);
    const moi = privateView(state, 'p1');
    expect(moi).toBeDefined();

    const premier = pilote?.decider(vue, moi!);
    const second = pilote?.decider(vue, moi!);
    expect(premier).toEqual(second);
    /*
     * Le tout premier coup d'une partie est le choix de l'objectif secret.
     *
     * Il vaut deux points et les bots ne le faisaient pas : ils gardaient
     * leurs deux cartes en main jusqu'à la fin, et le moteur leur attribuait
     * la première par défaut. Le voir ici, avant même la mise en place, est
     * la preuve la plus courte que la décision est prise et non subie.
     */
    expect(premier?.type).toBe('CHOOSE_OBJECTIVE');
  });
});
