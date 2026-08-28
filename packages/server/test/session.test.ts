import { describe, expect, it } from 'vitest';

import { type Command, type VertexId, settlementSpots } from '@grand-colonies/engine';

import { GameSession, ROUNDS_BEFORE_BOT } from '../src/session.js';

/** Horloge manuelle : aucun test n'attend réellement. */
function clock(start = 0) {
  let time = start;
  return {
    now: () => time,
    advance(ms: number) { time += ms; },
  };
}

let counter = 0;
const cmd = (type: string, playerId: string, extra: Record<string, unknown> = {}): Command =>
  ({ actionId: `s${counter++}`, playerId, type, ...extra }) as Command;

/**
 * Une session déjà lancée — l'état dans lequel se déroule une partie.
 *
 * Le salon d'attente a ses propres tests plus bas ; partout ailleurs il ne
 * serait qu'une cérémonie à répéter.
 */
function newSession(playerCount = 6, time = clock()) {
  const names = Array.from({ length: playerCount }, (_, i) => `J${i + 1}`);
  const session = new GameSession({ seed: 'session', playerNames: names, now: time.now });
  session.start();
  return session;
}

/** Une session encore au salon d'attente. */
function lobbySession(playerCount = 6, time = clock()) {
  const names = Array.from({ length: playerCount }, (_, i) => `J${i + 1}`);
  return new GameSession({ seed: 'session', playerNames: names, now: time.now });
}

/**
 * Une session dont tous les sièges sont occupés — la situation normale.
 *
 * Tant que l'hôte n'a pas lancé, la session n'arme aucun chronomètre et ne
 * joue pour personne : elle attend.
 */
function joinedSession(playerCount = 6, time = clock()) {
  const session = newSession(playerCount, time);
  for (let i = 0; i < playerCount; i++) session.claimFreeSeat();
  return session;
}

/** Joue toute la mise en place, pour atteindre une partie en cours. */
function runSetup(session: GameSession): void {
  const state = session.state;
  while (state.phase === 'setup') {
    const player = state.setupQueue[0] as string;
    let spot = state.setupPendingVertex;
    if (spot === undefined) {
      spot = settlementSpots(state.board, player, { setupPhase: true })[0] as VertexId;
      session.submit(cmd('PLACE_SETUP_SETTLEMENT', player, { vertex: spot }));
    }
    const edge = state.board.graph
      .edgesOfVertexOnBoard(spot).find((e) => state.board.roadAt(e) === undefined) as string;
    session.submit(cmd('PLACE_SETUP_ROAD', player, { edge }));
  }
}

describe('sièges', () => {
  it('attribue un siège et un jeton à chaque joueur', () => {
    const session = newSession(8);
    expect(session.allSeats()).toHaveLength(8);
    const tokens = new Set(session.allSeats().map((s) => s.token));
    expect(tokens.size).toBe(8);
  });

  /**
   * Le point qui compte : un rafraîchissement de page change l'identifiant
   * de connexion, jamais le jeton. C'est lui qui rattache au siège.
   */
  it('rend son siège à un joueur qui se reconnecte', () => {
    const session = newSession();
    const seat = session.claimFreeSeat();
    expect(seat).toBeDefined();
    if (!seat) return;

    session.disconnect(seat.playerId);
    expect(session.isConnected(seat.playerId)).toBe(false);

    const back = session.reconnect(seat.token);
    expect(back?.playerId).toBe(seat.playerId);
    expect(session.isConnected(seat.playerId)).toBe(true);
  });

  it('refuse un jeton inconnu', () => {
    expect(newSession().reconnect('jeton-invente')).toBeUndefined();
  });

  it('n attribue pas deux fois le même siège', () => {
    const session = newSession(3);
    const first = session.claimFreeSeat();
    const second = session.claimFreeSeat();
    expect(first?.playerId).not.toBe(second?.playerId);
  });

  it('n attribue plus rien quand tous les sièges sont pris', () => {
    const session = newSession(2);
    session.claimFreeSeat();
    session.claimFreeSeat();
    expect(session.claimFreeSeat()).toBeUndefined();
  });
});

describe('remplacement par un bot', () => {
  // On compte en tours de table et non en cycles : à douze joueurs, deux
  // cycles ne font qu'un sixième de tour, ce qui serait bien trop brutal.
  it('attend deux tours de table avant de proposer un bot', () => {
    const session = joinedSession(6);
    runSetup(session);
    const seat = session.allSeats()[2];
    if (!seat) return;

    session.disconnect(seat.playerId);
    expect(session.seatsEligibleForBot()).toHaveLength(0);

    // Un tour de table complet ne suffit pas.
    session.state.cycle += 6;
    expect(session.seatsEligibleForBot()).toHaveLength(0);

    session.state.cycle += 6 * (ROUNDS_BEFORE_BOT - 1);
    expect(session.seatsEligibleForBot().map((s) => s.playerId)).toEqual([seat.playerId]);
  });

  it('ne propose jamais un siège occupé', () => {
    const session = joinedSession(6);
    runSetup(session);
    session.state.cycle += 100;
    expect(session.seatsEligibleForBot()).toHaveLength(0);
  });

  it('retire l éligibilité dès la reconnexion', () => {
    const session = joinedSession(4);
    runSetup(session);
    const seat = session.allSeats()[1];
    if (!seat) return;

    session.disconnect(seat.playerId);
    session.state.cycle += 100;
    expect(session.seatsEligibleForBot()).toHaveLength(1);

    session.reconnect(seat.token);
    expect(session.seatsEligibleForBot()).toHaveLength(0);
  });
});

describe('chronomètre', () => {
  it('arme un délai sur les phases chronométrées', () => {
    const time = clock();
    const session = joinedSession(4, time);
    runSetup(session);

    expect(session.state.phase).toBe('production');
    expect(session.remainingMs()).toBe(90_000);

    time.advance(30_000);
    expect(session.remainingMs()).toBe(60_000);
  });

  it('ne descend jamais sous zéro', () => {
    const time = clock();
    const session = joinedSession(4, time);
    runSetup(session);
    time.advance(500_000);
    expect(session.remainingMs()).toBe(0);
  });

  it('réarme le délai à chaque commande acceptée', () => {
    const time = clock();
    const session = joinedSession(4, time);
    runSetup(session);

    time.advance(60_000);
    expect(session.remainingMs()).toBe(30_000);

    session.submit(cmd('ROLL_DICE', 'p1'));
    expect(session.remainingMs()).toBe(90_000);
  });

  /**
   * Contrat §2 : à zéro, le jeu ne s'arrête pas. Ce qui peut être validé
   * l'est, et la partie avance.
   */
  it('fait avancer la partie quand le délai expire', () => {
    const time = clock();
    const session = joinedSession(4, time);
    runSetup(session);

    const before = `${session.state.phase}:${session.state.cycle}`;
    time.advance(91_000);
    const events = session.tick();

    expect(events.length).toBeGreaterThan(0);
    expect(`${session.state.phase}:${session.state.cycle}`).not.toBe(before);
  });

  it('ne force rien tant que le délai court', () => {
    const time = clock();
    const session = joinedSession(4, time);
    runSetup(session);

    time.advance(10_000);
    expect(session.tick()).toHaveLength(0);
    expect(session.state.phase).toBe('production');
  });

  // Forcer au-delà d'une phase déroulerait la partie entière sur un seul
  // chronomètre expiré.
  it('ne franchit qu une phase par expiration', () => {
    const time = clock();
    const session = joinedSession(4, time);
    runSetup(session);
    const startCycle = session.state.cycle;

    time.advance(91_000);
    session.tick();
    expect(session.state.cycle).toBeLessThanOrEqual(startCycle + 1);
  });
});

describe('joueurs absents', () => {
  it('joue le tour d un joueur actif déconnecté', () => {
    const session = joinedSession(4);
    runSetup(session);

    const active = session.state.players[session.state.activeIndex];
    if (!active) return;
    session.disconnect(active.id);

    const events = session.tick();
    expect(events.some((e) => e.type === 'DiceRolled')).toBe(true);
    // La main est passée sans attendre.
    expect(session.state.cycle).toBeGreaterThan(1);
  });

  // Le tour associé est facultatif : son absence ne bloque personne.
  it('ne bloque pas sur un joueur associé déconnecté', () => {
    const session = joinedSession(6);
    runSetup(session);

    const paired = session.state.players[(session.state.activeIndex + 3) % 6];
    if (!paired) return;
    session.disconnect(paired.id);

    const before = session.state.cycle;
    session.tick();
    // Rien ne s'est débloqué de force : l'actif est toujours attendu.
    expect(session.state.cycle).toBe(before);
    expect(session.state.phase).toBe('production');
  });

  it('règle la défausse d un absent sans attendre', () => {
    const session = joinedSession(4);
    runSetup(session);

    const victim = session.state.players[1];
    if (!victim) return;
    victim.hand = { wood: 10 };
    victim.mustDiscard = 5;
    session.disconnect(victim.id);

    session.tick();
    expect(victim.mustDiscard).toBe(0);
  });
});

describe('commandes et journal', () => {
  it('n applique qu une fois une commande répétée', () => {
    const session = newSession(4);
    const state = session.state;
    const spot = settlementSpots(state.board, 'p1', { setupPhase: true })[0] as VertexId;
    const command = cmd('PLACE_SETUP_SETTLEMENT', 'p1', { vertex: spot });

    expect(session.submit(command).result.ok).toBe(true);
    const second = session.submit(command);
    expect(second.result).toMatchObject({ ok: true, duplicate: true });
    expect(session.commandLog()).toHaveLength(1);
  });

  it('ne journalise pas les commandes refusées', () => {
    const session = newSession(4);
    expect(session.submit(cmd('ROLL_DICE', 'p1')).result.ok).toBe(false);
    expect(session.commandLog()).toHaveLength(0);
  });

  it('journalise dans l ordre, pour le rejeu', () => {
    const session = newSession(4);
    runSetup(session);
    expect(session.commandLog().length).toBeGreaterThan(0);
    // Deux placements par joueur, colonie puis route.
    expect(session.commandLog()[0]?.type).toBe('PLACE_SETUP_SETTLEMENT');
    expect(session.commandLog()[1]?.type).toBe('PLACE_SETUP_ROAD');
  });
});

describe('vues servies par la session', () => {
  it('marque les joueurs déconnectés dans la vue publique', () => {
    const session = newSession(4);
    const seat = session.claimFreeSeat();
    if (!seat) return;

    const view = session.publicView();
    expect(view.players.find((p) => p.id === seat.playerId)?.connected).toBe(true);
    expect(view.players.filter((p) => p.connected)).toHaveLength(1);
  });

  it('sert une vue privée par joueur', () => {
    const session = newSession(4);
    expect(session.privateView('p1')?.id).toBe('p1');
    expect(session.privateView('inconnu')).toBeUndefined();
  });
});

describe('sièges jamais joués', () => {
  /**
   * Le cas réel : un joueur ouvre la page, la recharge avant d'avoir agi.
   * Sans cette règle, chaque rechargement consommerait un siège pour de bon
   * — à huit joueurs, deux suffiraient à rendre la partie injouable.
   */
  it('libère un siège quitté sans avoir jamais joué', () => {
    const session = newSession(3);
    const first = session.claimFreeSeat('Pierre');
    expect(first).toBeDefined();
    if (!first) return;

    session.disconnect(first.playerId);
    const second = session.claimFreeSeat('Pierre');

    // Le même siège est rendu, aucun n'est gaspillé.
    expect(second?.playerId).toBe(first.playerId);
  });

  it('conserve en revanche un siège qui a joué', () => {
    const session = newSession(3);
    const seat = session.claimFreeSeat('Pierre');
    if (!seat) return;

    const state = session.state;
    const spot = settlementSpots(state.board, seat.playerId, { setupPhase: true })[0] as VertexId;
    session.submit(cmd('PLACE_SETUP_SETTLEMENT', seat.playerId, { vertex: spot }));

    session.disconnect(seat.playerId);
    const other = session.claimFreeSeat('Marc');

    // Le siège de Pierre lui reste : seul son jeton le rendra.
    expect(other?.playerId).not.toBe(seat.playerId);
    expect(session.reconnect(seat.token)?.playerId).toBe(seat.playerId);
  });

  it('propage le nom choisi jusqu à la vue publique', () => {
    const session = newSession(4);
    const seat = session.claimFreeSeat('Pierre');
    if (!seat) return;

    // Les deux doivent rester synchronisés : la vue publique lit le nom du
    // joueur, pas celui du siège.
    expect(seat.name).toBe('Pierre');
    expect(session.publicView().players.find((p) => p.id === seat.playerId)?.name).toBe('Pierre');
  });
});

/**
 * Fait avancer la mise en place : les sièges occupés jouent à la main, les
 * autres sont pris en charge par la session au battement suivant.
 */
function driveSetup(session: GameSession, mine: readonly (string | undefined)[]): void {
  const state = session.state;
  for (let guard = 0; guard < 60 && state.phase === 'setup'; guard++) {
    const head = state.setupQueue[0];
    if (head !== undefined && mine.includes(head)) {
      let spot = state.setupPendingVertex;
      if (spot === undefined) {
        spot = settlementSpots(state.board, head, { setupPhase: true })[0] as VertexId;
        session.submit(cmd('PLACE_SETUP_SETTLEMENT', head, { vertex: spot }));
        spot = state.setupPendingVertex;
      }
      const edge = state.board.graph
        .edgesOfVertexOnBoard(spot as VertexId)
        .find((e) => state.board.roadAt(e) === undefined) as string;
      session.submit(cmd('PLACE_SETUP_ROAD', head, { edge }));
      continue;
    }
    if (session.tick().length === 0) break;
  }
}

describe('salon d attente', () => {
  /**
   * Le cas qui motive tout : les invités d'une soirée arrivent en ordre
   * dispersé. Sans salon, les premiers connectés dérouleraient la mise en
   * place pendant que les autres cherchent encore l'adresse.
   */
  it('ne joue rien tant que l hôte n a pas lancé', () => {
    const time = clock();
    const session = lobbySession(4, time);
    session.claimFreeSeat('Pierre');

    expect(session.isStarted).toBe(false);
    expect(session.remainingMs()).toBeUndefined();

    time.advance(10 * 60 * 1000);
    expect(session.tick()).toHaveLength(0);
    expect(session.state.phase).toBe('setup');
    expect(session.commandLog()).toHaveLength(0);
  });

  it('refuse les commandes avant le lancement', () => {
    const session = lobbySession(4);
    const seat = session.claimFreeSeat('Pierre');
    if (!seat) throw new Error('siège absent');

    const spot = settlementSpots(session.state.board, seat.playerId, { setupPhase: true })[0] as VertexId;
    const outcome = session.submit(cmd('PLACE_SETUP_SETTLEMENT', seat.playerId, { vertex: spot }));

    expect(outcome.result.ok).toBe(false);
    expect(session.commandLog()).toHaveLength(0);
  });

  it('annonce le salon dans la vue publique', () => {
    const session = lobbySession(4);
    expect(session.publicView().started).toBe(false);
    session.start();
    expect(session.publicView().started).toBe(true);
  });

  it('compte les joueurs présents, pour que l hôte sache qui attendre', () => {
    const session = lobbySession(4);
    expect(session.connectedCount()).toBe(0);
    session.claimFreeSeat('Pierre');
    session.claimFreeSeat('Hélène');
    expect(session.connectedCount()).toBe(2);
  });

  it('ne se lance qu une fois', () => {
    const session = lobbySession(4);
    expect(session.start()).toBe(true);
    expect(session.start()).toBe(false);
  });

  /**
   * L'hôte lance à trois alors que quatre sièges existent.
   *
   * Pendant la mise en place, la partie attend légitimement le joueur en
   * tête de file. Le siège vide ne pose problème que lorsque *son* tour
   * arrive : sans traitement, il n'a jamais été « quitté » et personne ne
   * jouerait jamais pour lui.
   */
  it('ne se fige pas sur un siège que personne n a pris', () => {
    const session = lobbySession(4);
    const mine = [
      session.claimFreeSeat('Pierre'),
      session.claimFreeSeat('Hélène'),
      session.claimFreeSeat('Nikos'),
    ].map((seat) => seat?.playerId);
    session.start();

    driveSetup(session, mine);

    // La mise en place est allée jusqu'au bout, siège vide compris.
    expect(session.state.phase).not.toBe('setup');
  });

  /**
   * Un siège joué d'office reste disponible : mieux vaut un retardataire
   * qu'un automate jusqu'à la fin de la soirée.
   */
  it('laisse un retardataire prendre un siège joué d office', () => {
    const session = lobbySession(3);
    const mine = [session.claimFreeSeat('Pierre')?.playerId];
    session.start();

    driveSetup(session, mine);
    // Les deux sièges vides ont bien été joués par la session.
    expect(session.commandLog().some((c) => c.actionId.startsWith('sys-'))).toBe(true);

    const late = session.claimFreeSeat('Marc');
    expect(late).toBeDefined();
    expect(late?.name).toBe('Marc');
  });
});

describe('mise en place chronométrée', () => {
  /**
   * Le cas observé en test : un joueur rejoint, laisse sa page ouverte et
   * s'éloigne. La mise en place n'ayant aucun délai, la table entière
   * l'attendait sans recours — ni bot, ni passage en force.
   */
  it('joue pour un joueur présent mais inactif', () => {
    const time = clock();
    const session = lobbySession(4, time);
    for (let i = 0; i < 4; i++) session.claimFreeSeat();
    session.start();

    expect(session.state.phase).toBe('setup');
    // Personne ne joue : le chronomètre est la seule issue.
    expect(session.remainingMs()).toBeGreaterThan(0);

    time.advance(session.state.config.setupSeconds * 1000 + 1000);
    const events = session.tick();

    expect(events.length).toBeGreaterThan(0);
    expect(session.state.board.allBuildings().size).toBeGreaterThan(0);
  });

  it('laisse le temps de réfléchir avant de trancher', () => {
    const time = clock();
    const session = lobbySession(4, time);
    for (let i = 0; i < 4; i++) session.claimFreeSeat();
    session.start();

    // Bien avant l'échéance, rien ne se passe : le placement appartient au
    // joueur tant qu'il lui reste du temps.
    time.advance(5000);
    expect(session.tick()).toHaveLength(0);
    expect(session.state.board.allBuildings().size).toBe(0);
  });
});
