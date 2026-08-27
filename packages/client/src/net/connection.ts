/**
 * Connexion au serveur de partie.
 *
 * Deux exigences guident ce fichier, et elles viennent du terrain plutôt que
 * de la technique :
 *
 *   — **le jeton survit à la page.** Un joueur qui rafraîchit, ferme un
 *     onglet ou voit son téléphone se verrouiller doit retrouver son siège.
 *     Le jeton est donc rangé dans un stockage persistant, jamais en mémoire.
 *
 *   — **la reconnexion est automatique.** Sur un réseau domestique avec douze
 *     appareils, une coupure d'une seconde est banale. Personne ne devrait
 *     avoir à recharger la page pour la surmonter.
 */

import type { PrivatePlayerView, PublicGameView } from '@grand-colonies/protocol';

export interface SeatInfo {
  readonly playerId: string;
  readonly token: string;
  readonly name: string;
}

export interface TimerInfo {
  readonly remainingMs: number | undefined;
  readonly phase: string;
}

export interface Rejection {
  readonly actionId: string;
  readonly reason: string;
  readonly detail?: string;
}

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed' | 'full';

export interface ConnectionHandlers {
  onSeat?(seat: SeatInfo): void;
  onPublic?(view: PublicGameView): void;
  onPrivate?(view: PrivatePlayerView): void;
  onEvents?(events: readonly unknown[]): void;
  onTimer?(timer: TimerInfo): void;
  onRejected?(rejection: Rejection): void;
  onStatus?(status: ConnectionStatus): void;
}

/** Stockage du jeton — `localStorage` en vrai, une Map dans les tests. */
export interface TokenStorage {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export const browserStorage: TokenStorage = {
  get: (key) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
  set: (key, value) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  },
};

export function memoryStorage(): TokenStorage {
  const map = new Map<string, string>();
  return {
    get: (key) => map.get(key) ?? null,
    set: (key, value) => void map.set(key, value),
  };
}

/** Fabrique de socket, injectable pour tester hors navigateur. */
export type SocketFactory = (url: string) => WebSocketLike;

export interface WebSocketLike {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
}

export interface ConnectionOptions {
  readonly url: string;
  readonly name?: string;
  readonly storage?: TokenStorage;
  readonly createSocket?: SocketFactory;
  /** Délais successifs entre deux tentatives, en millisecondes. */
  readonly retryDelaysMs?: readonly number[];
  readonly setTimeoutFn?: (fn: () => void, ms: number) => unknown;
}

const TOKEN_KEY = 'grand-colonies:token';

/**
 * Délais croissants : une coupure passagère se rattrape en un instant, une
 * panne durable n'inonde pas le serveur de tentatives.
 */
const DEFAULT_RETRIES = [250, 500, 1000, 2000, 4000] as const;

export class GameConnection {
  private socket: WebSocketLike | undefined;
  private attempt = 0;
  private closedByUser = false;

  private readonly storage: TokenStorage;
  private readonly createSocket: SocketFactory;
  private readonly retries: readonly number[];
  private readonly schedule: (fn: () => void, ms: number) => unknown;

  constructor(
    private readonly options: ConnectionOptions,
    private readonly handlers: ConnectionHandlers = {},
  ) {
    this.storage = options.storage ?? browserStorage;
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url) as unknown as WebSocketLike);
    this.retries = options.retryDelaysMs ?? DEFAULT_RETRIES;
    this.schedule = options.setTimeoutFn ?? ((fn, ms) => setTimeout(fn, ms));
  }

  get token(): string | null {
    return this.storage.get(TOKEN_KEY);
  }

  connect(): void {
    this.closedByUser = false;
    this.handlers.onStatus?.(this.attempt === 0 ? 'connecting' : 'reconnecting');

    const socket = this.createSocket(this.options.url);
    this.socket = socket;

    socket.onopen = () => {
      this.attempt = 0;
      this.handlers.onStatus?.('open');
      // Le jeton, s'il existe, réclame le siège d'origine. Sinon on en
      // demande un neuf.
      const token = this.storage.get(TOKEN_KEY);
      this.raw({ type: 'join', ...(token ? { token } : {}), ...(this.options.name ? { name: this.options.name } : {}) });
    };

    socket.onmessage = (event) => this.receive(event.data);
    socket.onerror = () => socket.close();
    socket.onclose = () => this.onClosed();
  }

  private onClosed(): void {
    this.socket = undefined;
    if (this.closedByUser) {
      this.handlers.onStatus?.('closed');
      return;
    }

    const delay = this.retries[Math.min(this.attempt, this.retries.length - 1)] ?? 4000;
    this.attempt++;
    this.handlers.onStatus?.('reconnecting');
    this.schedule(() => {
      if (!this.closedByUser) this.connect();
    }, delay);
  }

  private receive(data: unknown): void {
    let frame: { type: string; payload: unknown };
    try {
      frame = JSON.parse(String(data)) as { type: string; payload: unknown };
    } catch {
      // Une trame illisible ne doit jamais casser l'interface.
      return;
    }

    switch (frame.type) {
      case 'seat': {
        const seat = frame.payload as SeatInfo;
        // Le jeton est rangé aussitôt : c'est lui qui rendra le siège après
        // un rafraîchissement.
        this.storage.set(TOKEN_KEY, seat.token);
        this.handlers.onSeat?.(seat);
        break;
      }
      case 'public': this.handlers.onPublic?.(frame.payload as PublicGameView); break;
      case 'private': this.handlers.onPrivate?.(frame.payload as PrivatePlayerView); break;
      case 'events': this.handlers.onEvents?.(frame.payload as readonly unknown[]); break;
      case 'timer': this.handlers.onTimer?.(frame.payload as TimerInfo); break;
      case 'rejected': this.handlers.onRejected?.(frame.payload as Rejection); break;
      case 'full':
        // Partie complète : inutile d'insister, on cesse de retenter.
        this.closedByUser = true;
        this.handlers.onStatus?.('full');
        break;
      default: break;
    }
  }

  /** Envoie une commande. Le serveur impose l'identité du siège. */
  send(command: { actionId: string; type: string; [key: string]: unknown }): void {
    this.raw({ type: 'command', command });
  }

  private raw(message: unknown): void {
    this.socket?.send(JSON.stringify(message));
  }

  close(): void {
    this.closedByUser = true;
    this.socket?.close();
  }
}

/** Identifiant d'action unique, pour que le serveur ignore les doublons. */
export function newActionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
