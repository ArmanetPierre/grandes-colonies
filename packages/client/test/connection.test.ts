import { describe, expect, it } from 'vitest';

import {
  type ConnectionStatus,
  type SeatInfo,
  type WebSocketLike,
  GameConnection,
  memoryStorage,
  newActionId,
} from '../src/net/connection.js';

/** Un faux socket, piloté à la main — aucun réseau dans ces tests. */
class FakeSocket implements WebSocketLike {
  readonly sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((e: unknown) => void) | null = null;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  closed = false;

  send(data: string): void { this.sent.push(data); }
  close(): void { this.closed = true; this.onclose?.(); }

  open(): void { this.onopen?.(); }
  deliver(type: string, payload: unknown): void {
    this.onmessage?.({ data: JSON.stringify({ type, payload }) });
  }
  parsedSent(): { type: string; [k: string]: unknown }[] {
    return this.sent.map((s) => JSON.parse(s) as { type: string });
  }
}

/** Fabrique qui mémorise chaque socket créé, pour observer les tentatives. */
function socketFactory() {
  const sockets: FakeSocket[] = [];
  return {
    sockets,
    create: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  };
}

/** Ordonnanceur manuel : les tests n'attendent jamais réellement. */
function scheduler() {
  const pending: (() => void)[] = [];
  return {
    schedule: (fn: () => void) => void pending.push(fn),
    runAll: () => {
      const queued = pending.splice(0);
      for (const fn of queued) fn();
    },
    get size() { return pending.length; },
  };
}

describe('poignée de main', () => {
  it('demande un siège neuf sans jeton mémorisé', () => {
    const factory = socketFactory();
    const connection = new GameConnection({
      url: 'ws://test', name: 'Pierre',
      storage: memoryStorage(), createSocket: factory.create,
    });

    connection.connect();
    factory.sockets[0]?.open();

    const join = factory.sockets[0]?.parsedSent()[0];
    expect(join?.['type']).toBe('join');
    expect(join?.['name']).toBe('Pierre');
    expect(join?.['token']).toBeUndefined();
  });

  /**
   * Le point qui compte : après un rafraîchissement, le jeton est rejoué et
   * rend le siège d'origine.
   */
  it('rejoue le jeton mémorisé à la connexion suivante', () => {
    const storage = memoryStorage();
    const first = socketFactory();

    const a = new GameConnection({ url: 'ws://test', storage, createSocket: first.create });
    a.connect();
    first.sockets[0]?.open();
    first.sockets[0]?.deliver('seat', { playerId: 'p3', token: 'jeton-p3', name: 'Pierre' });

    // Nouvelle page, nouvelle connexion, même stockage.
    const second = socketFactory();
    const b = new GameConnection({ url: 'ws://test', storage, createSocket: second.create });
    b.connect();
    second.sockets[0]?.open();

    const join = second.sockets[0]?.parsedSent()[0];
    expect(join?.['token']).toBe('jeton-p3');
  });

  it('mémorise le jeton dès sa réception', () => {
    const storage = memoryStorage();
    const factory = socketFactory();
    const connection = new GameConnection({ url: 'ws://test', storage, createSocket: factory.create });

    connection.connect();
    factory.sockets[0]?.open();
    expect(connection.token).toBeNull();

    factory.sockets[0]?.deliver('seat', { playerId: 'p1', token: 'abc', name: 'J1' });
    expect(connection.token).toBe('abc');
  });

  it('transmet le siège reçu', () => {
    const factory = socketFactory();
    const seats: SeatInfo[] = [];
    const connection = new GameConnection(
      { url: 'ws://test', storage: memoryStorage(), createSocket: factory.create },
      { onSeat: (seat) => seats.push(seat) },
    );

    connection.connect();
    factory.sockets[0]?.open();
    factory.sockets[0]?.deliver('seat', { playerId: 'p2', token: 't', name: 'Marc' });

    expect(seats).toEqual([{ playerId: 'p2', token: 't', name: 'Marc' }]);
  });
});

describe('reconnexion automatique', () => {
  /**
   * Sur un réseau domestique avec douze appareils, une coupure d'une seconde
   * est banale. Personne ne doit avoir à recharger la page.
   */
  it('retente après une coupure', () => {
    const factory = socketFactory();
    const clock = scheduler();
    const connection = new GameConnection({
      url: 'ws://test', storage: memoryStorage(),
      createSocket: factory.create, setTimeoutFn: clock.schedule,
    });

    connection.connect();
    factory.sockets[0]?.open();
    expect(factory.sockets).toHaveLength(1);

    factory.sockets[0]?.close();
    expect(clock.size).toBe(1);

    clock.runAll();
    expect(factory.sockets).toHaveLength(2);
  });

  it('espace les tentatives successives', () => {
    const factory = socketFactory();
    const delays: number[] = [];
    const connection = new GameConnection({
      url: 'ws://test', storage: memoryStorage(),
      createSocket: factory.create,
      retryDelaysMs: [100, 400, 900],
      setTimeoutFn: (fn, ms) => { delays.push(ms); fn(); },
    });

    connection.connect();
    for (let i = 0; i < 3; i++) factory.sockets[i]?.close();

    // Les délais croissent : une panne durable n'inonde pas le serveur.
    expect(delays).toEqual([100, 400, 900]);
  });

  it('cesse de retenter après une fermeture volontaire', () => {
    const factory = socketFactory();
    const clock = scheduler();
    const connection = new GameConnection({
      url: 'ws://test', storage: memoryStorage(),
      createSocket: factory.create, setTimeoutFn: clock.schedule,
    });

    connection.connect();
    factory.sockets[0]?.open();
    connection.close();

    expect(clock.size).toBe(0);
    expect(factory.sockets).toHaveLength(1);
  });

  // Insister sur une partie complète n'apporterait rien qu'un martèlement.
  it('cesse de retenter quand la partie est complète', () => {
    const factory = socketFactory();
    const clock = scheduler();
    const statuses: ConnectionStatus[] = [];
    const connection = new GameConnection(
      {
        url: 'ws://test', storage: memoryStorage(),
        createSocket: factory.create, setTimeoutFn: clock.schedule,
      },
      { onStatus: (s) => statuses.push(s) },
    );

    connection.connect();
    factory.sockets[0]?.open();
    factory.sockets[0]?.deliver('full', { reason: 'partie complète' });
    factory.sockets[0]?.close();

    expect(statuses).toContain('full');
    expect(clock.size).toBe(0);
  });

  it('annonce ses changements d état', () => {
    const factory = socketFactory();
    const clock = scheduler();
    const statuses: ConnectionStatus[] = [];
    const connection = new GameConnection(
      {
        url: 'ws://test', storage: memoryStorage(),
        createSocket: factory.create, setTimeoutFn: clock.schedule,
      },
      { onStatus: (s) => statuses.push(s) },
    );

    connection.connect();
    factory.sockets[0]?.open();
    factory.sockets[0]?.close();

    expect(statuses).toEqual(['connecting', 'open', 'reconnecting']);
  });
});

describe('réception', () => {
  function connected() {
    const factory = socketFactory();
    const received: Record<string, unknown[]> = { public: [], private: [], events: [], timer: [], rejected: [] };
    const connection = new GameConnection(
      { url: 'ws://test', storage: memoryStorage(), createSocket: factory.create },
      {
        onPublic: (v) => received['public']?.push(v),
        onPrivate: (v) => received['private']?.push(v),
        onEvents: (v) => received['events']?.push(v),
        onTimer: (v) => received['timer']?.push(v),
        onRejected: (v) => received['rejected']?.push(v),
      },
    );
    connection.connect();
    factory.sockets[0]?.open();
    return { connection, socket: factory.sockets[0] as FakeSocket, received };
  }

  it('aiguille chaque type de trame', () => {
    const { socket, received } = connected();

    socket.deliver('public', { cycle: 3 });
    socket.deliver('private', { id: 'p1' });
    socket.deliver('events', [{ type: 'DiceRolled' }]);
    socket.deliver('timer', { remainingMs: 42, phase: 'activeTurn' });
    socket.deliver('rejected', { actionId: 'a1', reason: 'not-your-turn' });

    expect(received['public']).toHaveLength(1);
    expect(received['private']).toHaveLength(1);
    expect(received['events']).toHaveLength(1);
    expect(received['timer']).toHaveLength(1);
    expect(received['rejected']).toHaveLength(1);
  });

  it('ignore une trame illisible sans casser l interface', () => {
    const { socket, received } = connected();
    socket.onmessage?.({ data: 'ceci n est pas du JSON' });
    socket.deliver('public', { cycle: 1 });
    expect(received['public']).toHaveLength(1);
  });

  it('ignore un type inconnu', () => {
    const { socket, received } = connected();
    socket.deliver('type-du-futur', { peu: 'importe' });
    expect(Object.values(received).every((list) => list.length === 0)).toBe(true);
  });
});

describe('envoi de commandes', () => {
  it('emballe la commande dans une trame', () => {
    const factory = socketFactory();
    const connection = new GameConnection({
      url: 'ws://test', storage: memoryStorage(), createSocket: factory.create,
    });
    connection.connect();
    factory.sockets[0]?.open();

    connection.send({ actionId: 'a1', type: 'ROLL_DICE' });

    const frame = factory.sockets[0]?.parsedSent().at(-1);
    expect(frame?.['type']).toBe('command');
    expect((frame?.['command'] as { type: string }).type).toBe('ROLL_DICE');
  });
});

describe('identifiants d action', () => {
  // C'est lui qui permet au serveur d'ignorer un double clic.
  it('ne se répète pas', () => {
    const ids = new Set(Array.from({ length: 500 }, () => newActionId()));
    expect(ids.size).toBe(500);
  });
});
