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

import {
  type BoardScale, type Command, type DomainEvent, type GameConfig, defaultConfig,
} from '@grand-colonies/engine';
import { redactAllFor, toWireAll } from '@grand-colonies/protocol';

import { GameSession } from './session.js';

export interface JoinMessage {
  readonly type: 'join';
  readonly name?: string;
  /** Jeton reçu à la première connexion, rejoué après un rafraîchissement. */
  readonly token?: string;
  /**
   * Un adversaire automatique se déclare.
   *
   * Il ne gagne aucun droit en le disant — il passe par le même WebSocket,
   * voit les mêmes vues et subit les mêmes refus. Cela sert à une seule
   * chose : quand l'hôte réduit l'effectif et qu'il manque des sièges, ce
   * sont les bots qui cèdent leur place, jamais un invité.
   */
  readonly bot?: boolean;
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
  /** Forme du plateau : archipel (défaut) ou disque. */
  readonly boardKind?: 'archipelago' | 'disc';
}

const DEFAULT_TICK_MS = 250;

/**
 * Les réglages que l'hôte peut changer depuis son écran, avant le lancement.
 *
 * Ils étaient jusqu'ici figés au démarrage du programme, par variables
 * d'environnement : changer d'avis sur le nombre de joueurs obligeait à tout
 * relancer, donc à faire rejoindre douze personnes une seconde fois. Ce sont
 * exactement les décisions qui se prennent en regardant la pièce se remplir.
 */
export interface GameSettings {
  readonly playerCount: number;
  readonly boardKind: 'archipelago' | 'disc';
  /** Taille des terres : normale, grande, immense. */
  readonly boardScale: BoardScale;
  /** Points à atteindre pour l'emporter. */
  readonly victoryTarget: number;
  readonly setupSeconds: number;
  /** Vaut aussi pour le tour de l'associé : les deux se jouent en même temps. */
  readonly activeTurnSeconds: number;
  readonly tradingWindowSeconds: number;
}

/**
 * Bornes des réglages, servies à l'écran de l'hôte.
 *
 * Elles vivent ici et non dans la page : c'est le serveur qui refusera une
 * valeur aberrante, et deux tables de bornes finiraient par diverger.
 */
export const SETTINGS_LIMITS = {
  playerCount: { min: 4, max: 12 },
  victoryTarget: { min: 6, max: 30 },
  setupSeconds: { min: 15, max: 300 },
  activeTurnSeconds: { min: 20, max: 600 },
  tradingWindowSeconds: { min: 0, max: 180 },
} as const;

export const DEFAULT_SETTINGS: GameSettings = Object.freeze({
  playerCount: 8,
  boardKind: 'archipelago',
  boardScale: 'normal',
  victoryTarget: 15,
  /*
   * Trente secondes pour poser, et non soixante.
   *
   * C'est le seul délai que toute la table subit d'un coup : à douze
   * joueurs, la mise en place enchaîne vingt-quatre poses, et chaque
   * hésitation se paie onze fois. Une minute d'arrêt en début de partie
   * suffit à faire décrocher la pièce, alors que le choix — une colonie sur
   * un plateau qu'on découvre — se fait très bien en trente.
   */
  setupSeconds: 30,
  activeTurnSeconds: 90,
  tradingWindowSeconds: 30,
});

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, Math.round(value)));

/** Ramène des réglages venus du réseau dans le domaine du jouable. */
export function normaliseSettings(asked: Partial<GameSettings>): GameSettings {
  const base = { ...DEFAULT_SETTINGS, ...asked };
  const n = (value: unknown, fallback: number): number =>
    (typeof value === 'number' && Number.isFinite(value) ? value : fallback);
  return {
    playerCount: clamp(n(base.playerCount, DEFAULT_SETTINGS.playerCount),
      SETTINGS_LIMITS.playerCount.min, SETTINGS_LIMITS.playerCount.max),
    boardKind: base.boardKind === 'disc' ? 'disc' : 'archipelago',
    boardScale: base.boardScale === 'grand' || base.boardScale === 'immense'
      ? base.boardScale : 'normal',
    victoryTarget: clamp(n(base.victoryTarget, DEFAULT_SETTINGS.victoryTarget),
      SETTINGS_LIMITS.victoryTarget.min, SETTINGS_LIMITS.victoryTarget.max),
    setupSeconds: clamp(n(base.setupSeconds, DEFAULT_SETTINGS.setupSeconds),
      SETTINGS_LIMITS.setupSeconds.min, SETTINGS_LIMITS.setupSeconds.max),
    activeTurnSeconds: clamp(n(base.activeTurnSeconds, DEFAULT_SETTINGS.activeTurnSeconds),
      SETTINGS_LIMITS.activeTurnSeconds.min, SETTINGS_LIMITS.activeTurnSeconds.max),
    tradingWindowSeconds: clamp(n(base.tradingWindowSeconds, DEFAULT_SETTINGS.tradingWindowSeconds),
      SETTINGS_LIMITS.tradingWindowSeconds.min, SETTINGS_LIMITS.tradingWindowSeconds.max),
  };
}

/**
 * La configuration du moteur qui découle des réglages.
 *
 * Tout ce que l'hôte ne règle pas vient de `defaultConfig`, qui fait varier
 * la limite de main et le nombre de voleurs avec l'effectif : les recopier
 * ici les aurait figés au premier changement de nombre de joueurs.
 */
export function configFor(settings: GameSettings): GameConfig {
  const base = defaultConfig(settings.playerCount);
  /*
   * La dotation de routes ne suit **pas** la taille du plateau.
   *
   * On l'avait d'abord mise à l'échelle, en pensant qu'un plateau deux fois
   * plus vaste demanderait plus de routes pour l'atteindre. La mesure dit le
   * contraire : à vingt routes, l'archipel immense conclut déjà seize parties
   * sur seize en 124 cycles ; à trente, il en met 148. Plus de routes ne
   * rapproche de rien — elle disperse. Voir SIMULATION_FINDINGS.md.
   */
  return {
    ...base,
    victory: { ...base.victory, target: settings.victoryTarget },
    setupSeconds: settings.setupSeconds,
    activeTurnSeconds: settings.activeTurnSeconds,
    pairedTurnSeconds: settings.activeTurnSeconds,
    tradingWindowSeconds: settings.tradingWindowSeconds,
  };
}

const seatNames = (count: number): string[] =>
  Array.from({ length: count }, (_, i) => `Joueur ${i + 1}`);

export class GameServer {
  /**
   * La session en cours.
   *
   * Elle n'est plus posée une fois pour toutes : tant que l'hôte n'a pas
   * lancé la partie, changer un réglage en reconstruit une neuve. D'où un
   * champ mutable derrière un accès en lecture — le reste du programme ne
   * doit pas pouvoir la remplacer, mais elle change.
   */
  private current: GameSession;
  private settingsValue: GameSettings;
  private seed: string;
  /** Compté pour que deux parties ouvertes dans la même milliseconde diffèrent. */
  private rebuilds = 0;
  /** Configuration imposée à la construction, qui prime sur les réglages. */
  private readonly configOverride: GameConfig | undefined;
  private readonly http: HttpServer;
  private readonly wss: WebSocketServer;
  /** Connexion → siège. Reconstruit à chaque reconnexion. */
  private readonly seatOf = new Map<WebSocket, string>();
  /** Les connexions qui se sont annoncées comme automatiques. */
  private readonly botSockets = new Set<WebSocket>();
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly tickMs: number;

  constructor(options: GameServerOptions = {}) {
    const names = options.playerNames ?? seatNames(DEFAULT_SETTINGS.playerCount);
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.seed = options.seed ?? `partie-${Date.now()}`;
    this.configOverride = options.config;
    this.settingsValue = {
      ...normaliseSettings({ ...(options.boardKind ? { boardKind: options.boardKind } : {}) }),
      // L'effectif suit les noms reçus, sans bornage : un test peut monter
      // une table de deux, l'écran de l'hôte reste borné de son côté.
      playerCount: names.length,
    };

    /*
     * Les réglages sont la seule source des durées, dès la première session.
     *
     * Sans cela la partie démarrait avec les valeurs de `defaultConfig` et
     * l'écran de l'hôte affichait les siennes : deux vérités pour un même
     * chiffre, et une mise en place annoncée à trente secondes qui en durait
     * soixante.
     */
    this.current = new GameSession({
      seed: this.seed,
      playerNames: names,
      config: options.config ?? configFor(this.settingsValue),
      ...(options.boardKind ? { boardKind: options.boardKind } : {}),
      boardScale: this.settingsValue.boardScale,
    });

    const handle = options.onRequest;
    this.http = createServer((req, res) => {
      if (handle?.(req, res)) return;
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('introuvable');
    });
    if (options.autoStart) this.current.start();

    this.wss = new WebSocketServer({ server: this.http });
    this.wss.on('connection', (socket) => this.onConnection(socket));
  }

  get session(): GameSession {
    return this.current;
  }

  /** Les sièges tenus par un adversaire automatique, ici et maintenant. */
  botSeats(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const socket of this.botSockets) {
      const playerId = this.seatOf.get(socket);
      if (playerId !== undefined) ids.add(playerId);
    }
    return ids;
  }

  /** Les réglages en vigueur — ceux que l'écran de l'hôte affiche. */
  get settings(): GameSettings {
    return this.settingsValue;
  }

  /**
   * Change les réglages, et rebâtit la partie autour.
   *
   * Rien n'est joué : reconstruire est plus sûr que de retoucher un état en
   * place, dont le plateau, la limite de main et le nombre de voleurs
   * dépendent tous de l'effectif.
   *
   * Les joueurs déjà là gardent leur place. Ils reçoivent un siège neuf et
   * son jeton — le client range le nouveau et oublie l'ancien — si bien que
   * personne n'a à recharger sa page. Ceux qui ne tiennent plus, quand
   * l'hôte réduit l'effectif, sont prévenus comme d'une partie complète.
   */
  reconfigure(asked: Partial<GameSettings> & { readonly newBoard?: boolean }):
  { ok: true; settings: GameSettings } | { ok: false; reason: string } {
    if (this.current.isStarted) {
      return { ok: false, reason: 'la partie a déjà commencé' };
    }
    return this.rebuild(normaliseSettings({ ...this.settingsValue, ...asked }), asked.newBoard === true);
  }

  /**
   * Rouvre le salon : une partie neuve, la même tablée.
   *
   * Une session ne se remettait pas à zéro. Pour rejouer il fallait couper le
   * serveur et le relancer — donc faire rescanner le QR code à douze
   * personnes qui viennent de finir une partie ensemble, ce qui est
   * exactement le moment où l'on veut en enchaîner une seconde. On rebâtit
   * donc sur place, plateau neuf, et chacun garde sa place et son nom.
   *
   * Volontairement sans garde sur l'état : c'est la seule sortie d'une
   * partie terminée, et l'hôte qui l'appelle sait ce qu'il fait.
   */
  newGame(asked: Partial<GameSettings> = {}):
  { ok: true; settings: GameSettings } | { ok: false; reason: string } {
    return this.rebuild(normaliseSettings({ ...this.settingsValue, ...asked }), true);
  }

  private rebuild(next: GameSettings, newSeed: boolean):
  { ok: true; settings: GameSettings } | { ok: false; reason: string } {
    if (newSeed) this.seed = `partie-${Date.now()}-${this.rebuilds++}`;

    /*
     * Qui garde sa place quand l'effectif diminue.
     *
     * Les invités d'abord, dans leur ordre d'arrivée ; les adversaires
     * automatiques ensuite. Sans ce tri, ramener douze sièges à huit
     * éjectait la personne connectée en dernier — le plus souvent un humain,
     * puisque les bots arrivent tous au démarrage — et lui affichait
     * « partie complète » alors qu'elle venait de s'installer.
     */
    const entries = [...this.seatOf.entries()];
    const occupants = [
      ...entries.filter(([socket]) => !this.botSockets.has(socket)),
      ...entries.filter(([socket]) => this.botSockets.has(socket)),
    ].map(([socket, playerId]) => ({ socket, name: this.current.seatOf(playerId)?.name }));

    this.current = new GameSession({
      seed: this.seed,
      playerNames: seatNames(next.playerCount),
      config: this.configOverride ?? configFor(next),
      boardKind: next.boardKind,
      boardScale: next.boardScale,
    });
    this.settingsValue = next;
    this.seatOf.clear();

    for (const { socket, name } of occupants) {
      if (socket.readyState !== socket.OPEN) continue;
      const seat = this.current.claimFreeSeat(name);
      if (!seat) {
        this.send(socket, 'full', { reason: 'partie complète' });
        socket.close();
        continue;
      }
      this.seatOf.set(socket, seat.playerId);
      this.send(socket, 'seat', { playerId: seat.playerId, token: seat.token, name: seat.name });
    }

    this.broadcastAll();
    return { ok: true, settings: next };
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
    const launched = this.current.start();
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
    if (message.bot) this.botSockets.add(socket);

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

    if (outcome.events.length > 0) this.broadcastEvents(outcome.events);
    this.broadcastAll();
  }

  private handleClose(socket: WebSocket): void {
    const playerId = this.seatOf.get(socket);
    // L'ensemble se vide dans tous les cas : une connexion refusée y figure
    // aussi, et la garder ferait grossir l'ensemble à chaque tentative.
    this.botSockets.delete(socket);
    if (playerId === undefined) return;

    this.seatOf.delete(socket);
    // Le siège est conservé : c'est le jeton qui le rendra, pas la connexion.
    this.session.disconnect(playerId);
    this.broadcastAll();
  }

  private tick(): void {
    const events = this.session.tick();
    if (events.length > 0) {
      this.broadcastEvents(events);
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

  /**
   * Les événements, expurgés pour chaque destinataire.
   *
   * Un envoi par siège plutôt qu'une trame unique : deux événements portent
   * une information privée — la carte développement achetée, la ressource
   * dérobée — et une diffusion commune les révélerait à toute la table.
   */
  private broadcastEvents(events: readonly DomainEvent[]): void {
    const wire = toWireAll(events);
    for (const [socket, playerId] of this.seatOf) {
      this.send(socket, 'events', redactAllFor(wire, playerId));
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
