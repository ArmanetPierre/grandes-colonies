/**
 * Point d'entrée de l'hôte — le programme lancé sur le PC qui héberge.
 *
 * Il démarre le serveur de jeu et sert l'écran de l'hôte sur le même port.
 * Un seul port, une seule adresse à retenir : le premier obstacle d'une
 * soirée n'est pas le jeu mais la connexion, et personne ne devrait avoir à
 * chercher une adresse IP dans les réglages système.
 */

import { type ChildProcess, spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import QRCode from 'qrcode';

import { type GameSettings, GameServer, SETTINGS_LIMITS } from '@grand-colonies/server';

import { renderHostPage } from './hostPage.js';

const PORT = Number(process.env['PORT'] ?? 2567);

/** L'illustration de fond, partagée avec le client. */
const BACKGROUND = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../assets/generated/backgrounds/bg_host.jpg',
);

/**
 * L'adresse IPv4 de la machine sur le réseau local.
 *
 * On écarte la boucle locale et les interfaces internes : elles fonctionnent
 * sur le PC hôte mais ne mènent nulle part depuis le téléphone d'un invité.
 */
export function lanAddress(): string | undefined {
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      return address.address;
    }
  }
  return undefined;
}

/** Un code de partie lisible à voix haute, plutôt qu'un identifiant opaque. */
export function readableCode(seed: string): string {
  const words = ['AGORA', 'OLIVIER', 'MARBRE', 'EGEE', 'AMPHORE', 'CYPRES', 'PORPHYRE', 'LAURIER'];
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const word = words[hash % words.length] ?? 'AGORA';
  return `${word}-${(hash % 90) + 10}`;
}

/** La racine du dépôt, d'où se lancent les adversaires automatiques. */
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

/**
 * Les adversaires automatiques, pilotés depuis l'écran de l'hôte.
 *
 * Ils vivaient dans une variable d'environnement lue au démarrage : pour
 * passer de sept à dix bots il fallait tout relancer, et les joueurs déjà
 * connectés perdaient leur siège. Le programme les tient donc lui-même, dans
 * un processus qu'il sait arrêter et rouvrir.
 *
 * C'est délibérément un processus séparé et non un module importé : ces bots
 * passent par le même WebSocket que tout le monde, et rien ne doit leur
 * ouvrir un raccourci vers l'état de la partie.
 */
class BotTable {
  private child: ChildProcess | undefined;
  private wanted = 0;
  private failure: string | undefined;

  constructor(private readonly port: number) {}

  get status(): { count: number; running: boolean; error?: string } {
    return {
      count: this.wanted,
      running: this.child !== undefined && this.child.exitCode === null,
      ...(this.failure ? { error: this.failure } : {}),
    };
  }

  /*
   * Abattre l'arbre, pas seulement sa racine.
   *
   * Le processus lancé est `npx`, qui lance `tsx`, qui lance le node qui
   * tient les WebSockets. Un SIGTERM à `npx` ne descend pas jusqu'à lui :
   * les bots gardaient leur siège, et chaque changement d'effectif en
   * empilait de nouveaux par-dessus. La table se remplissait de doublons —
   * douze sièges pris par sept bots annoncés — et il ne restait plus une
   * place pour personne. On les lance donc dans leur propre groupe, et on
   * signale le groupe entier.
   */
  private tuer(child: ChildProcess | undefined): void {
    if (!child?.pid) return;
    try { process.kill(-child.pid, 'SIGTERM'); }
    catch { child.kill('SIGTERM'); }
  }

  stop(): void {
    this.tuer(this.child);
    this.child = undefined;
    this.wanted = 0;
  }

  /** Remplace la table de bots par une neuve, du nombre demandé. */
  set(count: number): void {
    this.tuer(this.child);
    this.child = undefined;
    this.failure = undefined;
    this.wanted = Math.max(0, Math.round(count));
    if (this.wanted === 0) return;

    const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const child = spawn(npx, ['tsx', 'scripts/bots.ts', String(this.wanted)], {
      cwd: ROOT,
      stdio: 'inherit',
      detached: true,
      env: { ...process.env, BOT_URL: `ws://localhost:${this.port}` },
    });
    // Un échec de lancement doit se lire à l'écran, pas seulement dans la
    // console : l'hôte regarde sa page, pas son terminal.
    child.on('error', (error) => {
      if (this.child !== child) return;
      this.failure = error.message;
      this.child = undefined;
    });
    child.on('exit', (code, signal) => {
      /*
       * La fin d'un processus déjà remplacé n'est pas une panne.
       *
       * Chaque changement de nombre relance la table : sans ce garde, le
       * SIGTERM qu'on vient d'envoyer revenait à l'écran en « les bots se
       * sont arrêtés (code 143) », juste après que dix bots neufs se
       * soient connectés sans encombre.
       */
      if (this.child !== child) return;
      this.child = undefined;
      if (signal !== null) return;
      if (code !== 0 && code !== null) this.failure = `les bots se sont arrêtés (code ${code})`;
    });
    this.child = child;
  }
}

/** Lit un corps de requête JSON, borné pour qu'aucun envoi ne puisse gonfler. */
async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > 8192) throw new Error('corps trop volumineux');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

export interface HostHandle {
  readonly port: number;
  readonly code: string;
  readonly url: string;
  close(): Promise<void>;
}

export async function startHost(playerCount = 8, port = PORT): Promise<HostHandle> {
  const seed = `partie-${Date.now()}`;
  const code = readableCode(seed);
  const host = lanAddress() ?? 'localhost';

  // En développement le client a son propre serveur ; en production il sera
  // servi par celui-ci. C'est l'adresse que les invités doivent ouvrir.
  const clientPort = Number(process.env['CLIENT_PORT'] ?? 5173);
  const url = `http://${host}:${clientPort}`;
  const qrDataUrl = await QRCode.toDataURL(url, { width: 420, margin: 1 });
  // La page ne connaît plus les réglages : ils changent en cours de salon,
  // et elle les lit désormais au fil de l'eau comme la liste des sièges.
  const page = renderHostPage({ url, code, qrDataUrl, limits: SETTINGS_LIMITS });

  // `BOARD=disque` pour une soirée plus courte : la simulation mesure 138
  // cycles à douze joueurs sur le disque, contre 216 sur l'archipel.
  const boardKind = process.env['BOARD'] === 'disque' ? 'disc' as const : 'archipelago' as const;

  const bots = new BotTable(port);

  const server: GameServer = new GameServer({
    seed,
    boardKind,
    playerNames: Array.from({ length: playerCount }, (_, i) => `Joueur ${i + 1}`),
    onRequest: (req, res) => {
      if (req.url === '/' || req.url === '/hote') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page);
        return true;
      }
      // L'écran de l'hôte vit sur le port du serveur de jeu, pas sur celui
      // du client : il sert donc lui-même son illustration de fond.
      if (req.url === '/fond.jpg') {
        try {
          const image = readFileSync(BACKGROUND);
          res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=3600' });
          res.end(image);
        } catch {
          // Sans illustration la page reste parfaitement utilisable.
          res.writeHead(404).end();
        }
        return true;
      }
      if (req.url === '/api/start' && req.method === 'POST') {
        const launched = server.startGame();
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ started: true, launched }));
        return true;
      }
      /*
       * Rouvrir le salon après une partie.
       *
       * Le basculement de l'écran suit `started` : remettre la session à
       * neuf ramène donc l'hôte à ses réglages sans qu'il ait à recharger
       * quoi que ce soit, et les joueurs restent connectés.
       */
      if (req.url === '/api/new' && req.method === 'POST') {
        const outcome = server.newGame();
        // Les bots repartent avec la partie : leurs sockets survivent au
        // changement de session, mais ils ne rejouent la mise en place que
        // si on les remet en face d'un plateau neuf.
        if (outcome.ok) bots.set(Math.min(bots.status.count, outcome.settings.playerCount));
        sendJson(res, outcome.ok ? 200 : 409, outcome);
        return true;
      }
      /*
       * Les réglages, en lecture et en écriture.
       *
       * Une seule et même forme dans les deux sens : ce que la page reçoit
       * est ce qu'elle peut renvoyer, et le serveur borne. Elle n'a donc
       * jamais à deviner ce qui est acceptable.
       */
      if (req.url === '/api/settings') {
        if (req.method === 'POST') {
          void readJson(req)
            .then((body) => {
              const outcome = server.reconfigure(body as Partial<GameSettings>);
              if (!outcome.ok) { sendJson(res, 409, { error: outcome.reason }); return; }
              /*
               * Les bots suivent l'effectif.
               *
               * Sans quoi ramener douze sièges à six laisse dix bots pour
               * six places : cinq perdent la leur et leur processus continue
               * de tourner pour rien. On relance donc la table dès que le
               * nombre demandé dépasse ce que l'effectif peut tenir, même
               * quand la requête ne parle pas des bots.
               */
              const asked = typeof body['bots'] === 'number' ? Number(body['bots']) : bots.status.count;
              const fitted = Math.min(asked, outcome.settings.playerCount);
              if (fitted !== bots.status.count || typeof body['bots'] === 'number') bots.set(fitted);
              sendJson(res, 200, {
                settings: outcome.settings, started: server.session.isStarted, bots: bots.status,
              });
            })
            .catch((error: unknown) => sendJson(res, 400, {
              error: error instanceof Error ? error.message : 'requête illisible',
            }));
          return true;
        }
        sendJson(res, 200, {
          settings: server.settings,
          started: server.session.isStarted,
          bots: bots.status,
          limits: SETTINGS_LIMITS,
        });
        return true;
      }
      // La vue publique complète, pour l'écran de table : plateau, joueurs,
      // scores. Rien de privé n'y transite — c'est la même vue que reçoivent
      // tous les clients.
      if (req.url === '/api/view') {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(server.session.publicView()));
        return true;
      }
      if (req.url === '/api/seats') {
        const automatic = server.botSeats();
        const seats = server.session.allSeats().map((seat) => ({
          name: seat.name,
          connected: seat.connected,
          // L'hôte doit voir d'un coup combien de vraies personnes sont là :
          // dix sièges pleins dont neuf de bots ne se lisent pas autrement.
          bot: automatic.has(seat.playerId),
        }));
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(seats));
        return true;
      }
      return false;
    },
  });

  await server.listen(port);

  console.log('');
  console.log('  GRAND COLONIES');
  console.log('');
  console.log(`  Écran hôte   http://${host}:${port}`);
  console.log(`  Joueurs      ${url}`);
  console.log(`  Code         ${code}`);
  console.log(`  Plateau      ${boardKind === 'disc' ? 'disque' : 'archipel'}`);
  console.log('');

  // Le nombre de bots demandé au lancement, s'il y en a un : la ligne de
  // commande reste utilisable, l'écran de l'hôte prend le relais ensuite.
  const asked = Number(process.env['BOTS'] ?? 0);
  if (asked > 0) bots.set(Math.min(asked, playerCount));

  return {
    port,
    code,
    url,
    close: async () => { bots.stop(); await server.close(); },
  };
}

// Lancement direct : `npm run host`.
if (process.argv[1]?.includes('main.')) {
  void startHost(Number(process.env['PLAYERS'] ?? 8));
}
