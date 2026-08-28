import { describe, expect, it } from 'vitest';

import { type Axial, hexKey, hexesWithin } from '../src/board/axial.js';
import type { HexData } from '../src/board/board.js';
import type { VertexId } from '../src/board/graph.js';
import { defaultConfig, handLimitFor, robberCountFor } from '../src/game/config.js';
import type { Command } from '../src/game/commands.js';
import { dispatch, replay } from '../src/game/engine.js';
import { type GameState, createGame, pairedPlayer, playerOf, setupOrder } from '../src/game/state.js';
import { settlementSpots } from '../src/placement.js';
import { addCounts, amount, counts, total } from '../src/resources.js';

const ORIGIN: Axial = { q: 0, r: 0 };

/** Plateau déterministe : terrains et jetons fixés, aucun hasard de génération. */
function boardInit() {
  const positions = hexesWithin(ORIGIN, 2);
  const terrains = ['forest', 'pasture', 'field', 'hills', 'mountain'] as const;
  const tokens = [3, 4, 5, 6, 8, 9, 10, 11] as const;
  const hexes = new Map<string, HexData>();

  positions.forEach((p, i) => {
    // Le repli couvre l'indexation, que le typage strict considère faillible.
    const terrain = terrains[i % terrains.length] ?? 'forest';
    const token = tokens[i % tokens.length] ?? 5;
    hexes.set(hexKey(p), { terrain, token });
  });

  return { positions, hexes };
}

function newGame(playerCount = 3, seed: number | string = 'test'): GameState {
  const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i + 1}`, name: `J${i + 1}` }));
  return createGame({ players, board: boardInit(), config: defaultConfig(playerCount), seed });
}

let counter = 0;
const cmd = <T extends Command['type']>(
  type: T,
  playerId: string,
  extra: Record<string, unknown> = {},
): Command => ({ actionId: `a${counter++}`, playerId, type, ...extra } as Command);

/** Joue toute la mise en place et renvoie les commandes utilisées. */
function runSetup(state: GameState): Command[] {
  const used: Command[] = [];
  while (state.phase === 'setup') {
    const player = state.setupQueue[0] as string;

    // Reprend proprement si une colonie attend déjà sa route.
    let spot = state.setupPendingVertex;
    if (spot === undefined) {
      spot = settlementSpots(state.board, player, { setupPhase: true })[0] as VertexId;
      const place = cmd('PLACE_SETUP_SETTLEMENT', player, { vertex: spot });
      expect(dispatch(state, place).ok).toBe(true);
      used.push(place);
    }

    const edge = state.board.graph
      .edgesOfVertexOnBoard(spot)
      .find((e) => state.board.roadAt(e) === undefined) as string;
    const road = cmd('PLACE_SETUP_ROAD', player, { edge });
    expect(dispatch(state, road).ok).toBe(true);
    used.push(road);
  }
  return used;
}

describe('configuration', () => {
  it('monte la limite de main avec l effectif', () => {
    expect(handLimitFor(4)).toBe(7);
    expect(handLimitFor(8)).toBe(9);
    expect(handLimitFor(12)).toBe(13);
  });

  it('plafonne la limite à treize', () => {
    expect(handLimitFor(20)).toBe(13);
  });

  it('ajoute un second voleur à partir de onze joueurs', () => {
    expect(robberCountFor(10)).toBe(1);
    expect(robberCountFor(11)).toBe(2);
  });
});

describe('mise en place', () => {
  it('fait poser chaque joueur deux fois, en aller-retour', () => {
    expect(setupOrder(['a', 'b', 'c'])).toEqual(['a', 'b', 'c', 'c', 'b', 'a']);
  });

  it('refuse qu un joueur pose hors de son tour', () => {
    const state = newGame();
    const spot = settlementSpots(state.board, 'p2', { setupPhase: true })[0] as VertexId;
    expect(dispatch(state, cmd('PLACE_SETUP_SETTLEMENT', 'p2', { vertex: spot })))
      .toEqual({ ok: false, reason: 'not-your-turn' });
  });

  it('exige la route juste après la colonie', () => {
    const state = newGame();
    const spot = settlementSpots(state.board, 'p1', { setupPhase: true })[0] as VertexId;
    dispatch(state, cmd('PLACE_SETUP_SETTLEMENT', 'p1', { vertex: spot }));

    const other = settlementSpots(state.board, 'p1', { setupPhase: true })[0] as VertexId;
    const result = dispatch(state, cmd('PLACE_SETUP_SETTLEMENT', 'p1', { vertex: other }));
    expect(result.ok).toBe(false);
  });

  it('impose que la route parte de la colonie posée', () => {
    const state = newGame();
    const spot = settlementSpots(state.board, 'p1', { setupPhase: true })[0] as VertexId;
    dispatch(state, cmd('PLACE_SETUP_SETTLEMENT', 'p1', { vertex: spot }));

    const attached = new Set(state.board.graph.edgesOfVertexOnBoard(spot));
    const elsewhere = [...state.board.graph.edges].sort().find((e) => !attached.has(e)) as string;
    const result = dispatch(state, cmd('PLACE_SETUP_ROAD', 'p1', { edge: elsewhere }));
    expect(result).toMatchObject({ ok: false, reason: 'invalid-placement' });
  });

  it('ne donne des ressources qu à la seconde colonie', () => {
    const state = newGame();
    const first = settlementSpots(state.board, 'p1', { setupPhase: true })[0] as VertexId;
    dispatch(state, cmd('PLACE_SETUP_SETTLEMENT', 'p1', { vertex: first }));
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    expect(total(p1.hand)).toBe(0);

    runSetup(state);
    // Chacun a reçu les ressources de sa seconde colonie.
    for (const p of state.players) expect(total(p.hand)).toBeGreaterThan(0);
  });

  it('passe en production une fois la mise en place terminée', () => {
    const state = newGame();
    runSetup(state);
    expect(state.phase).toBe('production');
    expect(state.cycle).toBe(1);
    expect(state.deck.length).toBe(60);
  });
});

describe('déroulement d un tour', () => {
  function started(playerCount = 3, seed: string | number = 'test') {
    const state = newGame(playerCount, seed);
    runSetup(state);
    return state;
  }

  it('exige le lancer avant toute construction', () => {
    const state = started();
    const edge = [...state.board.graph.edges].sort()[0] as string;
    expect(dispatch(state, cmd('BUILD_ROAD', 'p1', { edge })))
      .toEqual({ ok: false, reason: 'must-roll-first' });
  });

  it('refuse un second lancer', () => {
    const state = started();
    dispatch(state, cmd('ROLL_DICE', 'p1'));
    expect(dispatch(state, cmd('ROLL_DICE', 'p1'))).toEqual({ ok: false, reason: 'already-rolled' });
  });

  it('refuse le lancer d un joueur inactif', () => {
    const state = started();
    expect(dispatch(state, cmd('ROLL_DICE', 'p2'))).toEqual({ ok: false, reason: 'not-your-turn' });
  });

  it('émet le lancer et le changement de phase', () => {
    const state = started();
    const result = dispatch(state, cmd('ROLL_DICE', 'p1'));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events[0]?.type).toBe('DiceRolled');
    expect(state.phase).toBe('activeTurn');
  });

  it('ouvre la fenêtre de commerce en fin de tour', () => {
    const state = started();
    dispatch(state, cmd('ROLL_DICE', 'p1'));
    dispatch(state, cmd('END_TURN', 'p1'));
    // Le tour ne termine plus le cycle : le commerce s'intercale.
    expect(state.phase).toBe('freeTrade');
    expect(state.activeIndex).toBe(0);
  });

  it('fait tourner le joueur actif à la fin du cycle', () => {
    const state = started();
    dispatch(state, cmd('ROLL_DICE', 'p1'));
    dispatch(state, cmd('END_TURN', 'p1'));
    dispatch(state, cmd('END_CYCLE', 'p1'));
    expect(state.activeIndex).toBe(1);
    expect(state.phase).toBe('production');
    expect(state.cycle).toBe(2);
  });

  it('refuse de construire sans les ressources', () => {
    const state = started();
    dispatch(state, cmd('ROLL_DICE', 'p1'));
    const p1 = playerOf(state, 'p1');
    if (p1) p1.hand = counts({});
    const edge = [...state.board.graph.edges].sort()[0] as string;
    expect(dispatch(state, cmd('BUILD_ROAD', 'p1', { edge })))
      .toEqual({ ok: false, reason: 'not-enough-resources' });
  });

  it('construit une route et débite la main', () => {
    const state = started();
    dispatch(state, cmd('ROLL_DICE', 'p1'));

    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.hand = addCounts(p1.hand, counts({ wood: 1, brick: 1 }));
    const before = total(p1.hand);

    const settlement = [...state.board.allBuildings().entries()]
      .find(([, b]) => b.owner === 'p1')?.[0] as VertexId;
    const edge = state.board.graph
      .edgesOfVertexOnBoard(settlement)
      .find((e) => state.board.roadAt(e) === undefined) as string;

    const result = dispatch(state, cmd('BUILD_ROAD', 'p1', { edge }));
    expect(result.ok).toBe(true);
    expect(state.board.roadAt(edge)).toBe('p1');
    expect(total(p1.hand)).toBe(before - 2);
  });

  it('achète une carte développement et la rend injouable le tour même', () => {
    const state = started();
    dispatch(state, cmd('ROLL_DICE', 'p1'));
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    p1.hand = addCounts(p1.hand, counts({ ore: 1, wool: 1, grain: 1 }));

    const before = state.deck.length;
    expect(dispatch(state, cmd('BUY_DEV_CARD', 'p1')).ok).toBe(true);
    expect(state.deck.length).toBe(before - 1);
    expect(p1.devCards.pending).toHaveLength(1);
    expect(p1.devCards.playable).toHaveLength(0);
  });

  it('échange avec la banque au cours du marché', () => {
    const state = started();
    dispatch(state, cmd('ROLL_DICE', 'p1'));
    const p1 = playerOf(state, 'p1');
    if (!p1) throw new Error('joueur absent');
    // Cinq contre une : le cours d'ouverture du bois, et non le 4:1 figé
    // d'avant le marché dynamique.
    p1.hand = counts({ wood: 5 });

    const result = dispatch(state, cmd('TRADE_WITH_BANK', 'p1', {
      give: counts({ wood: 5 }), receive: counts({ ore: 1 }),
    }));
    expect(result.ok).toBe(true);
    expect(amount(p1.hand, 'wood')).toBe(0);
    expect(amount(p1.hand, 'ore')).toBe(1);
  });

  it('refuse un taux de change qui n est pas celui du jour', () => {
    const state = started();
    dispatch(state, cmd('ROLL_DICE', 'p1'));
    const p1 = playerOf(state, 'p1');
    if (p1) p1.hand = counts({ wood: 4 });

    expect(dispatch(state, cmd('TRADE_WITH_BANK', 'p1', {
      give: counts({ wood: 4 }), receive: counts({ ore: 1 }),
    }))).toMatchObject({ ok: false, reason: 'invalid-trade' });
  });
});

describe('le sept', () => {
  /** Force un 7 en cherchant la graine qui le produit au premier lancer. */
  function gameRollingSeven(): GameState {
    for (let seed = 0; seed < 400; seed++) {
      const state = newGame(3, seed);
      runSetup(state);
      const probe = createGame({
        players: state.players.map((p) => ({ id: p.id, name: p.name })),
        board: boardInit(),
        config: defaultConfig(3),
        seed,
      });
      runSetup(probe);
      const result = dispatch(probe, cmd('ROLL_DICE', 'p1'));
      if (result.ok && probe.lastRoll?.total === 7) return probe;
    }
    throw new Error('aucune graine ne produit un 7');
  }

  it('déclenche le voleur et bloque les autres actions', () => {
    const state = gameRollingSeven();
    expect(state.pendingRobber).toBe(true);

    const edge = [...state.board.graph.edges].sort()[0] as string;
    expect(dispatch(state, cmd('BUILD_ROAD', 'p1', { edge })))
      .toMatchObject({ ok: false, reason: 'invalid-robber-move' });
  });

  it('interdit de finir son tour avec le voleur en attente', () => {
    const state = gameRollingSeven();
    expect(dispatch(state, cmd('END_TURN', 'p1')))
      .toMatchObject({ ok: false, reason: 'invalid-robber-move' });
  });

  it('déplace le voleur et libère le tour', () => {
    const state = gameRollingSeven();
    for (const p of state.players) p.mustDiscard = 0;

    const target = hexKey(ORIGIN);
    const result = dispatch(state, cmd('MOVE_ROBBER', 'p1', { to: target }));
    expect(result.ok).toBe(true);
    expect(state.board.isBlocked(target)).toBe(true);
    expect(state.pendingRobber).toBe(false);
    expect(dispatch(state, cmd('END_TURN', 'p1')).ok).toBe(true);
  });

  it('exige la défausse avant le déplacement', () => {
    const state = gameRollingSeven();
    const p2 = playerOf(state, 'p2');
    if (!p2) throw new Error('joueur absent');
    p2.mustDiscard = 2;
    p2.hand = counts({ wood: 4 });

    expect(dispatch(state, cmd('MOVE_ROBBER', 'p1', { to: hexKey(ORIGIN) })))
      .toEqual({ ok: false, reason: 'must-discard-first' });

    expect(dispatch(state, cmd('DISCARD', 'p2', { resources: counts({ wood: 2 }) })).ok).toBe(true);
    expect(dispatch(state, cmd('MOVE_ROBBER', 'p1', { to: hexKey(ORIGIN) })).ok).toBe(true);
  });

  it('refuse une défausse du mauvais nombre de cartes', () => {
    const state = gameRollingSeven();
    const p2 = playerOf(state, 'p2');
    if (!p2) throw new Error('joueur absent');
    p2.mustDiscard = 2;
    p2.hand = counts({ wood: 4 });

    expect(dispatch(state, cmd('DISCARD', 'p2', { resources: counts({ wood: 1 }) })))
      .toMatchObject({ ok: false, reason: 'invalid-discard' });
  });
});

describe('idempotence', () => {
  it('n applique qu une fois une commande répétée', () => {
    const state = newGame();
    const spot = settlementSpots(state.board, 'p1', { setupPhase: true })[0] as VertexId;
    const command = cmd('PLACE_SETUP_SETTLEMENT', 'p1', { vertex: spot });

    const first = dispatch(state, command);
    const second = dispatch(state, command);

    expect(first.ok).toBe(true);
    expect(second).toEqual({ ok: true, events: [], duplicate: true });
    // Une seule colonie posée, une seule pièce consommée.
    expect(state.board.allBuildings().size).toBe(1);
    expect(playerOf(state, 'p1')?.settlementsLeft).toBe(4);
  });

  it('ne mémorise pas les commandes refusées', () => {
    const state = newGame();
    const bad = cmd('ROLL_DICE', 'p1');
    expect(dispatch(state, bad).ok).toBe(false);
    // Le même actionId doit pouvoir réussir plus tard, une fois l'état propre.
    expect(state.appliedActions.has(bad.actionId)).toBe(false);
  });
});

describe('rejeu déterministe', () => {
  it('reproduit exactement la même partie à graine et commandes égales', () => {
    const first = newGame(3, 'agora-vendredi');
    const commands = runSetup(first);

    const rollA = cmd('ROLL_DICE', 'p1');
    dispatch(first, rollA);
    commands.push(rollA);

    const second = newGame(3, 'agora-vendredi');
    replay(second, commands);

    expect(second.lastRoll).toEqual(first.lastRoll);
    expect(second.rng.snapshot()).toBe(first.rng.snapshot());
    expect(second.deck).toEqual(first.deck);
    expect(second.players.map((p) => p.hand)).toEqual(first.players.map((p) => p.hand));
    expect([...second.board.allBuildings().keys()].sort())
      .toEqual([...first.board.allBuildings().keys()].sort());
  });

  it('diverge sur une graine différente', () => {
    const a = newGame(3, 'graine-a');
    const b = newGame(3, 'graine-b');
    runSetup(a);
    runSetup(b);
    dispatch(a, cmd('ROLL_DICE', 'p1'));
    dispatch(b, cmd('ROLL_DICE', 'p1'));
    // Les pioches sont mélangées différemment.
    expect(a.deck).not.toEqual(b.deck);
  });
});

describe('joueur associé', () => {
  it('désigne le joueur trois positions à gauche', () => {
    const state = newGame(8);
    expect(pairedPlayer(state)?.id).toBe('p4');
    // Le décalage boucle : (6 + 3) modulo 8 = 1.
    state.activeIndex = 6;
    expect(pairedPlayer(state)?.id).toBe('p2');
  });

  it('n en désigne aucun à moins de quatre joueurs', () => {
    expect(pairedPlayer(newGame(3))).toBeUndefined();
  });
});
