/**
 * Serveur de partie, sur WebSocket brut.
 *
 * Colyseus était le choix du plan, mais deux constats l'ont écarté : sa
 * version 0.16 ne s'installe pas — une dépendance `workspace:` a été publiée
 * par erreur — et sa 0.18 n'a pas de client JavaScript. Aucune version
 * n'offrait les deux bouts.
 *
 * La perte est faible : nous n'utilisions de Colyseus que les salles et le
 * transport. Sa synchronisation d'état avait été délibérément contournée, car
 * elle diffuse à tout le monde et aurait obligé à filtrer champ par champ les
 * mains et les objectifs secrets — une seule erreur de filtrage suffisant à
 * révéler une main. Quant à la reconnexion par jeton, elle était déjà écrite.
 *
 * Ce fichier ne fait donc que transporter. Toute la logique vit dans
 * `GameSession`, qui se teste sans réseau.
 */

import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import type { Command, GameConfig } from '@grand-colonies/engine';

import { GameSession } from './session.js';

export interface JoinMessage {
  readonly type: 'join';
  readonly name?: string;
  /** Jeton reçu à la première connexion, rejoué après un rafraîchissement. */
  readonly token?: string;
}

export interface CommandMessage {
  readonly type: 'command';
  readonly command: Command;
}

export type ClientMessage = JoinMessage | CommandMessage;

export interface GameServerOptions {
  readonly seed?: string;
  readonly playerNames?: readonly string[];
  readonly config?: GameConfig;
  /** Cadence du battement de cœur, en millisecondes. */
  readonly tickMs?: number;
  /**
   * Requêtes HTTP à traiter avant le WebSocket — l'écran de l'hôte s'en sert
   * pour servir sa page sur le même port, afin que les invités n'aient
   * qu'une seule adresse à retenir.
   *
   * Renvoyer `true` signifie « je m'en suis chargé ».
   */
  readonly onRequest?: (req: IncomingMessage, res: ServerResponse) => boolean;
  /**
   * Démarrer sans attendre l'hôte.
   *
   * Par défaut la partie attend son salon d'attente. Les tests de transport
   * et le serveur de développement, eux, n'ont personne pour appuyer sur le
   * bouton.
   */
  readonly autoStart?: boolean;
}

const DEFAULT_TICK_MS = 250;

export class GameServer {
  readonly session: GameSession;
  private readonly http: HttpServer;
  private readonly wss: WebSocketServer;
  /** Connexion → siège. Reconstruit à chaque reconnexion. */
  private readonly seatOf = new Map<WebSocket, string>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly tickMs: number;

  constructor(options: GameServerOptions = {}) {
    const names = options.playerNames ?? Array.from({ length: 8 }, (_, i) => `Joueur ${i + 1}`);
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;

    this.session = new GameSession({
      seed: options.seed ?? `partie-${Date.now()}`,
      playerNames: names,
      ...(options.config ? { config: options.config } : {}),
    });

    const handle = options.onRequest;
    this.http = createServer((req, res) => {
      if (handle?.(req, res)) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('introuvable');
    });
    if (options.autoStart) this.session.start();

    this.wss = new WebSocketServer({ server: this.http });
    this.wss.on('connection', (socket) => this.onConnection(socket));
  }

  listen(port: number): Promise<number> {
    return new Promise((resolve) => {
      this.http.listen(port, () => {
        // Le battement fait avancer ce qui est dû : chronomètre expiré,
        // joueurs absents. Sans lui, la partie s'arrêterait dès que
        // personne n'agit.
        this.heartbeat = setInterval(() => this.tick(), this.tickMs);
        resolve(port);
      });
    });
  }

  /**
   * Lance la partie et prévient tout le monde.
   *
   * Passer par la session seule ne suffirait pas : rien ne rediffuserait la
   * vue publique, et les joueurs resteraient sur leur salon d'attente en
   * croyant l'hôte inactif.
   */
  startGame(): boolean {
    const launched = this.session.start();
    if (launched) this.broadcastAll();
    return launched;
  }

  async close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const socket of this.wss.clients) socket.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve) => this.http.close(() => resolve()));
  }

  // ── connexions ───────────────────────────────────────────────────────

  private onConnection(socket: WebSocket): void {
    socket.on('message', (raw) => {
      let message: ClientMessage;
      try {
        message = JSON.parse(String(raw)) as ClientMessage;
      } catch {
        // Un message illisible est ignoré : il ne doit jamais faire tomber
        // le serveur, ni interrompre les onze autres joueurs.
        return;
      }

      if (message.type === 'join') this.handleJoin(socket, message);
      else if (message.type === 'command') this.handleCommand(socket, message.command);
    });

    socket.on('close', () => this.handleClose(socket));
    socket.on('error', () => this.handleClose(socket));
  }

  private handleJoin(socket: WebSocket, message: JoinMessage): void {
    // Un jeton connu rend son siège d'origine ; sinon on en attribue un neuf.
    const seat = (message.token ? this.session.reconnect(message.token) : undefined)
      ?? this.session.claimFreeSeat(message.name);

    if (!seat) {
      this.send(socket, 'full', { reason: 'partie complète' });
      socket.close();
      return;
    }

    this.seatOf.set(socket, seat.playerId);

    // Le jeton n'est envoyé qu'à son propriétaire : c'est sa clé de retour.
    this.send(socket, 'seat', { playerId: seat.playerId, token: seat.token, name: seat.name });
    this.broadcastAll();
  }

  private handleCommand(socket: WebSocket, command: Command): void {
    const playerId = this.seatOf.get(socket);
    if (playerId === undefined) return;
    // Un message sans identifiant d'action casserait la déduplication.
    if (typeof command?.actionId !== 'string') return;

    // On impose l'identité du siège : un client ne joue jamais pour un autre.
    // Et on isole le moteur : une exception inattendue ne doit coûter la
    // partie qu'à son auteur, jamais aux onze autres joueurs.
    let outcome;
    try {
      outcome = this.session.submit({ ...command, playerId });
    } catch (error) {
      console.error('[serveur] commande rejetée sur exception', command.type, error);
      this.send(socket, 'rejected', {
        actionId: command.actionId,
        reason: 'internal-error',
        detail: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    if (!outcome.result.ok) {
      this.send(socket, 'rejected', {
        actionId: command.actionId,
        reason: outcome.result.reason,
        detail: outcome.result.detail,
      });
      return;
    }

    if (outcome.events.length > 0) this.broadcast('events', outcome.events);
    this.broadcastAll();
  }

  private handleClose(socket: WebSocket): void {
    const playerId = this.seatOf.get(socket);
    if (playerId === undefined) return;

    this.seatOf.delete(socket);
    // Le siège est conservé : c'est le jeton qui le rendra, pas la connexion.
    this.session.disconnect(playerId);
    this.broadcastAll();
  }

  private tick(): void {
    const events = this.session.tick();
    if (events.length > 0) {
      this.broadcast('events', events);
      this.broadcastAll();
      return;
    }

    // Même sans événement, le compte à rebours doit avancer côté client.
    this.broadcast('timer', {
      remainingMs: this.session.remainingMs(),
      phase: this.session.state.phase,
    });
  }

  // ── envoi ────────────────────────────────────────────────────────────

  private send(socket: WebSocket, type: string, payload: unknown): void {
    if (socket.readyState !== socket.OPEN) return;
    socket.send(JSON.stringify({ type, payload }));
  }

  private broadcast(type: string, payload: unknown): void {
    const frame = JSON.stringify({ type, payload });
    for (const socket of this.wss.clients) {
      if (socket.readyState === socket.OPEN) socket.send(frame);
    }
  }

  /** Vue publique à tous, vue privée à chacun — jamais l'inverse. */
  private broadcastAll(): void {
    this.broadcast('public', this.session.publicView());
    for (const [socket, playerId] of this.seatOf) {
      const view = this.session.privateView(playerId);
      if (view) this.send(socket, 'private', view);
    }
  }
}
