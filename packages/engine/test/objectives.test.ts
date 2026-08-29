import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import { Board, type HexData } from '../src/board/board.js';
import { EMPTY_HOLDING, beginTurn, buyCard, playCard } from '../src/devCards.js';
import {
  type ObjectiveContext,
  OBJECTIVES,
  availableObjectives,
  isObjectiveComplete,
} from '../src/objectives.js';

const ORIGIN: Axial = { q: 0, r: 0 };

function makeBoard(): Board {
  const positions = hexesWithin(ORIGIN, 3);
  const hexes = new Map<string, HexData>();
  for (const p of positions) hexes.set(hexKey(p), { terrain: 'forest', token: 5 });
  return new Board({ positions, hexes });
}

function give(board: Board, kind: 'settlement' | 'city', count: number, owner = 'p1'): void {
  const free = [...board.graph.vertices].sort().filter((v) => !board.buildingAt(v));
  for (const v of free.slice(0, count)) board.setBuilding(v, { kind, owner });
}

const context = (board: Board, over: Partial<ObjectiveContext> = {}): ObjectiveContext => ({
  board,
  player: 'p1',
  devCards: EMPTY_HOLDING,
  roadsPlaced: 0,
  gold: 0,
  territoriesExplored: 0,
  contractsHonoured: 0,
  tradingPosts: 0,
  ...over,
});

describe('objectifs secrets', () => {
  it('ne distribue que les objectifs dont le système existe', () => {
    const available = availableObjectives();
    expect(available).toContain('architect');
    // L'exploration et les contrats n'existent pas encore : un joueur ne doit
    // jamais tirer un objectif impossible à remplir.
    expect(available).not.toContain('explorer');
    expect(available).not.toContain('diplomat');
    expect(available).not.toContain('magnate');
    // Le « grand commerçant » compte des ports **ou des comptoirs**, et les
    // comptoirs n'existent pas : les ports seuls ne mènent jamais à cinq.
    expect(available).not.toContain('merchant');
  });

  it('déclare tout de même les objectifs à venir', () => {
    expect(OBJECTIVES.explorer.available).toBe(false);
    expect(OBJECTIVES.explorer.description).toContain('territoires');
  });

  it('valide l architecte à huit bâtiments', () => {
    const board = makeBoard();
    give(board, 'settlement', 7);
    expect(isObjectiveComplete('architect', context(board))).toBe(false);
    give(board, 'settlement', 1);
    expect(isObjectiveComplete('architect', context(board))).toBe(true);
  });

  it('ne compte que les bâtiments du joueur', () => {
    const board = makeBoard();
    give(board, 'settlement', 8, 'p2');
    expect(isObjectiveComplete('architect', context(board))).toBe(false);
  });

  it('valide le bâtisseur de cités à quatre villes', () => {
    const board = makeBoard();
    give(board, 'city', 3);
    expect(isObjectiveComplete('urbanist', context(board))).toBe(false);
    give(board, 'city', 1);
    expect(isObjectiveComplete('urbanist', context(board))).toBe(true);
  });

  it('valide le colonisateur à cinq colonies simultanées', () => {
    const board = makeBoard();
    give(board, 'settlement', 5);
    expect(isObjectiveComplete('settler', context(board))).toBe(true);
    // Des villes ne comptent pas pour cet objectif.
    const other = makeBoard();
    give(other, 'city', 5);
    expect(isObjectiveComplete('settler', context(other))).toBe(false);
  });

  it('valide le grand bâtisseur à douze routes posées', () => {
    const board = makeBoard();
    expect(isObjectiveComplete('roadNetwork', context(board, { roadsPlaced: 11 }))).toBe(false);
    expect(isObjectiveComplete('roadNetwork', context(board, { roadsPlaced: 12 }))).toBe(true);
  });

  it('valide le seigneur militaire à trois chevaliers joués', () => {
    const board = makeBoard();
    let holding = EMPTY_HOLDING;
    for (let i = 0; i < 3; i++) holding = buyCard(holding, 'knight');
    holding = beginTurn(holding);

    for (let i = 0; i < 2; i++) {
      holding = beginTurn(playCard(holding, 'knight'));
    }
    expect(isObjectiveComplete('warlord', context(board, { devCards: holding }))).toBe(false);

    holding = playCard(holding, 'knight');
    expect(isObjectiveComplete('warlord', context(board, { devCards: holding }))).toBe(true);
  });
});

/**
 * Le « grand commerçant » du §21 : cinq ports ou comptoirs.
 *
 * Il est déclaré mais éteint — la moitié de son décompte, les comptoirs du
 * §12, n'existe pas encore. Ces épreuves fixent ce qu'il comptera le jour où
 * on l'allumera, pour que le rallumage soit un seul booléen à changer.
 */
describe('grand commerçant', () => {
  /** Un plateau dont les `count` premiers sommets portent un port. */
  function withPorts(count: number, owner: string | null = 'p1'): Board {
    const positions = hexesWithin(ORIGIN, 3);
    const hexes = new Map<string, HexData>();
    for (const p of positions) hexes.set(hexKey(p), { terrain: 'forest', token: 5 });

    // Les sommets se lisent sur un plateau nu, puis on le reconstruit avec
    // ses ports : la carte des ports est fixée à la construction.
    const vertices = [...new Board({ positions, hexes }).graph.vertices].sort().slice(0, count);
    const board = new Board({
      positions, hexes,
      ports: new Map(vertices.map((v) => [v, { kind: 'generic' as const }])),
    });

    if (owner) for (const v of vertices) board.setBuilding(v, { kind: 'settlement', owner });
    return board;
  }

  it('compte les ports que le joueur occupe', () => {
    expect(isObjectiveComplete('merchant', context(withPorts(4)))).toBe(false);
    expect(isObjectiveComplete('merchant', context(withPorts(5)))).toBe(true);
  });

  it('ne compte pas un port que personne n occupe', () => {
    expect(isObjectiveComplete('merchant', context(withPorts(9, null)))).toBe(false);
  });

  it('ne compte pas le port du voisin', () => {
    expect(isObjectiveComplete('merchant', context(withPorts(9, 'p2')))).toBe(false);
  });

  it('additionnera les comptoirs aux ports le jour où ils existeront', () => {
    const board = withPorts(3);
    expect(isObjectiveComplete('merchant', context(board, { tradingPosts: 1 }))).toBe(false);
    expect(isObjectiveComplete('merchant', context(board, { tradingPosts: 2 }))).toBe(true);
  });
});
