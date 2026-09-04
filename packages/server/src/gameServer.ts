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

import { join } from 'node:path';

import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';

import { WebSocketServer, type WebSocket } from 'ws';

import {
  type BoardSize, type Command, type DomainEvent, type GameConfig,
  defaultConfig, defaultLandCount, LAND_LIMITS, landCountFor, minLandFor,
} from '@grandes-colonies/engine';
import { redactAllFor, toWireAll } from '@grandes-colonies/protocol';

import { JournalWriter, type Journal } from './journal.js';
import { GameSession, restoreSession } from './session.js';

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
  /**
   * Dossier où déposer le journal de partie, s'il en faut un.
   *
   * Absent, rien n'est écrit : les tests montent des dizaines de serveurs et
   * n'ont aucune raison de laisser des fichiers derrière eux. C'est l'écran
   * de l'hôte qui l'active, parce que c'est lui qui tient une vraie soirée.
   */
  readonly journalDir?: string;
  /**
   * Journal à reprendre, au lieu d'une partie neuve.
   *
   * La session est refabriquée par rejeu des commandes : même graine, même
   * plateau, mêmes gestes. Les sièges reçoivent des jetons neufs — les
   * anciens sont morts avec le processus précédent — donc chacun rejoint
   * comme il l'avait fait la première fois.
   */
  readonly restore?: Journal;
  /** Forme du plateau : archipel (défaut) ou disque. */
  readonly boardKind?: 'archipelago' | 'disc';
  /**
   * Taille des terres : un préréglage, ou un nombre d'hexagones.
   *
   * Comme `boardKind`, c'est un point de départ et non une décision figée :
   * l'écran de l'hôte la change tant que la partie n'est pas lancée. Sans
   * elle, ouvrir une soirée sur un vaste plateau demandait de construire le
   * serveur au format normal puis de le reconfigurer aussitôt.
   *
   * Omise, la taille équilibrée pour l'effectif s'applique (§4).
   */
  readonly boardSize?: BoardSize;
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
  /**
   * Nombre d'hexagones de terre, réglé au chiffre.
   *
   * C'était une échelle à trois crans — normale, grande, immense — multipliant
   * la taille que le §4 tire de l'effectif. Deux défauts s'ensuivaient : sous
   * huit joueurs le réglage n'avait **aucun** effet, la partie tombant sur le
   * plateau classique de dix-neuf tuiles qui ne prend pas d'échelle ; et
   * au-dessus, la base saturant à quarante-quatre jusqu'à onze joueurs, huit,
   * neuf et dix joueurs recevaient exactement le même plateau. On ne pouvait
   * pas demander « soixante-douze terres à huit joueurs ».
   *
   * C'est donc un nombre, et il ne dépend plus de l'effectif. La valeur
   * équilibrée du §4 reste le point de départ — `baseLandCount` — mais elle
   * se quitte.
   */
  readonly landCount: number;
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
  landCount: LAND_LIMITS,
  victoryTarget: { min: 6, max: 30 },
  setupSeconds: { min: 15, max: 300 },
  activeTurnSeconds: { min: 20, max: 600 },
  tradingWindowSeconds: { min: 0, max: 180 },
} as const;

export const DEFAULT_SETTINGS: GameSettings = Object.freeze({
  playerCount: 8,
  boardKind: 'archipelago',
  // La taille du §4 pour huit joueurs. Elle suit l'effectif tant que l'hôte
  // n'y touche pas — voir `reconfigure`.
  landCount: defaultLandCount(8),
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
  const playerCount = clamp(n(base.playerCount, DEFAULT_SETTINGS.playerCount),
    SETTINGS_LIMITS.playerCount.min, SETTINGS_LIMITS.playerCount.max);
  return {
    playerCount,
    boardKind: base.boardKind === 'disc' ? 'disc' : 'archipelago',
    /*
     * Le plancher suit l'effectif, et non les seules bornes fixes.
     *
     * Servir ici une valeur que le moteur relèverait ensuite ferait mentir
     * l'écran de l'hôte : il annoncerait dix-neuf terres pour douze joueurs
     * là où la partie s'en donnerait vingt-quatre. On borne donc au même
     * plancher, pour que le chiffre affiché soit celui qui sera joué.
     */
    landCount: clamp(n(base.landCount, DEFAULT_SETTINGS.landCount),
      Math.max(SETTINGS_LIMITS.landCount.min, minLandFor(playerCount)),
      SETTINGS_LIMITS.landCount.max),
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
 * La taille demandée, ramenée à un nombre de terres.
 *
 * Sans demande, celle que le §4 prévoit pour l'effectif : c'est le point de
 * départ équilibré, et il vaut mieux qu'un chiffre fixe qui serait juste pour
 * huit joueurs et faux pour tous les autres.
 */
function landCountOf(size: BoardSize | undefined, playerCount: number): number {
  if (size === undefined) return defaultLandCount(playerCount);
  return typeof size === 'number' ? size : landCountFor(playerCount, size);
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
  /**
   * L'hôte a-t-il fixé la taille du plateau lui-même ?
   *
   * Tant que non, elle suit l'effectif : passer de quatre à douze joueurs
   * doit agrandir les terres, sans quoi douze personnes se marchent dessus
   * sur un plateau de quatre. Dès que oui, elle ne bouge plus — un chiffre
   * choisi à la main qu'un ajustement d'effectif effacerait serait pire que
   * pas de réglage du tout.
   */
  private landCountPinned = false;
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
  private readonly journalDir: string | undefined;
  private journal: JournalWriter | undefined;
  /** Chemin du journal en cours d'écriture, pour qui veut le relire. */
  private journalPathValue: string | undefined;
  /**
   * Commandes déjà couchées dans le journal.
   *
   * On journalise en comparant à la longueur du log plutôt qu'en écrivant
   * depuis `handleCommand` : les tours joués d'office pour les absents ne
   * passent pas par là, et seraient absents du journal — donc du rejeu.
   */
  private journalled = 0;
  /** Dernier nom couché au journal pour chaque siège, pour n'écrire que les changements. */
  private readonly journalledNames = new Map<string, string>();

  constructor(options: GameServerOptions = {}) {
    const names = options.playerNames ?? seatNames(DEFAULT_SETTINGS.playerCount);
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.seed = options.seed ?? `partie-${Date.now()}`;
    this.configOverride = options.config;
    this.landCountPinned = options.boardSize !== undefined;
    this.journalDir = options.journalDir;
    this.settingsValue = {
      ...normaliseSettings({
        ...(options.boardKind ? { boardKind: options.boardKind } : {}),
        // Sans taille demandée, celle que le §4 prévoit pour cet effectif —
        // et non les quarante-quatre terres du réglage par défaut, qui
        // vaudraient pour huit joueurs quel que soit le vrai nombre.
        landCount: landCountOf(options.boardSize, names.length),
      }),
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
    const reprise = options.restore ? restoreSession(options.restore) : undefined;
    if (reprise && !reprise.ok) {
      throw new Error(
        `journal illisible : la commande ${reprise.at} (${reprise.command.type}) a été refusée au rejeu`,
      );
    }

    this.current = reprise?.session ?? new GameSession({
      seed: this.seed,
      playerNames: names,
      config: options.config ?? configFor(this.settingsValue),
      ...(options.boardKind ? { boardKind: options.boardKind } : {}),
      boardSize: this.settingsValue.landCount,
    });
    if (options.restore) {
      // Ce qui vient d'être rejoué est déjà dans le fichier : le recompter
      // comme à écrire le dupliquerait à la première commande suivante.
      this.journalled = this.current.commandLog().length;
      for (const seat of this.current.allSeats()) {
        this.journalledNames.set(seat.playerId, seat.name);
      }
      this.journal = JournalWriter.continuing(options.restore);
      this.journalPathValue = options.restore.path;

      /*
       * Une partie reprise revient **en pause**.
       *
       * Sans cela le battement redémarre sur une table où personne n'est
       * encore reconnecté : chaque tour est aussitôt joué d'office, et la
       * partie qu'on venait de sauver est dévorée en quelques secondes. On a
       * mesuré six cent soixante-neuf cycles avalés avant que le premier
       * joueur ait eu le temps de rouvrir son lien.
       *
       * C'est aussi le bon geste humain : après une coupure, l'hôte attend
       * que la pièce se rebranche, puis reprend.
       */
      this.current.pause();
    }

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

  /**
   * Le journal que cette partie est en train d'écrire.
   *
   * `undefined` tant que la partie n'est pas lancée, ou quand aucun dossier de
   * journaux n'a été fourni — les tests montent des dizaines de serveurs et
   * n'ont pas à laisser de fichiers derrière eux.
   */
  get journalPath(): string | undefined {
    return this.journalPathValue;
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

    /*
     * Le plateau suit l'effectif — jusqu'à ce qu'on le règle soi-même.
     *
     * Changer le nombre de joueurs sans parler de la taille laissait le
     * plateau tel quel : passer de quatre à douze joueurs gardait dix-neuf
     * terres, et douze personnes se marchaient dessus sans qu'aucun écran ne
     * le signale. On recale donc sur la valeur du §4 — mais uniquement quand
     * la requête ne mentionne pas la taille. Dès qu'elle la mentionne, elle
     * l'emporte et ne bougera plus : c'est une décision de l'hôte, pas un
     * défaut à recalculer.
     */
    if (asked.landCount !== undefined) this.landCountPinned = true;

    const follows = !this.landCountPinned && asked.playerCount !== undefined;
    const wanted = follows
      ? { ...asked, landCount: defaultLandCount(asked.playerCount) }
      : asked;

    return this.rebuild(
      normaliseSettings({ ...this.settingsValue, ...wanted }),
      asked.newBoard === true,
    );
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
    if (asked.landCount !== undefined) this.landCountPinned = true;
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
      boardSize: next.landCount,
    });
    this.settingsValue = next;
    this.journal = undefined;
    this.journalPathValue = undefined;
    this.journalled = 0;
    this.journalledNames.clear();
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
    if (launched) {
      this.openJournal();
      this.broadcastAll();
    }
    return launched;
  }

  /**
   * Ouvre le journal de la partie qui commence.
   *
   * Au lancement et non à la construction : tant que l'hôte règle son salon,
   * la session est reconstruite à chaque changement, et l'on sèmerait un
   * fichier par tour de molette.
   */
  private openJournal(): void {
    if (this.journalDir === undefined) return;
    const gameId = `${this.seed}-${this.rebuilds}`;
    this.journalPathValue = join(this.journalDir, `${gameId}.jsonl`);
    this.journal = new JournalWriter(this.journalPathValue, {
      gameId,
      startedAt: Date.now(),
      recipe: this.current.recipe,
    });
    this.journalled = this.current.commandLog().length;
    // Les noms déjà pris dans le salon doivent figurer dès l'ouverture : ils
    // ont été choisis avant le lancement, donc avant la première commande.
    this.journalledNames.clear();
    this.flushJournal();
  }

  /**
   * Couche au journal tout ce qui a été accepté depuis le dernier passage.
   *
   * En comparant les longueurs plutôt qu'en écrivant à chaque commande reçue :
   * les tours joués d'office pour les absents n'arrivent pas par le réseau et
   * manqueraient au rejeu, qui divergerait sans rien dire.
   */
  private flushJournal(): void {
    if (!this.journal) return;
    const log = this.current.commandLog();
    const at = Date.now();
    for (let i = this.journalled; i < log.length; i++) this.journal.append(log[i]!, at);
    this.journalled = log.length;

    /*
     * Les noms, au même endroit que les commandes.
     *
     * Ils ne passent pas par le moteur — on se baptise en rejoignant, pas en
     * jouant — et ne laissaient donc aucune trace. Une partie reprise
     * revenait peuplée de « Joueur 1 » : la même partie, mais plus celle de
     * personne. On ne réécrit que ce qui a changé.
     */
    for (const seat of this.current.allSeats()) {
      if (this.journalledNames.get(seat.playerId) === seat.name) continue;
      this.journalledNames.set(seat.playerId, seat.name);
      this.journal.seat(seat.playerId, seat.name, at);
    }
  }

  /**
   * Suspend la partie, et le dit à tout le monde.
   *
   * Passer par la session seule laisserait les douze écrans sur leur dernier
   * état : le compte à rebours s'arrêterait sans que rien n'explique
   * pourquoi, ce qui ressemble exactement à une connexion perdue.
   */
  pauseGame(): boolean {
    const done = this.current.pause();
    if (done) this.broadcastAll();
    return done;
  }

  resumeGame(): boolean {
    const done = this.current.resume();
    if (done) this.broadcastAll();
    return done;
  }

  /** Rallonge la phase en cours. Le battement diffusera le nouveau compte. */
  extendTimer(seconds: number): boolean {
    return this.current.extendTimer(seconds);
  }

  /**
   * Confie le siège d'un absent à un adversaire automatique.
   *
   * La connexion éventuellement restée ouverte sur ce siège est coupée et
   * oubliée : son jeton vient d'être invalidé, et la laisser en place ferait
   * transiter les vues d'un siège désormais tenu par quelqu'un d'autre.
   */
  handSeatToBot(playerId: string): boolean {
    if (!this.current.handToBot(playerId)) return false;

    for (const [socket, seated] of this.seatOf) {
      if (seated !== playerId) continue;
      this.seatOf.delete(socket);
      this.botSockets.delete(socket);
      this.send(socket, 'full', { reason: 'siège confié à un adversaire automatique' });
      socket.close();
    }

    this.broadcastAll();
    return true;
  }

  /**
   * Applique une commande de maître de jeu, et diffuse ce qu'elle a produit.
   *
   * Passe par `submitAsHost`, seul chemin qui accepte les `GM_` : celui des
   * joueurs les refuse, quel que soit le client.
   */
  hostCommand(command: Command): { ok: boolean; reason?: string } {
    let outcome;
    try {
      outcome = this.current.submitAsHost(command);
    } catch (error) {
      console.error('[serveur] commande maître de jeu sur exception', command.type, error);
      return { ok: false, reason: error instanceof Error ? error.message : String(error) };
    }

    if (!outcome.result.ok) return { ok: false, reason: outcome.result.reason };

    this.flushJournal();
    if (outcome.events.length > 0) this.broadcastEvents(outcome.events);
    this.broadcastAll();
    return { ok: true };
  }

  /** Sièges absents depuis assez longtemps pour qu'on propose un bot. */
  seatsEligibleForBot(): readonly string[] {
    return this.current.seatsEligibleForBot().map((seat) => seat.playerId);
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

    this.flushJournal();
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
    this.flushJournal();
    if (events.length > 0) {
      this.broadcastEvents(events);
      this.broadcastAll();
      return;
    }

    // Même sans événement, le compte à rebours doit avancer côté client.
    this.broadcast('timer', {
      remainingMs: this.session.remainingMs(),
      phase: this.session.state.phase,
      paused: this.session.isPaused,
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
