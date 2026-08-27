import { WebSocket } from 'ws';
import { describe, expect, it } from 'vitest';

import { GameServer } from '../src/gameServer.js';

/**
 * Spike réseau — les critères de sortie de la Phase 2 du plan.
 *
 * Ces tests montent un vrai serveur et de vrais clients WebSocket. Ils
 * vérifient ce qu'aucun test en mémoire ne peut vérifier : qu'un
 * rafraîchissement de page rend bien son siège, et qu'une main privée ne
 * traverse jamais le réseau.
 */

let nextPort = 2600;
const PLAYERS = 12;

/**
 * Un serveur neuf par test.
 *
 * Les sièges ne se recyclent pas : un joueur qui part garde le sien, et seul
 * son jeton peut le rendre. Partager un serveur entre tests épuiserait donc
 * les douze sièges dès le premier.
 */
async function withServer<T>(run: (url: string) => Promise<T>): Promise<T> {
  const port = nextPort++;
  const server = new GameServer({
    seed: 'reseau',
    playerNames: Array.from({ length: PLAYERS }, (_, i) => `J${i + 1}`),
    // Battement rapide : les tests n'attendent pas un quart de seconde.
    tickMs: 40,
  });
  await server.listen(port);
  try {
    return await run(`ws://localhost:${port}`);
  } finally {
    await server.close();
  }
}

interface Frame { type: string; payload: Record<string, unknown> }

/** Un client de test qui mémorise tout ce qu'il reçoit. */
class TestClient {
  readonly received: Frame[] = [];
  private constructor(private readonly socket: WebSocket) {}

  static async connect(url: string): Promise<TestClient> {
    const socket = new WebSocket(url);
    const client = new TestClient(socket);
    socket.on('message', (raw) => client.received.push(JSON.parse(String(raw)) as Frame));
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    return client;
  }

  send(message: unknown): void {
    this.socket.send(JSON.stringify(message));
  }

  /** Attend une trame d'un type donné, sans jamais bloquer indéfiniment. */
  async waitFor(type: string, timeoutMs = 3000): Promise<Frame> {
    const started = Date.now();
    for (;;) {
      const frame = this.received.find((f) => f.type === type);
      if (frame) return frame;
      if (Date.now() - started > timeoutMs) throw new Error(`aucune trame « ${type} »`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  framesOf(type: string): Frame[] {
    return this.received.filter((f) => f.type === type);
  }

  close(): Promise<void> {
    // Le serveur ferme lui-même la connexion d'un joueur refusé : attendre
    // un événement « close » déjà survenu bloquerait indéfiniment.
    if (this.socket.readyState === this.socket.CLOSED) return Promise.resolve();

    return new Promise((resolve) => {
      const done = () => resolve();
      this.socket.once('close', done);
      this.socket.close();
      // Filet de sécurité : une fermeture perdue ne doit pas figer la suite.
      setTimeout(done, 500);
    });
  }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('spike réseau', () => {
  it('accepte douze clients simultanés et leur donne douze sièges distincts', async () => withServer(async (url) => {
    const clients: TestClient[] = [];
    const seats: string[] = [];
    const tokens: string[] = [];

    for (let i = 0; i < PLAYERS; i++) {
      const client = await TestClient.connect(url);
      clients.push(client);
      client.send({ type: 'join', name: `Test ${i}` });
      const seat = await client.waitFor('seat');
      seats.push(seat.payload['playerId'] as string);
      tokens.push(seat.payload['token'] as string);
    }

    expect(new Set(seats).size).toBe(PLAYERS);
    // Chaque jeton est unique : c'est lui qui protège un siège.
    expect(new Set(tokens).size).toBe(PLAYERS);

    for (const client of clients) await client.close();
    await pause(150);
  }), 30000);

  it('refuse un treizième joueur sur une partie à douze', async () => withServer(async (url) => {
    const clients: TestClient[] = [];
    for (let i = 0; i < PLAYERS; i++) {
      const client = await TestClient.connect(url);
      clients.push(client);
      client.send({ type: 'join' });
      await client.waitFor('seat');
    }

    const extra = await TestClient.connect(url);
    extra.send({ type: 'join' });
    const refusal = await extra.waitFor('full');
    expect(refusal.payload['reason']).toBeDefined();

    await extra.close();
    for (const client of clients) await client.close();
    await pause(150);
  }), 30000);

  /**
   * Un rafraîchissement de page, c'est exactement cela : la connexion meurt,
   * le jeton survit dans le navigateur.
   */
  it('rend son siège après un rafraîchissement de page', async () => withServer(async (url) => {
    const first = await TestClient.connect(url);
    first.send({ type: 'join', name: 'Pierre' });
    const seat = await first.waitFor('seat');
    const token = seat.payload['token'] as string;
    const playerId = seat.payload['playerId'] as string;

    await first.close();
    await pause(100);

    const second = await TestClient.connect(url);
    second.send({ type: 'join', token });
    const back = await second.waitFor('seat');

    expect(back.payload['playerId']).toBe(playerId);

    await second.close();
    await pause(150);
  }), 20000);

  it('donne un siège neuf à qui arrive sans jeton', async () => withServer(async (url) => {
    const a = await TestClient.connect(url);
    a.send({ type: 'join' });
    const seatA = await a.waitFor('seat');

    const b = await TestClient.connect(url);
    b.send({ type: 'join' });
    const seatB = await b.waitFor('seat');

    expect(seatB.payload['playerId']).not.toBe(seatA.payload['playerId']);

    await a.close();
    await b.close();
    await pause(150);
  }), 20000);

  /**
   * Le critère le plus important du spike : une information privée ne doit
   * jamais atteindre un autre client. On l'éprouve sur le réseau réel, et
   * pas seulement sur la fonction qui construit la vue.
   */
  it('n envoie jamais la vue privée d un joueur à un autre', async () => withServer(async (url) => {
    const a = await TestClient.connect(url);
    a.send({ type: 'join' });
    const seatA = await a.waitFor('seat');
    const idA = seatA.payload['playerId'] as string;

    const b = await TestClient.connect(url);
    b.send({ type: 'join' });
    const seatB = await b.waitFor('seat');
    const idB = seatB.payload['playerId'] as string;

    await pause(200);

    // Toutes les vues privées reçues par B lui appartiennent.
    const privates = b.framesOf('private');
    expect(privates.length).toBeGreaterThan(0);
    for (const frame of privates) expect(frame.payload['id']).toBe(idB);

    // Et le jeton de A n'a jamais transité par B.
    expect(JSON.stringify(b.received)).not.toContain(seatA.payload['token'] as string);
    expect(idA).not.toBe(idB);

    await a.close();
    await b.close();
    await pause(150);
  }), 20000);

  it('signale une déconnexion aux autres joueurs', async () => withServer(async (url) => {
    const a = await TestClient.connect(url);
    a.send({ type: 'join' });
    const seatA = await a.waitFor('seat');
    const idA = seatA.payload['playerId'] as string;

    const b = await TestClient.connect(url);
    b.send({ type: 'join' });
    await b.waitFor('seat');

    await a.close();
    await pause(250);

    const latest = b.framesOf('public').at(-1);
    const players = latest?.payload['players'] as { id: string; connected: boolean }[];
    expect(players.find((p) => p.id === idA)?.connected).toBe(false);

    await b.close();
    await pause(150);
  }), 20000);

  it('refuse une commande jouée au nom d un autre siège', async () => withServer(async (url) => {
    const a = await TestClient.connect(url);
    a.send({ type: 'join' });
    const seatA = await a.waitFor('seat');

    const b = await TestClient.connect(url);
    b.send({ type: 'join' });
    const seatB = await b.waitFor('seat');

    // B tente de jouer sous l'identité de A. Le serveur impose l'identité du
    // siège : la commande devient celle de B, qui n'est pas actif.
    b.send({
      type: 'command',
      command: { actionId: 'usurpation', type: 'ROLL_DICE', playerId: seatA.payload['playerId'] },
    });

    const rejection = await b.waitFor('rejected');
    expect(rejection.payload['reason']).toBeDefined();
    expect(seatB.payload['playerId']).not.toBe(seatA.payload['playerId']);

    await a.close();
    await b.close();
    await pause(150);
  }), 20000);

  it('ignore un message illisible sans tomber', async () => withServer(async (url) => {
    const a = await TestClient.connect(url);
    a.send({ type: 'join' });
    await a.waitFor('seat');

    // Onze autres joueurs ne doivent pas pâtir d'un client fautif.
    a.send('ceci n est pas du JSON valide {{{');
    await pause(150);

    const b = await TestClient.connect(url);
    b.send({ type: 'join' });
    await expect(b.waitFor('seat')).resolves.toBeDefined();

    await a.close();
    await b.close();
    await pause(150);
  }), 20000);
});

describe('robustesse du transport', () => {
  /**
   * Une soirée à douze ne doit pas pouvoir être coupée par un seul message
   * malformé. Le cas n'est pas théorique : pendant le développement, un autre
   * programme de la machine s'est connecté au port et a pris un siège.
   */
  it('survit à une commande de type inconnu', () => withServer(async (url) => {
    const client = await TestClient.connect(url);
    client.send({ type: 'join', name: 'Alpha' });
    await client.waitFor('seat');

    client.send({ type: 'command', command: { actionId: 'z1', type: 'PAS_UNE_COMMANDE' } });
    const rejection = await client.waitFor('rejected');
    expect(rejection.payload['reason']).toBe('unknown-command');

    // Le serveur est toujours là : il répond encore à un autre joueur.
    const second = await TestClient.connect(url);
    second.send({ type: 'join', name: 'Beta' });
    expect(await second.waitFor('seat')).toBeDefined();

    await client.close();
    await second.close();
  }));

  it('ignore un message sans identifiant d action', () => withServer(async (url) => {
    const client = await TestClient.connect(url);
    client.send({ type: 'join', name: 'Alpha' });
    await client.waitFor('seat');

    // Sans actionId, la déduplication n'a plus de clé : on ne joue pas.
    client.send({ type: 'command', command: { type: 'ROLL_DICE' } });
    await pause(120);

    const second = await TestClient.connect(url);
    second.send({ type: 'join', name: 'Beta' });
    expect(await second.waitFor('seat')).toBeDefined();

    await client.close();
    await second.close();
  }));

  it('ne tombe pas sur un JSON illisible', () => withServer(async (url) => {
    const client = await TestClient.connect(url);
    client.send({ type: 'join', name: 'Alpha' });
    await client.waitFor('seat');

    (client as unknown as { socket: WebSocket }).socket.send('{ ceci n est pas du JSON');
    await pause(120);

    const second = await TestClient.connect(url);
    second.send({ type: 'join', name: 'Beta' });
    expect(await second.waitFor('seat')).toBeDefined();

    await client.close();
    await second.close();
  }));
});
