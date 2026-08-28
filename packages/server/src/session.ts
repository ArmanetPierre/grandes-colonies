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
  type BoardScale,
  type GameState,
  type PlayerId,
  archipelagoBoard,
  archipelagoOptionsFor,
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
  name: string;
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
  /**
   * Ce siège a-t-il déjà joué ?
   *
   * Un siège qui n'a jamais rien fait n'appartient à personne : le libérer
   * évite qu'un joueur qui recharge sa page avant d'avoir agi n'en consomme
   * un définitivement. À huit joueurs, deux rechargements suffiraient à
   * rendre la partie injouable.
   */
  hasPlayed: boolean;
}

export interface SessionOptions {
  readonly seed: string;
  readonly playerNames: readonly string[];
  readonly config?: GameConfig;
  /**
   * Forme du plateau à huit joueurs et plus.
   *
   * L'archipel est la structure prévue par le §4 et la seule où l'exploration
   * ait un sens. Le disque reste proposé parce qu'il raccourcit sensiblement
   * la partie : à douze joueurs, la simulation mesure 138 cycles contre 216.
   */
  readonly boardKind?: 'archipelago' | 'disc';
  /**
   * Taille des terres, au-delà de celle que l'effectif appelle.
   *
   * Variante et non correction : le §4 dimensionne le plateau sur le nombre
   * de joueurs, et c'est cette taille-là qui équilibre la partie.
   */
  readonly boardScale?: BoardScale;
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

  /**
   * La partie a-t-elle été lancée par l'hôte ?
   *
   * Tant que non, rien ne bouge : ni chronomètre, ni tour joué d'office. Les
   * invités d'une soirée arrivent en ordre dispersé, et les premiers
   * connectés dérouleraient la mise en place pendant que les autres cherchent
   * encore l'adresse.
   */
  private manualStart = false;

  constructor(options: SessionOptions) {
    this.now = options.now ?? (() => Date.now());

    const count = options.playerNames.length;
    const config = options.config ?? defaultConfig(count);
    const boardRng = new SeededRandom(`${options.seed}:board`);

    const players = options.playerNames.map((name, i) => ({ id: `p${i + 1}`, name }));
    this.state = createGame({
      players,
      // À huit joueurs et plus, l'archipel du §4 : une île centrale disputée
      // et deux ou trois îles majeures, que seule la voile relie.
      board: !usesXxlBoard(count) ? classicBoard(boardRng)
        : options.boardKind === 'disc' ? xxlBoard(boardRng, xxlOptionsFor(count, options.boardScale))
        : archipelagoBoard(boardRng, archipelagoOptionsFor(count, options.boardScale)),
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
        hasPlayed: false,
      });
      this.byToken.set(token, player.id);
    }

    this.armTimer();
  }

  // ── démarrage ────────────────────────────────────────────────────────

  get isStarted(): boolean {
    return this.manualStart;
  }

  /**
   * Lance la partie. C'est l'hôte qui décide, quand il voit ses invités
   * installés.
   *
   * Les sièges que personne n'a réclamés sont déclarés absents dès le premier
   * cycle : sans cela la partie se figerait sur leur tour, personne n'étant
   * là pour le jouer. Ils restent réclamables — un retardataire prend la
   * place et le remplacement automatique s'arrête.
   */
  start(): boolean {
    if (this.manualStart) return false;
    this.manualStart = true;

    for (const seat of this.seats.values()) {
      if (seat.connected) continue;
      seat.disconnectedAtCycle = this.state.cycle;
    }

    this.armTimer();
    return true;
  }

  /** Sièges occupés par un humain, ici et maintenant. */
  connectedCount(): number {
    return [...this.seats.values()].filter((s) => s.connected).length;
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

  /**
   * Attribue le premier siège libre — l'entrée d'un joueur qui arrive.
   *
   * Un siège quitté sans avoir jamais joué redevient libre : sinon un simple
   * rechargement de page en consommerait un pour de bon.
   */
  claimFreeSeat(name?: string): Seat | undefined {
    for (const seat of this.seats.values()) {
      if (seat.connected) continue;
      if (seat.disconnectedAtCycle !== undefined && seat.hasPlayed) continue;

      seat.connected = true;
      seat.disconnectedAtCycle = undefined;
      if (name) this.rename(seat, name);
      this.armTimer();
      return seat;
    }
    return undefined;
  }

  /**
   * Renomme un siège, et le joueur correspondant dans la partie.
   *
   * Les deux doivent rester synchronisés : la vue publique lit le nom du
   * joueur, pas celui du siège. Ne changer que l'un laisserait la liste des
   * joueurs afficher « Joueur 3 » alors que l'intéressé s'est présenté.
   */
  private rename(seat: Seat, name: string): void {
    seat.name = name;
    const player = this.state.players.find((p) => p.id === seat.playerId);
    if (player) player.name = name;
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
    if (!this.manualStart) {
      return {
        result: { ok: false, reason: 'wrong-phase', detail: 'la partie n a pas encore commencé' },
        events: [],
      };
    }

    const result = dispatch(this.state, command);
    if (result.ok && !result.duplicate) {
      this.log.push(command);
      // Seul un geste humain approprie un siège. Un tour joué d'office ne
      // doit pas verrouiller la place : un retardataire peut encore la
      // prendre, et c'est mieux qu'un bot jusqu'au bout.
      const seat = this.seats.get(command.playerId);
      if (seat && !command.actionId.startsWith('sys-')) seat.hasPlayed = true;
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
      case 'production': return config.activeTurnSeconds;
      // La mise en place n'était pas chronométrée : un joueur connecté qui
      // s'absentait figeait la table sans que rien ne puisse la débloquer.
      case 'setup': return config.setupSeconds;
      default: return 0;
    }
  }

  private armTimer(): void {
    // Avant le lancement, aucun chronomètre ne court : la partie attend ses
    // joueurs plutôt que de se dérouler sans eux.
    if (!this.manualStart) {
      this.deadline = undefined;
      return;
    }
    const seconds = this.currentPhaseSeconds();
    this.deadline = seconds > 0 ? this.now() + seconds * 1000 : undefined;
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
    if (!this.manualStart) return [];
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
   *
   * Mais **un seul** joueur présent la subit à la fois.
   *
   * La boucle jouait d'office pour tout le monde jusqu'au changement de
   * phase. Or la mise en place est une phase unique de vingt-quatre poses :
   * une seule expiration suffisait à placer les deux colonies et les deux
   * routes des douze joueurs, y compris ceux qui attendaient sagement leur
   * tour et n'avaient encore rien pu choisir. C'est le premier geste de la
   * partie, celui qui décide de tout le reste, et il leur était retiré sans
   * qu'ils aient rien fait de mal.
   *
   * Le chronomètre est réarmé à chaque commande acceptée : rendre la main
   * ici donne donc au suivant son propre délai, entier. Les joueurs absents
   * restent traités à chaque battement par `advanceForAbsentees`, sans quoi
   * un siège vide coûterait un délai complet à toute la table.
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

        // Le joueur qui retenait la table a joué : on lui rend la main, et
        // au suivant son délai complet.
        if (this.isConnected(player.id)) {
          this.armTimer();
          return events;
        }

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
    return publicView(this.state, {
      isConnected: (id) => this.isConnected(id),
      started: this.manualStart,
    });
  }

  privateView(playerId: PlayerId): PrivatePlayerView | undefined {
    return privateView(this.state, playerId);
  }
}
