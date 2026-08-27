/**
 * Session de partie : sièges, chronomètres, reconnexion.
 *
 * Volontairement séparée de Colyseus. Tout ce qui porte une règle du contrat
 * vit ici et se teste sans réseau ; l'adaptateur réseau ne fait que
 * transporter. Une horloge injectée rend les tests déterministes : aucun
 * `setTimeout` ne décide de quoi que ce soit.
 *
 * Les commandes sont traitées **une par une, dans l'ordre d'arrivée**. Le
 * moteur ne voit jamais de concurrence, même quand le joueur actif et son
 * associé jouent en même temps.
 */

import {
  type Command,
  type CommandResult,
  type DomainEvent,
  type GameConfig,
  type GameState,
  type PlayerId,
  classicBoard,
  createGame,
  defaultConfig,
  dispatch,
  nextDefaultCommand,
  SeededRandom,
  usesXxlBoard,
  xxlBoard,
  xxlOptionsFor,
} from '@grand-colonies/engine';
import {
  type PrivatePlayerView,
  type PublicGameView,
  privateView,
  publicView,
} from '@grand-colonies/protocol';

export interface Seat {
  readonly playerId: PlayerId;
  readonly name: string;
  /**
   * Jeton de reconnexion, remis au client et conservé par lui.
   *
   * C'est lui, et non l'identifiant de connexion, qui rattache un joueur à
   * son siège : un rafraîchissement de page change le second, jamais le
   * premier.
   */
  readonly token: string;
  connected: boolean;
  /** Cycle de la dernière déconnexion, pour compter les tours d'absence. */
  disconnectedAtCycle: number | undefined;
}

export interface SessionOptions {
  readonly seed: string;
  readonly playerNames: readonly string[];
  readonly config?: GameConfig;
  /** Horloge injectable — les tests n'attendent jamais réellement. */
  readonly now?: () => number;
}

export interface SubmitOutcome {
  readonly result: CommandResult;
  readonly events: readonly DomainEvent[];
}

/** Tours de table d'absence avant de proposer un remplacement par un bot. */
export const ROUNDS_BEFORE_BOT = 2;

export class GameSession {
  readonly state: GameState;
  private readonly seats = new Map<PlayerId, Seat>();
  private readonly byToken = new Map<string, PlayerId>();
  private readonly now: () => number;
  private readonly log: Command[] = [];

  /** Échéance du chronomètre courant, en millisecondes. */
  private deadline: number | undefined;

  constructor(options: SessionOptions) {
    this.now = options.now ?? (() => Date.now());

    const count = options.playerNames.length;
    const config = options.config ?? defaultConfig(count);
    const boardRng = new SeededRandom(`${options.seed}:board`);

    const players = options.playerNames.map((name, i) => ({ id: `p${i + 1}`, name }));
    this.state = createGame({
      players,
      board: usesXxlBoard(count) ? xxlBoard(boardRng, xxlOptionsFor(count)) : classicBoard(boardRng),
      config,
      seed: `${options.seed}:game`,
    });

    const tokenRng = new SeededRandom(`${options.seed}:tokens`);
    for (const player of players) {
      const token = `${player.id}-${tokenRng.int(1e9).toString(36)}`;
      this.seats.set(player.id, {
        playerId: player.id,
        name: player.name,
        token,
        connected: false,
        disconnectedAtCycle: undefined,
      });
      this.byToken.set(token, player.id);
    }

    this.armTimer();
  }

  // ── sièges ───────────────────────────────────────────────────────────

  allSeats(): Seat[] {
    return [...this.seats.values()];
  }

  seatOf(playerId: PlayerId): Seat | undefined {
    return this.seats.get(playerId);
  }

  /** Rattache une connexion à un siège via son jeton. */
  reconnect(token: string): Seat | undefined {
    const playerId = this.byToken.get(token);
    if (playerId === undefined) return undefined;

    const seat = this.seats.get(playerId);
    if (!seat) return undefined;

    seat.connected = true;
    seat.disconnectedAtCycle = undefined;
    this.armTimer();
    return seat;
  }

  /** Attribue le premier siège libre — l'entrée d'un joueur qui arrive. */
  claimFreeSeat(name?: string): Seat | undefined {
    for (const seat of this.seats.values()) {
      if (seat.connected || seat.disconnectedAtCycle !== undefined) continue;
      seat.connected = true;
      if (name) this.seats.set(seat.playerId, { ...seat, name, connected: true });
      this.armTimer();
      return this.seats.get(seat.playerId);
    }
    return undefined;
  }

  disconnect(playerId: PlayerId): void {
    const seat = this.seats.get(playerId);
    if (!seat) return;
    seat.connected = false;
    seat.disconnectedAtCycle = this.state.cycle;
  }

  isConnected(playerId: PlayerId): boolean {
    return this.seats.get(playerId)?.connected ?? false;
  }

  /**
   * Sièges à proposer au remplacement par un bot.
   *
   * Deux tours de table d'absence (contrat §6). On compte en tours de table
   * et non en cycles : à douze joueurs, deux cycles ne représentent qu'un
   * sixième de tour, ce qui serait bien trop brutal.
   */
  seatsEligibleForBot(): Seat[] {
    const roundLength = Math.max(1, this.state.players.length);
    return this.allSeats().filter((seat) => {
      if (seat.connected || seat.disconnectedAtCycle === undefined) return false;
      const absentCycles = this.state.cycle - seat.disconnectedAtCycle;
      return absentCycles >= ROUNDS_BEFORE_BOT * roundLength;
    });
  }

  // ── commandes ────────────────────────────────────────────────────────

  /**
   * Soumet une commande. Un seul appel à la fois : c'est l'appelant — la
   * room — qui garantit la sérialisation.
   */
  submit(command: Command): SubmitOutcome {
    const result = dispatch(this.state, command);
    if (result.ok && !result.duplicate) {
      this.log.push(command);
      this.armTimer();
    }
    return { result, events: result.ok ? result.events : [] };
  }

  /** Le journal, pour la sauvegarde et le rejeu. */
  commandLog(): readonly Command[] {
    return this.log;
  }

  // ── chronomètre ──────────────────────────────────────────────────────

  /** Durée de la phase courante, en secondes. Zéro si aucune n'est chronométrée. */
  currentPhaseSeconds(): number {
    const { config } = this.state;
    switch (this.state.phase) {
      case 'activeTurn': return config.activeTurnSeconds;
      case 'freeTrade': return config.tradingWindowSeconds;
      // La production et la mise en place attendent une action précise :
      // le chronomètre du tour les couvre déjà.
      case 'production': return config.activeTurnSeconds;
      default: return 0;
    }
  }

  private armTimer(): void {
    // Tant que personne n'a rejoint, aucun chronomètre ne court : la partie
    // attend ses joueurs plutôt que de se dérouler sans eux.
    if (!this.started) {
      this.deadline = undefined;
      return;
    }
    const seconds = this.currentPhaseSeconds();
    this.deadline = seconds > 0 ? this.now() + seconds * 1000 : undefined;
  }

  /** Au moins un joueur a rejoint : la partie peut courir. */
  private get started(): boolean {
    return [...this.seats.values()].some((s) => s.connected || s.disconnectedAtCycle !== undefined);
  }

  /** Millisecondes restantes, ou `undefined` si la phase n'est pas chronométrée. */
  remainingMs(): number | undefined {
    if (this.deadline === undefined) return undefined;
    return Math.max(0, this.deadline - this.now());
  }

  /**
   * À appeler régulièrement. Fait avancer la partie de tout ce qui est dû :
   * chronomètre expiré, et joueurs absents dont on attend une action.
   *
   * Renvoie les événements produits, pour diffusion.
   */
  tick(): DomainEvent[] {
    const events: DomainEvent[] = [];

    // Un joueur absent ne doit jamais bloquer, même avant l'expiration.
    events.push(...this.advanceForAbsentees());

    if (this.deadline !== undefined && this.now() >= this.deadline) {
      events.push(...this.forceProgress());
    }

    return events;
  }

  /**
   * Joue d'office pour les joueurs déconnectés dont la partie attend une
   * action (contrat §6).
   *
   * Seuls les sièges **déjà occupés puis quittés** sont concernés. Un siège
   * jamais rejoint n'est pas un joueur absent mais un joueur attendu : sans
   * cette distinction, la session déroulerait la partie entière avant même
   * que quiconque n'ait rejoint.
   */
  private advanceForAbsentees(): DomainEvent[] {
    const events: DomainEvent[] = [];

    for (let guard = 0; guard < 40; guard++) {
      let acted = false;
      for (const seat of this.seats.values()) {
        if (seat.connected || seat.disconnectedAtCycle === undefined) continue;
        const command = nextDefaultCommand(this.state, seat.playerId, this.nextActionId());
        if (!command) continue;
        const outcome = this.submit(command);
        if (outcome.result.ok) {
          events.push(...outcome.events);
          acted = true;
        }
      }
      if (!acted) break;
    }

    return events;
  }

  /**
   * Chronomètre expiré : on valide ce qui peut l'être et on passe à la
   * suite (contrat §2). Le jeu ne s'arrête jamais, quitte à ce qu'un joueur
   * subisse une validation par défaut.
   */
  private forceProgress(): DomainEvent[] {
    const events: DomainEvent[] = [];

    const before = `${this.state.phase}:${this.state.cycle}`;

    for (let guard = 0; guard < 40; guard++) {
      let acted = false;

      for (const player of this.state.players) {
        const command = nextDefaultCommand(this.state, player.id, this.nextActionId());
        if (!command) continue;

        const outcome = this.submit(command);
        if (!outcome.result.ok) continue;
        events.push(...outcome.events);
        acted = true;

        // On s'arrête dès que la phase a bougé. Vérifier après chaque
        // commande et non après chaque passe : une seule passe suffit
        // autrement à traverser production, tour et commerce d'affilée.
        if (`${this.state.phase}:${this.state.cycle}` !== before) {
          this.armTimer();
          return events;
        }
      }

      if (!acted) break;
    }

    this.armTimer();
    return events;
  }

  private actionCounter = 0;
  private nextActionId(): string {
    return `sys-${this.state.cycle}-${this.actionCounter++}`;
  }

  // ── vues ─────────────────────────────────────────────────────────────

  publicView(): PublicGameView {
    return publicView(this.state, { isConnected: (id) => this.isConnected(id) });
  }

  privateView(playerId: PlayerId): PrivatePlayerView | undefined {
    return privateView(this.state, playerId);
  }
}
