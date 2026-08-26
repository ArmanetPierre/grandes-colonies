import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import { Board, type HexData } from '../src/board/board.js';
import { type VertexId } from '../src/board/graph.js';
import {
  CLASSIC_DECK,
  EMPTY_HOLDING,
  GRAND_COLONIES_DECK,
  beginTurn,
  buildDeck,
  buyCard,
  canPlayCard,
  deckSize,
  heldCount,
  knightsPlayed,
  playCard,
} from '../src/devCards.js';
import { largestArmyHolder } from '../src/largestArmy.js';
import { SeededRandom } from '../src/rng.js';
import { computeStandings, victoryBreakdown, victoryPoints } from '../src/victory.js';

const ORIGIN: Axial = { q: 0, r: 0 };

function makeBoard(): Board {
  const positions = hexesWithin(ORIGIN, 2);
  const hexes = new Map<string, HexData>();
  for (const p of positions) hexes.set(hexKey(p), { terrain: 'forest', token: 5 });
  return new Board({ positions, hexes });
}

/** Pose `count` constructions à un joueur, sur des sommets distincts. */
function give(board: Board, player: string, kind: 'settlement' | 'city', count: number): VertexId[] {
  const free = [...board.graph.vertices].sort().filter((v) => !board.buildingAt(v));
  const used = free.slice(0, count);
  for (const v of used) board.setBuilding(v, { kind, owner: player });
  return used;
}

describe('générateur déterministe', () => {
  it('rejoue exactement la même suite à graine égale', () => {
    const a = new SeededRandom(42);
    const b = new SeededRandom(42);
    const left = Array.from({ length: 50 }, () => a.next());
    const right = Array.from({ length: 50 }, () => b.next());
    expect(left).toEqual(right);
  });

  it('diverge sur des graines différentes', () => {
    const a = new SeededRandom(1);
    const b = new SeededRandom(2);
    expect(a.next()).not.toBe(b.next());
  });

  it('accepte une graine lisible', () => {
    const a = new SeededRandom('agora-vendredi');
    const b = new SeededRandom('agora-vendredi');
    expect(a.next()).toBe(b.next());
    expect(new SeededRandom('agora-samedi').next()).not.toBe(new SeededRandom('agora-vendredi').next());
  });

  // C'est ce qui permettra de reprendre une partie sauvegardée sans que la
  // suite des tirages ne change.
  it('reprend une suite interrompue depuis son instantané', () => {
    const original = new SeededRandom(7);
    for (let i = 0; i < 10; i++) original.next();

    const resumed = SeededRandom.fromState(original.snapshot());
    expect(Array.from({ length: 20 }, () => resumed.next()))
      .toEqual(Array.from({ length: 20 }, () => original.next()));
  });

  it('tire des dés dans les bornes', () => {
    const rng = new SeededRandom(3);
    for (let i = 0; i < 500; i++) {
      const { a, b, total } = rng.roll();
      expect(a).toBeGreaterThanOrEqual(1);
      expect(a).toBeLessThanOrEqual(6);
      expect(total).toBe(a + b);
    }
  });

  // La cloche des deux dés est ce qui donne leur valeur aux jetons 6 et 8.
  it('produit une distribution en cloche et non uniforme', () => {
    const rng = new SeededRandom(11);
    const tally = new Map<number, number>();
    for (let i = 0; i < 60_000; i++) {
      const { total } = rng.roll();
      tally.set(total, (tally.get(total) ?? 0) + 1);
    }
    const seven = tally.get(7) ?? 0;
    const two = tally.get(2) ?? 0;
    expect(seven).toBeGreaterThan(two * 4);
    expect(seven / 60_000).toBeGreaterThan(0.13);
    expect(seven / 60_000).toBeLessThan(0.20);
  });

  it('mélange sans modifier la liste d origine', () => {
    const rng = new SeededRandom(5);
    const source = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8]);
    const shuffled = rng.shuffle(source);
    expect(shuffled).toHaveLength(8);
    expect([...shuffled].sort()).toEqual([...source].sort());
    expect(source).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('mélange identiquement à graine égale', () => {
    const source = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(new SeededRandom(9).shuffle(source)).toEqual(new SeededRandom(9).shuffle(source));
  });
});

describe('pioche de développement', () => {
  it('compte soixante cartes pour Grand Colonies', () => {
    expect(deckSize(GRAND_COLONIES_DECK)).toBe(60);
    expect(buildDeck(GRAND_COLONIES_DECK, new SeededRandom(1))).toHaveLength(60);
  });

  it('respecte la composition demandée', () => {
    const deck = buildDeck(CLASSIC_DECK, new SeededRandom(1));
    expect(deck.filter((c) => c === 'knight')).toHaveLength(14);
    expect(deck.filter((c) => c === 'monopoly')).toHaveLength(2);
  });

  it('distribue le même ordre à graine égale', () => {
    expect(buildDeck(GRAND_COLONIES_DECK, new SeededRandom(4)))
      .toEqual(buildDeck(GRAND_COLONIES_DECK, new SeededRandom(4)));
  });
});

describe('main de cartes développement', () => {
  it('refuse de jouer une carte achetée le tour même', () => {
    const holding = buyCard(EMPTY_HOLDING, 'knight');
    expect(canPlayCard(holding, 'knight')).toEqual({ ok: false, reason: 'bought-this-turn' });
  });

  it('autorise la carte au tour suivant', () => {
    const holding = beginTurn(buyCard(EMPTY_HOLDING, 'knight'));
    expect(canPlayCard(holding, 'knight').ok).toBe(true);
  });

  it('refuse une carte qu on ne possède pas', () => {
    expect(canPlayCard(EMPTY_HOLDING, 'monopoly')).toEqual({ ok: false, reason: 'not-held' });
  });

  it('n autorise qu une carte par tour', () => {
    let holding = beginTurn(buyCard(buyCard(EMPTY_HOLDING, 'knight'), 'monopoly'));
    holding = playCard(holding, 'knight');
    expect(canPlayCard(holding, 'monopoly')).toEqual({ ok: false, reason: 'already-played-this-turn' });
    expect(canPlayCard(beginTurn(holding), 'monopoly').ok).toBe(true);
  });

  it('laisse jouer une carte mûre même si une autre vient d être achetée', () => {
    let holding = beginTurn(buyCard(EMPTY_HOLDING, 'knight'));
    holding = buyCard(holding, 'knight');
    expect(canPlayCard(holding, 'knight').ok).toBe(true);
  });

  it('compte les chevaliers joués, pas ceux en main', () => {
    let holding = beginTurn(buyCard(buyCard(EMPTY_HOLDING, 'knight'), 'knight'));
    expect(knightsPlayed(holding)).toBe(0);
    holding = playCard(holding, 'knight');
    expect(knightsPlayed(holding)).toBe(1);
    expect(heldCount(holding)).toBe(1);
  });

  it('ne mute pas la main d origine', () => {
    const before = beginTurn(buyCard(EMPTY_HOLDING, 'knight'));
    playCard(before, 'knight');
    expect(before.playable).toEqual(['knight']);
    expect(before.played).toEqual([]);
  });
});

describe('plus grande puissance militaire', () => {
  it('n attribue rien sous trois chevaliers', () => {
    expect(largestArmyHolder(new Map([['p1', 2]]))).toBeUndefined();
  });

  it('attribue le titre à trois chevaliers', () => {
    expect(largestArmyHolder(new Map([['p1', 3]]))).toEqual({ player: 'p1', knights: 3 });
  });

  it('laisse le titre au détenteur en cas d égalité', () => {
    const knights = new Map([['p1', 3], ['p2', 3]]);
    expect(largestArmyHolder(knights, 'p1')?.player).toBe('p1');
    expect(largestArmyHolder(knights, 'p2')?.player).toBe('p2');
  });

  it('transfère le titre à qui fait strictement mieux', () => {
    const knights = new Map([['p1', 3], ['p2', 4]]);
    expect(largestArmyHolder(knights, 'p1')).toEqual({ player: 'p2', knights: 4 });
  });
});

describe('points de victoire', () => {
  it('compte une colonie pour un point et une ville pour deux', () => {
    const board = makeBoard();
    give(board, 'p1', 'settlement', 3);
    give(board, 'p1', 'city', 2);
    expect(victoryPoints(board, 'p1')).toBe(3 + 4);
  });

  it('ne compte pas les constructions des autres', () => {
    const board = makeBoard();
    give(board, 'p2', 'city', 4);
    expect(victoryPoints(board, 'p1')).toBe(0);
  });

  it('ajoute deux points par titre', () => {
    const board = makeBoard();
    give(board, 'p1', 'settlement', 1);
    expect(victoryPoints(board, 'p1', { hasLongestRoute: true, hasLargestArmy: true })).toBe(5);
  });

  // Une métropole remplace une ville : ses points ne s'ajoutent pas aux siens.
  it('substitue les points de métropole à ceux de la ville', () => {
    const board = makeBoard();
    give(board, 'p1', 'city', 2);
    const detail = victoryBreakdown(board, 'p1', { metropolises: 1 });
    expect(detail.cities).toBe(2);
    expect(detail.metropolises).toBe(3);
    expect(detail.total).toBe(5);
  });

  it('ventile les points par source', () => {
    const board = makeBoard();
    give(board, 'p1', 'settlement', 2);
    const detail = victoryBreakdown(board, 'p1', {
      secretObjectivesCompleted: 1,
      defenderTokens: 2,
      monuments: 1,
      hasLongestRoute: true,
    });
    expect(detail.settlements).toBe(2);
    expect(detail.secretObjectives).toBe(2);
    expect(detail.defenderTokens).toBe(2);
    expect(detail.monuments).toBe(2);
    expect(detail.longestRoute).toBe(2);
    expect(detail.total).toBe(10);
  });
});

describe('classement', () => {
  it('recalcule les deux titres avant de compter', () => {
    const board = makeBoard();
    give(board, 'p1', 'settlement', 2);
    give(board, 'p2', 'settlement', 2);

    const standings = computeStandings(board, {
      players: ['p1', 'p2'],
      knightsPlayed: new Map([['p1', 4], ['p2', 1]]),
    });

    expect(standings.largestArmy).toBe('p1');
    expect(standings.points.get('p1')?.largestArmy).toBe(2);
    expect(standings.points.get('p2')?.largestArmy).toBe(0);
  });

  it('ne déclare aucun vainqueur sous le seuil', () => {
    const board = makeBoard();
    give(board, 'p1', 'city', 3);
    const standings = computeStandings(board, {
      players: ['p1'],
      knightsPlayed: new Map(),
    });
    expect(standings.points.get('p1')?.total).toBe(6);
    expect(standings.winner).toBeUndefined();
  });

  it('déclare le vainqueur au seuil de quinze', () => {
    const board = makeBoard();
    give(board, 'p1', 'city', 7);
    const standings = computeStandings(board, {
      players: ['p1'],
      knightsPlayed: new Map([['p1', 3]]),
    });
    expect(standings.points.get('p1')?.total).toBe(16);
    expect(standings.winner).toBe('p1');
  });
});
