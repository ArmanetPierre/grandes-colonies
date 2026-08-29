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
  type BoardInit,
  type BoardSize,
  type GameState,
  type PlayerId,
  archipelagoBoard,
  archipelagoOptionsFor,
  classicBoard,
  CLASSIC_LAND_COUNT,
  createGame,
  defaultConfig,
  defaultLandCount,
  dispatch,
  landCountFor,
  nextDefaultCommand,
  SeededRandom,
  usesXxlBoard,
  xxlBoard,
  xxlOptionsFor,
} from '@grand-colonies/engine';
import type { GameRecipe, Journal } from './journal.js';
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
   *
   * Renouvelable, mais par un seul chemin : `handToBot`, qui tue l'ancien
   * pour que le joueur cédé ne revienne pas s'asseoir sur le bot.
   */
  token: string;
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
   * Taille des terres : un préréglage, ou un nombre d'hexagones.
   *
   * Le §4 dimensionne le plateau sur le nombre de joueurs, et c'est cette
   * taille-là qui équilibre la partie — elle reste la valeur par défaut. La
   * régler au chiffre est une variante assumée, pour une table qui veut de
   * la place à explorer plutôt qu'une course serrée.
   */
  readonly boardSize?: BoardSize;
  /** Horloge injectable — les tests n'attendent jamais réellement. */
  readonly now?: () => number;
}

export interface SubmitOutcome {
  readonly result: CommandResult;
  readonly events: readonly DomainEvent[];
}

/**
 * Quel plateau, pour cet effectif et cette taille.
 *
 * Le plateau classique n'est plus le seul recours des petites tables : il
 * n'est retenu que si l'hôte a laissé la taille sur ses dix-neuf tuiles
 * d'origine. C'est ce qui manquait — sous huit joueurs, le réglage de taille
 * partait dans `classicBoard`, qui ne le prend pas, et n'avait aucun effet
 * visible. Dès que la taille demandée s'en écarte, on génère, quel que soit
 * le nombre de joueurs.
 *
 * L'inverse vaut aussi : à huit joueurs et plus on génère toujours, même à
 * dix-neuf terres, parce que l'archipel du §4 — une île centrale disputée et
 * deux ou trois îles que seule la voile relie — est ce qui fait la partie à
 * cet effectif, et que le plateau classique n'a pas de quoi asseoir douze
 * joueurs.
 */
function boardFor(
  rng: SeededRandom,
  count: number,
  options: { readonly boardKind?: 'archipelago' | 'disc'; readonly boardSize?: BoardSize },
): BoardInit {
  // Sans taille demandée, celle qui convient à l'effectif : le plateau
  // classique pour les petites tables, le §4 au-delà.
  const asked = options.boardSize === undefined
    ? defaultLandCount(count)
    : landCountFor(count, options.boardSize);
  if (!usesXxlBoard(count) && asked === CLASSIC_LAND_COUNT) return classicBoard(rng);
  return options.boardKind === 'disc'
    ? xxlBoard(rng, xxlOptionsFor(count, asked))
    : archipelagoBoard(rng, archipelagoOptionsFor(count, asked));
}

/** Tours de table d'absence avant de proposer un remplacement par un bot. */
export const ROUNDS_BEFORE_BOT = 2;

export class GameSession {
  readonly state: GameState;
  private readonly seats = new Map<PlayerId, Seat>();
  private readonly byToken = new Map<string, PlayerId>();
  private readonly now: () => number;
  private readonly log: Command[] = [];

  /**
   * De quoi refabriquer cette partie à l'identique.
   *
   * Les options de construction étaient consommées puis oubliées. Le
   * déterminisme du moteur ne sert à rien si l'on ne sait plus avec quelle
   * graine ni sur quel plateau la partie a commencé.
   */
  private readonly recipeValue: GameRecipe;

  /** Échéance du chronomètre courant, en millisecondes. */
  private deadline: number | undefined;

  /**
   * Temps restant mis de côté pendant une pause.
   *
   * L'échéance est une date absolue : la laisser courir pendant qu'on met la
   * partie en pause l'aurait fait expirer toute seule, et la reprise serait
   * tombée sur un chronomètre déjà à zéro. On retient donc la durée, et on
   * refabrique une échéance au moment de reprendre.
   *
   * `undefined` hors pause, et pendant une pause sur une phase non
   * chronométrée — la distinction avec « zéro milliseconde » compte, car
   * zéro ferait expirer la phase à la reprise.
   */
  private pausedRemaining: number | undefined;

  /** La partie est-elle suspendue par l'hôte ? */
  private suspended = false;

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

    this.recipeValue = {
      seed: options.seed,
      playerNames: [...options.playerNames],
      config,
      ...(options.boardKind ? { boardKind: options.boardKind } : {}),
      ...(options.boardSize !== undefined ? { boardSize: options.boardSize } : {}),
    };

    const players = options.playerNames.map((name, i) => ({ id: `p${i + 1}`, name }));
    this.state = createGame({
      players,
      board: boardFor(boardRng, count, options),
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
  renameSeat(playerId: PlayerId, name: string): boolean {
    const seat = this.seats.get(playerId);
    if (!seat) return false;
    this.rename(seat, name);
    return true;
  }

  private rename(seat: Seat, name: string): void {
    seat.name = name;
    const player = this.state.players.find((p) => p.id === seat.playerId);
    if (player) player.name = name;
  }

  /**
   * Cède un siège à un adversaire automatique.
   *
   * Le siège d'un joueur qui a joué ne se libère jamais tout seul — c'est
   * exprès, un rechargement de page ne doit pas le coûter. Mais quand
   * quelqu'un est parti pour de bon, la table l'attend indéfiniment : son
   * tour est joué d'office, cycle après cycle, et personne ne construit à sa
   * place. `seatsEligibleForBot` désignait ces sièges depuis le début sans
   * que rien n'en fasse quoi que ce soit.
   *
   * Le jeton est renouvelé, et l'ancien meurt. Sans cela, le joueur parti
   * reviendrait sur un siège désormais tenu par un bot : deux connexions sur
   * une même place, chacune jouant pour l'autre. Il retrouvera la table par
   * un siège libre, ou pas du tout — céder sa place, c'est la céder.
   *
   * Renvoie faux pour un siège inconnu ou encore occupé : on ne prend pas la
   * place de quelqu'un qui est là.
   */
  handToBot(playerId: PlayerId): boolean {
    const seat = this.seats.get(playerId);
    if (!seat || seat.connected) return false;

    this.byToken.delete(seat.token);
    seat.token = `${playerId}-bot-${this.log.length.toString(36)}-${this.state.cycle}`;
    this.byToken.set(seat.token, playerId);

    // `hasPlayed` à faux est ce que `claimFreeSeat` regarde : c'est ce qui
    // rouvre la place au prochain arrivant, en l'occurrence le bot.
    seat.hasPlayed = false;
    seat.disconnectedAtCycle = this.state.cycle;
    return true;
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
    if (this.suspended) {
      return {
        result: { ok: false, reason: 'wrong-phase', detail: 'la partie est en pause' },
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

  /** La recette de cette partie : graine, joueurs, configuration, plateau. */
  get recipe(): GameRecipe {
    return this.recipeValue;
  }

  // ── pause ────────────────────────────────────────────────────────────

  get isPaused(): boolean {
    return this.suspended;
  }

  /**
   * Suspend la partie : quelqu'un veut aller chercher à boire.
   *
   * Trois choses s'arrêtent ensemble, et il faut les trois. Le chronomètre,
   * évidemment. Mais aussi le tour joué d'office pour les absents — sans
   * quoi une pause de cinq minutes déroulerait la partie entière au profit
   * des connectés. Et les commandes des joueurs, sans quoi celui qui reste
   * devant son écran construirait pendant que les autres sont à la cuisine.
   *
   * Renvoie faux si la partie n'a pas commencé ou est déjà en pause : rien
   * à suspendre, et l'hôte n'a pas à distinguer les deux cas.
   */
  pause(): boolean {
    if (!this.manualStart || this.suspended) return false;
    this.pausedRemaining = this.remainingMs();
    this.deadline = undefined;
    this.suspended = true;
    return true;
  }

  /**
   * Reprend là où on s'était arrêté.
   *
   * Le temps restant est refabriqué en échéance : un joueur qui avait
   * quarante secondes les retrouve, et non la durée pleine de la phase. La
   * pause ne doit ni voler ni offrir du temps.
   */
  resume(): boolean {
    if (!this.suspended) return false;
    this.suspended = false;
    this.deadline = this.pausedRemaining === undefined
      ? undefined
      : this.now() + this.pausedRemaining;
    this.pausedRemaining = undefined;
    return true;
  }

  /**
   * Ajoute du temps à la phase en cours — le geste de l'hôte qui voit une
   * table encore en pleine négociation.
   *
   * Sans effet sur une phase non chronométrée : il n'y a rien à prolonger, et
   * inventer une échéance là où il n'y en avait pas imposerait une limite que
   * la phase n'a jamais eue.
   */
  extendTimer(seconds: number): boolean {
    const ms = Math.round(seconds * 1000);
    if (!Number.isFinite(ms) || ms === 0) return false;

    if (this.suspended) {
      if (this.pausedRemaining === undefined) return false;
      this.pausedRemaining = Math.max(0, this.pausedRemaining + ms);
      return true;
    }
    if (this.deadline === undefined) return false;
    this.deadline = Math.max(this.now(), this.deadline + ms);
    return true;
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

    /*
     * En pause, on réarme la réserve et non l'échéance.
     *
     * Un joueur peut rejoindre ou revenir pendant une pause, et ces deux
     * gestes réarment le chronomètre. Poser une échéance ici la ferait courir
     * alors que la partie est suspendue : au retour, le temps aurait filé.
     */
    if (this.suspended) {
      this.pausedRemaining = seconds > 0 ? seconds * 1000 : undefined;
      return;
    }
    this.deadline = seconds > 0 ? this.now() + seconds * 1000 : undefined;
  }

  /** Millisecondes restantes, ou `undefined` si la phase n'est pas chronométrée. */
  remainingMs(): number | undefined {
    if (this.suspended) return this.pausedRemaining;
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
    // En pause, rien n'est dû : ni l'expiration, ni le tour joué d'office.
    if (!this.manualStart || this.suspended) return [];
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
      paused: this.suspended,
    });
  }

  privateView(playerId: PlayerId): PrivatePlayerView | undefined {
    return privateView(this.state, playerId);
  }
}

/**
 * Refabrique une partie depuis son journal.
 *
 * La recette rebâtit le plateau — le moteur étant déterministe, la même graine
 * redonne les mêmes terrains, les mêmes jetons et la même pioche — et les
 * commandes sont resoumises dans l'ordre. Les tours joués d'office pour les
 * absents en font partie : ils passent par `submit`, donc ils ont été
 * journalisés comme les autres, et la partie restaurée les rejoue à
 * l'identique plutôt que de les recalculer autrement.
 *
 * Une commande refusée interrompt la restauration, et sa position est
 * renvoyée. Continuer sur une divergence serait pire que s'arrêter : l'état
 * obtenu ne correspondrait plus à la partie qu'on croit avoir rechargée, et
 * rien à l'écran ne le dirait.
 */
export function restoreSession(
  journal: Journal,
  now?: () => number,
): { ok: true; session: GameSession } | { ok: false; at: number; command: Command } {
  const { recipe } = journal.header;
  const session = new GameSession({ ...recipe, ...(now ? { now } : {}) });
  session.start();

  for (const [index, entry] of journal.entries.entries()) {
    if (!session.submit(entry.command).result.ok) {
      return { ok: false, at: index, command: entry.command };
    }
  }

  // Les noms après les commandes : le dernier baptême de chaque siège fait
  // foi, et l'ordre du journal le donne déjà.
  for (const seat of journal.seats) session.renameSeat(seat.playerId, seat.name);

  return { ok: true, session };
}
