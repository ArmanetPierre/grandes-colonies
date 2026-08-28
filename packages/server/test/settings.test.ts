/**
 * Les réglages de partie, tels que l'écran de l'hôte les manœuvre.
 *
 * Deux exigences les guident, et aucune ne se vérifie sans réseau :
 *
 *   — **personne ne perd sa place.** Changer un réglage reconstruit la
 *     partie ; si l'opération coûtait son siège à un invité déjà installé,
 *     l'hôte n'oserait plus y toucher.
 *
 *   — **les bots cèdent avant les humains.** Quand l'effectif descend sous le
 *     nombre de connectés, il faut bien que quelqu'un sorte. Jamais celui qui
 *     vient de scanner le QR code.
 */

import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';

import { GameServer, configFor, normaliseSettings } from '../src/gameServer.js';
import { GameSession } from '../src/session.js';

let nextPort = 2700;

async function withServer<T>(run: (url: string, server: GameServer) => Promise<T>): Promise<T> {
  const port = nextPort++;
  const server = new GameServer({ seed: 'reglages', playerNames: ['A', 'B', 'C', 'D'], tickMs: 40 });
  await server.listen(port);
  try {
    return await run(`ws://localhost:${port}`, server);
  } finally {
    await server.close();
  }
}

/** Un client minimal : il rejoint, et retient le siège qu'on lui donne. */
async function join(url: string, name: string, bot = false): Promise<{
  socket: WebSocket; seats: string[]; full: boolean;
}> {
  const socket = new WebSocket(url);
  const state = { socket, seats: [] as string[], full: false };
  socket.on('message', (raw) => {
    const frame = JSON.parse(String(raw)) as { type: string; payload: Record<string, unknown> };
    if (frame.type === 'seat') state.seats.push(frame.payload['playerId'] as string);
    if (frame.type === 'full') state.full = true;
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.send(JSON.stringify({ type: 'join', name, ...(bot ? { bot: true } : {}) }));
  return state;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('bornes des réglages', () => {
  it('ramène toute valeur aberrante dans le jouable', () => {
    const settings = normaliseSettings({
      playerCount: 99, victoryTarget: 1, activeTurnSeconds: -30, tradingWindowSeconds: 9999,
    });
    expect(settings.playerCount).toBe(12);
    expect(settings.victoryTarget).toBe(6);
    expect(settings.activeTurnSeconds).toBe(20);
    expect(settings.tradingWindowSeconds).toBe(180);
  });

  it('n accepte que les deux formes de plateau connues', () => {
    expect(normaliseSettings({ boardKind: 'triangle' as never }).boardKind).toBe('archipelago');
    expect(normaliseSettings({ boardKind: 'disc' }).boardKind).toBe('disc');
  });
});

describe('configuration dérivée', () => {
  it('reporte l objectif et les durées choisis', () => {
    const config = configFor(normaliseSettings({
      playerCount: 12, victoryTarget: 12, activeTurnSeconds: 45, tradingWindowSeconds: 0,
    }));
    expect(config.victory.target).toBe(12);
    expect(config.activeTurnSeconds).toBe(45);
    // Le tour de l'associé se joue en même temps que celui du joueur actif :
    // deux durées différentes n'auraient aucun sens à la table.
    expect(config.pairedTurnSeconds).toBe(45);
    expect(config.tradingWindowSeconds).toBe(0);
  });

  it('laisse l effectif décider de ce qui en dépend', () => {
    // Limite de main (§24) et second voleur (§25) suivent le nombre de
    // joueurs : les figer dans les réglages les aurait désynchronisés.
    expect(configFor(normaliseSettings({ playerCount: 6 })).robberCount).toBe(1);
    expect(configFor(normaliseSettings({ playerCount: 12 })).robberCount).toBe(2);
    expect(configFor(normaliseSettings({ playerCount: 6 })).handLimit).toBe(7);
    expect(configFor(normaliseSettings({ playerCount: 12 })).handLimit).toBe(13);
  });
});

describe('mise en place', () => {
  /**
   * Le geste qui décide de toute la partie ne se perd pas parce qu'un
   * voisin a hésité.
   *
   * La mise en place est une phase unique de vingt-quatre poses à douze
   * joueurs. À l'expiration du chronomètre, la session jouait d'office pour
   * tout le monde jusqu'au changement de phase : une seule expiration
   * plaçait les colonies et les routes de la table entière, y compris celles
   * des joueurs présents qui attendaient encore leur tour.
   */
  it('ne joue d office que pour celui qui retient la table', async () => {
    let clock = 0;
    const session = new GameSession({
      seed: 'pose',
      playerNames: ['Camille', 'Dominique', 'Alix', 'Sacha'],
      config: { ...configFor(normaliseSettings({ playerCount: 4 })), setupSeconds: 10 },
      now: () => clock,
    });
    session.start();
    // Tout le monde est là : personne n'est « absent » à remplacer.
    for (const seat of session.allSeats()) session.reconnect(seat.token);

    clock += 11_000;
    session.tick();

    const placed = session.publicView().buildings.length;
    expect(placed).toBe(1);
    // Et le suivant repart avec son délai entier, pas avec le reliquat.
    expect(session.remainingMs()).toBe(10_000);
  });

  it('déroule en revanche la table quand personne n est là', async () => {
    let clock = 0;
    const session = new GameSession({
      seed: 'pose',
      playerNames: ['A', 'B', 'C', 'D'],
      config: { ...configFor(normaliseSettings({ playerCount: 4 })), setupSeconds: 10 },
      now: () => clock,
    });
    session.start();

    clock += 11_000;
    session.tick();

    // Aucun siège réclamé : la partie doit se dérouler seule plutôt que de
    // se figer sur un joueur qui n'existe pas.
    expect(session.publicView().buildings.length).toBeGreaterThan(1);
  });
});

describe('reconfiguration en salon', () => {
  it('applique les réglages et refait le plateau', async () => withServer(async (_url, server) => {
    const before = server.session.publicView().hexes.length;
    const outcome = server.reconfigure({ playerCount: 12, boardKind: 'disc', victoryTarget: 12 });

    expect(outcome.ok).toBe(true);
    expect(server.settings.playerCount).toBe(12);
    expect(server.session.allSeats()).toHaveLength(12);
    expect(server.session.publicView().hexes.length).not.toBe(before);
  }));

  it('rend son siège à qui était déjà là, avec un jeton neuf', async () => withServer(async (url, server) => {
    const player = await join(url, 'Camille');
    await pause(120);
    expect(player.seats).toHaveLength(1);

    server.reconfigure({ playerCount: 8 });
    await pause(150);

    // Un second siège reçu, donc un jeton neuf rangé côté client : personne
    // n'a eu à recharger sa page.
    expect(player.seats).toHaveLength(2);
    expect(player.full).toBe(false);
    const seat = server.session.allSeats().find((s) => s.connected);
    expect(seat?.name).toBe('Camille');
    player.socket.close();
  }));

  it('retire d abord leur siège aux adversaires automatiques', async () => withServer(async (url, server) => {
    server.reconfigure({ playerCount: 6 });

    // Les bots arrivent au démarrage, l'invité après : c'est l'ordre qui
    // faisait de lui la victime avant qu'on ne les distingue.
    const bots = [];
    for (let i = 1; i <= 5; i++) bots.push(await join(url, `Bot ${i}`, true));
    await pause(120);
    const human = await join(url, 'Camille');
    await pause(150);
    expect(server.session.connectedCount()).toBe(6);

    // Six connectés pour six sièges ; on descend à quatre.
    server.reconfigure({ playerCount: 4 });
    await pause(250);

    expect(human.full).toBe(false);
    expect(bots.filter((b) => b.full)).toHaveLength(2);
    const names = server.session.allSeats().filter((s) => s.connected).map((s) => s.name);
    expect(names).toContain('Camille');
    for (const client of [...bots, human]) client.socket.close();
  }));

  it('refuse de changer quoi que ce soit une fois la partie lancée', async () => withServer(async (_url, server) => {
    server.startGame();
    const outcome = server.reconfigure({ playerCount: 4 });

    expect(outcome.ok).toBe(false);
    // Les quatre sièges du départ, intacts.
    expect(server.settings.playerCount).toBe(4);
    expect(server.session.allSeats()).toHaveLength(4);
  }));
});
