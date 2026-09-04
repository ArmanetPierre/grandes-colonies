/**
 * Écran de jeu.
 *
 * Reprend la structure « bandeau d'ordre » des wireframes : l'état du joueur
 * occupe toute la largeur en haut, parce que la question qui revient sans
 * cesse à douze joueurs est « qu'est-ce que je peux faire, là, maintenant ? ».
 * Le reste de l'écran ne sert qu'à y répondre.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BoardGraph, COSTS, type ResourceCounts, type Terrain, parseHexKey, yieldOf } from '@grandes-colonies/engine';
import type { Pair, PrivatePlayerView, PublicGameView } from '@grandes-colonies/protocol';

import {
  type ConnectionStatus,
  type Rejection,
  type SeatInfo,
  type TimerInfo,
  GameConnection,
  newActionId,
} from './net/connection.js';
import { serverUrl } from './net/serverUrl.js';
import { Board, type PoigneePlateau, colorOf, dureeDuJet } from './ui/Board.jsx';
import { useCompact } from './ui/compact.js';
import { Gains, type Vol, composerVols } from './ui/Gains.jsx';
import { type CardRequest, DevCards } from './ui/DevCards.jsx';
import { Discard } from './ui/Discard.jsx';
import { GameOver } from './ui/GameOver.jsx';
import { DUREE_BANDEAU, Dice } from './ui/Dice.jsx';
import { CostLine, type CostKind, Hint } from './ui/Hint.jsx';
import { type Entry, Journal, describe } from './ui/Journal.jsx';
import { Market } from './ui/Market.jsx';
import { RESOURCE_LABELS, ResourceIcon } from './ui/ResourceIcon.jsx';
import { Lobby } from './ui/Lobby.jsx';
import { ObjectiveChoice } from './ui/ObjectiveChoice.jsx';
import { Trade } from './ui/Trade.jsx';

/** La phrase d'ordre : ce que le joueur doit faire, en une ligne. */
function orderSentence(pub: PublicGameView | undefined, priv: PrivatePlayerView | undefined): string {
  if (!pub || !priv) return 'Connexion…';
  if (pub.winner) return pub.winner === priv.id ? 'Tu as gagné.' : 'Partie terminée.';

  const caps = new Set(priv.capabilities);
  if (caps.has('CAN_DISCARD')) return 'Défausse tes cartes.';
  if (caps.has('CAN_PLACE_SETUP')) return 'Pose ta colonie puis ta route.';
  if (caps.has('CAN_MOVE_ROBBER')) return 'Déplace le voleur.';
  if (caps.has('CAN_ROLL_DICE')) return 'À toi de lancer les dés.';

  const isPaired = pub.pairedPlayer === priv.id;
  if (caps.has('CAN_END_TURN')) return 'Construis, échange, puis passe la main.';
  if (isPaired && caps.has('CAN_BUILD')) return 'Tour associé : tu peux construire.';
  if (caps.has('CAN_TRADE_PLAYER')) return 'Échange avec qui tu veux.';
  if (caps.has('CAN_DECLARE_BUILD')) return 'Tu peux annoncer une construction.';

  const active = pub.players.find((p) => p.id === pub.activePlayer);
  return active ? `${active.name} joue.` : 'En attente…';
}

function formatTimer(ms: number | undefined): string {
  if (ms === undefined) return '—';
  const total = Math.ceil(ms / 1000);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const NAME_KEY = 'grandes-colonies:name';

/**
 * Ce que chaque action fait, dit en une phrase.
 *
 * Le coût n'est pas écrit ici : il est lu dans la table du moteur, pour
 * qu'une infobulle ne puisse pas mentir sur le prix réellement débité.
 */
const HINTS: Record<string, { text: string; cost?: CostKind; note?: string }> = {
  road: {
    text: 'Prolonge ton réseau vers de nouveaux emplacements. Le plus long réseau rapporte 2 points.',
    cost: 'road',
  },
  maritime: {
    text: 'Franchit la mer vers une autre île. Compte dans le même réseau que tes routes.',
    cost: 'maritimeRoute',
    note: 'Le premier à bâtir sur une île secondaire gagne 1 point.',
  },
  settlement: {
    text: '1 point. Produit une ressource à chaque lancer sur ses hexagones voisins.',
    cost: 'settlement',
    note: 'Deux colonies ne peuvent pas se toucher.',
  },
  city: {
    text: '2 points au lieu d\'1, et double la production de son emplacement.',
    cost: 'city',
    note: 'Remplace une de tes colonies, qui retourne dans ta réserve.',
  },
  metropolis: {
    text: '3 points au lieu des 2 de la cité qu\'elle améliore.',
    cost: 'metropolis',
    note: 'Trois seulement pour toute la partie : premier arrivé, premier servi.',
  },
  monument: {
    text: '2 points, sans occuper le moindre emplacement nouveau.',
    cost: 'monument',
    note: 'Un seul par joueur, sur une de tes cités.',
  },
  devCard: {
    text: 'Chevalier, Invention, Monopole, Construction de routes ou Bâtisseur, au hasard.',
    cost: 'devCard',
    note: 'Jouable à partir du tour suivant, une carte par tour.',
  },
  roll: {
    text: 'Chaque joueur récolte sur les hexagones qui portent le numéro sorti.',
    note: 'Sur un 7, le voleur bouge et les mains trop pleines se défaussent.',
  },
  declare: {
    text: 'Réserve un emplacement hors de ton tour. Tes ressources sont mises de côté aussitôt.',
    note: 'La construction se résout en fin de cycle ; en cas de conflit, le joueur actif l\'emporte.',
  },
  endTurn: {
    text: 'Passe la main et ouvre la fenêtre de commerce, pendant laquelle tout le monde négocie.',
  },
  endCycle: {
    text: 'Résout les annonces de construction et donne la main au joueur suivant.',
  },
  market: {
    text: 'Toutes les offres de la table, y compris celles qui ne te sont pas adressées.',
    note: 'Savoir qui réclame quoi vaut mieux que de proposer au hasard.',
  },
};

/** Lignes de journal conservées. Au-delà, personne ne remonte. */
const JOURNAL_LENGTH = 40;

/** Ce qu'un joueur peut s'apprêter à poser. */
type BuildKind = 'settlement' | 'city' | 'metropolis' | 'monument' | 'road' | 'maritime' | null;

const BUILD_LABELS: Record<string, string> = {
  road: 'route', maritime: 'voie maritime', settlement: 'colonie',
  city: 'ville', metropolis: 'métropole', monument: 'monument',
};

/**
 * Les tiroirs de la version téléphone.
 *
 * Un seul à la fois, et jamais deux panneaux à l'écran : sur trois cent
 * quatre-vingt-treize pixels de haut, deux panneaux ouverts, c'est un
 * plateau invisible.
 */
type Drawer = 'build' | 'trade' | 'cards' | 'journal' | 'players' | null;

const DRAWER_TITLES: Record<Exclude<Drawer, null>, string> = {
  build: 'Construire',
  trade: 'Commerce',
  cards: 'Cartes développement',
  journal: 'Journal',
  players: 'La table',
};

export function App({ url = serverUrl() }: { url?: string }) {
  /**
   * Le nom est demandé avant toute connexion, et mémorisé.
   *
   * Sans lui, la liste des joueurs affiche « Joueur 3 » et plus personne ne
   * sait qui est qui — or c'est cette liste que chacun consulte pour décider
   * à qui proposer un échange.
   */
  const [name, setName] = useState<string | null>(() => localStorage.getItem(NAME_KEY));
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [seat, setSeat] = useState<SeatInfo>();
  const [pub, setPub] = useState<PublicGameView>();
  const [priv, setPriv] = useState<PrivatePlayerView>();
  const [timer, setTimer] = useState<TimerInfo>();
  const [notice, setNotice] = useState<string>();
  /**
   * Les dernières lignes du journal, la plus récente en tête.
   *
   * Bornées : une partie à douze joueurs produit des milliers d'événements, et
   * personne ne remonte au cycle trois.
   */
  const [journal, setJournal] = useState<readonly Entry[]>([]);
  /*
   * La dernière production annoncée par le serveur.
   *
   * On garde l'événement plutôt que d'agir dans le gestionnaire : ce dernier
   * est créé une fois pour toutes avec la connexion, et ne verrait donc
   * jamais que la vue du premier rendu. Le travail se fait dans un effet, où
   * le plateau et la main du joueur sont ceux d'aujourd'hui.
   */
  const [production, setProduction] = useState<readonly Pair<ResourceCounts>[]>([]);
  const [vols, setVols] = useState<readonly Vol[]>([]);
  /** Ce qui vient d'entrer dans la main, le temps de le montrer. */
  const [recolte, setRecolte] = useState<Readonly<Record<string, number>>>({});
  const plateau = useRef<PoigneePlateau | null>(null);
  /** Le marché est ouvert : on regarde toutes les offres de la table. */
  const [market, setMarket] = useState(false);
  /**
   * Le dernier lancer connu, conservé au-delà du cycle.
   *
   * `lastRoll` repasse à `undefined` en fin de cycle : les dés étaient donc
   * démontés puis remontés à chaque tour, se croyaient toujours au premier
   * affichage, et n'ont jamais roulé une seule fois.
   */
  const [roll, setRoll] = useState<{ a: number; b: number; total: number }>();
  /**
   * Le lancer que le plateau doit rejouer.
   *
   * Distinct de `roll`, et pour la raison qui vaut aussi pour la production :
   * un lancer est un instant, alors que `lastRoll` est un état qui reste
   * inscrit tout le tour. Le compteur `n` en fait un instant que React sait
   * distinguer du précédent — sans lui, deux 4-3 de suite ne feraient rouler
   * les dés qu'une fois.
   */
  const [jet, setJet] = useState<{ a: number; b: number; n: number }>();
  /**
   * Le temps que le reste de l'écran doit laisser aux dés.
   *
   * Une référence et non un état : elle est lue par les effets déclenchés
   * dans le même battement — le bandeau, la récolte — et un état les ferait
   * courir un rendu en retard. Elle vaut zéro quand rien ne roule, ce qui est
   * le cas de toutes les mises à jour qui ne suivent pas un lancer, et sous
   * `prefers-reduced-motion`.
   */
  const retardDes = useRef(0);
  /** Les dés roulent : ce qui recouvrirait le plateau attend son tour. */
  const [jetEnCours, setJetEnCours] = useState(false);
  /**
   * Ce que le joueur s'apprête à poser. Rien n'est cliquable tant qu'il n'a
   * pas choisi : sur un plateau de cinquante tuiles, afficher tous les
   * emplacements de tous les types en même temps serait illisible.
   */
  const [intent, setIntent] = useState<BuildKind>(null);
  /**
   * La carte développement armée, et ce qu'elle a déjà collecté.
   *
   * Trois des cinq cartes se jouent sur le plateau, avec le même geste que la
   * construction. Les tenir dans un état à part évite de confondre « je pose
   * une route » et « je joue Construction de routes », qui ne coûtent pas la
   * même chose.
   */
  const [card, setCard] = useState<{ kind: CardRequest['kind']; edges: string[] } | null>(null);
  /**
   * Le voleur est posé, reste à désigner qui l'on dépouille.
   *
   * Tant que ce choix n'existait pas, le client envoyait le déplacement sans
   * victime et le moteur, faute de nom, ne volait rien : le voleur bloquait
   * la production mais ne prenait rien à personne.
   */
  const [robbing, setRobbing] = useState<{ hex: string; victims: readonly string[] } | null>(null);
  /**
   * Le format de l'écran, et le tiroir ouvert par-dessus le plateau.
   *
   * Sur téléphone tout ce qui n'est pas le plateau, la main et l'action du
   * moment vit derrière un onglet : c'est la convention des jeux de plateau
   * mobiles, et la seule qui laisse au plateau la place de se lire.
   */
  const compact = useCompact();
  const [drawer, setDrawer] = useState<Drawer>(null);
  const connection = useRef<GameConnection | undefined>(undefined);

  useEffect(() => {
    if (name === null) return undefined;
    const conn = new GameConnection({ url, name }, {
      onStatus: setStatus,
      onSeat: setSeat,
      onPublic: setPub,
      onPrivate: setPriv,
      onTimer: setTimer,
      onEvents: (events) => {
        // La production est la seule chose qu'on lise autrement que comme une
        // ligne de journal : c'est un gain, et un gain se fête.
        const gains = events.flatMap((e) => (e.type === 'ResourcesProduced' ? e.gains : []));
        if (gains.length > 0) setProduction(gains);

        /*
         * Le lancer, qui règle la cadence de tout ce qui suit.
         *
         * La production arrive dans le même message que les dés : sans ce
         * retard, les jetons sauteraient et les cartes voleraient pendant que
         * les dés tournent encore, et le lancer n'annoncerait plus rien.
         */
        retardDes.current = 0;
        for (const e of events) {
          if (e.type !== 'DiceRolled') continue;
          retardDes.current = dureeDuJet();
          setJet((precedent) => ({ a: e.a, b: e.b, n: (precedent?.n ?? 0) + 1 }));
        }

        const fresh = events.map(describe).filter((e): e is Entry => e !== undefined);
        if (fresh.length === 0) return;
        setJournal((current) => [...fresh.reverse(), ...current].slice(0, JOURNAL_LENGTH));
      },
      onRejected: (r: Rejection) => {
        // Le refus est motivé par le moteur : on le montre tel quel plutôt
        // que d'inventer une explication.
        setNotice(r.detail ?? r.reason);
        setTimeout(() => setNotice(undefined), 3000);
      },
    });
    connection.current = conn;
    conn.connect();
    return () => conn.close();
  }, [url, name]);

  const send = useCallback((type: string, extra: Record<string, unknown> = {}) => {
    connection.current?.send({ actionId: newActionId(), type, ...extra });
  }, []);

  /*
   * Le bandeau ne dit le total qu'une fois les dés posés.
   *
   * Il roule pendant les six dernières dixièmes du lancer, si bien que les
   * deux dés — celui de la carte et celui du coin de l'écran — s'arrêtent
   * ensemble. L'afficher tout de suite aurait vendu la mèche : personne ne
   * regarde tomber un dé dont il connaît déjà le résultat.
   */
  useEffect(() => {
    const dernier = pub?.lastRoll;
    if (!dernier) return undefined;

    const attente = Math.max(0, retardDes.current - DUREE_BANDEAU);
    if (attente === 0) {
      setRoll(dernier);
      return undefined;
    }
    const minuterie = window.setTimeout(() => setRoll(dernier), attente * 1000);
    return () => window.clearTimeout(minuterie);
  }, [pub?.lastRoll]);

  /*
   * Les dés roulent sur la carte.
   *
   * La clé du roulement est faite de ce que tous les clients connaissent —
   * le cycle, le joueur actif, les deux nombres — pour que les douze écrans
   * montrent le même lancer et non douze trajectoires différentes arrivant
   * au même total. Le résultat, lui, vient du moteur : rien ici ne tire quoi
   * que ce soit.
   */
  useEffect(() => {
    if (!jet || !pub) return undefined;
    plateau.current?.lancerDes(jet.a, jet.b, `${pub.cycle}-${pub.activePlayer}-${jet.a}-${jet.b}`);

    const attente = retardDes.current;
    if (attente === 0) return undefined;
    setJetEnCours(true);
    const minuterie = window.setTimeout(() => setJetEnCours(false), attente * 1000);
    return () => {
      window.clearTimeout(minuterie);
      setJetEnCours(false);
    };
    // `pub` est lu au passage : c'est l'arrivée du lancer qui déclenche.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jet]);

  const caps = useMemo(() => new Set(priv?.capabilities ?? []), [priv]);

  const order = useMemo(() => pub?.players.map((p) => p.id) ?? [], [pub]);

  /**
   * Le graphe du plateau, reconstruit depuis les identifiants d'hexagones.
   *
   * Il ne sert qu'à une chose : proposer la seconde route de la carte
   * Construction de routes, qui s'appuie souvent sur la première et
   * n'apparaît donc pas dans les emplacements calculés par le serveur — ce
   * dernier ignore la pose provisoire. Ce n'est pas une duplication des
   * règles de placement : le moteur reste seul juge, et refuse ce qui doit
   * l'être. On mémorise sur la liste des hexagones, qui ne change jamais.
   */
  const hexKeys = pub?.hexes.map((h) => h.id).join(';') ?? '';
  const graph = useMemo(
    () => (hexKeys === '' ? undefined : new BoardGraph(hexKeys.split(';').map(parseHexKey))),
    [hexKeys],
  );

  /*
   * La récolte : les jetons sautent, les cartes volent.
   *
   * Le montant vient du serveur et de nulle part ailleurs — c'est lui qui
   * tient les règles, et une addition faite ici finirait par diverger de la
   * sienne. Ne reste à deviner que le point de départ du vol, qui est de
   * l'affichage : au pire une carte part du mauvais hexagone, jamais un
   * mauvais nombre.
   */
  useEffect(() => {
    if (production.length === 0 || !pub || !priv) return undefined;

    /*
     * Rien ne bouge avant que les dés soient tombés.
     *
     * La production arrive dans le même message que le lancer, et le jeton
     * qui saute est censé répondre au nombre sorti : le faire sauter avant
     * que le nombre soit lisible, c'est donner la réponse avant la question.
     */
    let fin = 0;
    const recolter = (): void => {
      /*
       * Les hexagones qui ont produit.
       *
       * Le chiffre sorti et la présence du voleur suffisent, et l'un comme
       * l'autre sont publics : on ne redit pas ici la règle de production, on
       * lit ce que le plateau montre déjà à tout le monde.
       */
      const sorti = pub.lastRoll?.total;
      const producteurs = sorti === undefined
        ? []
        : pub.hexes.filter((h) => h.token === sorti && !h.blocked);
      plateau.current?.signalerProduction(producteurs.map((h) => h.id));

      const miens = production.find((g) => g.player === priv.id)?.value;
      if (!miens) return;
      setRecolte(miens as Record<string, number>);

      /*
       * D'où part chaque carte.
       *
       * De l'hexagone qui produit cette ressource **et** que touche l'une de
       * mes constructions — un sommet porte dans son identifiant les trois
       * hexagones qui s'y rejoignent, il n'y a donc rien à calculer. À défaut,
       * la carte part du centre du plateau : mieux vaut un vol approximatif
       * qu'un gain passé sous silence.
       */
      const miennes = new Set(
        pub.buildings.filter((b) => b.owner === priv.id).flatMap((b) => b.vertex.split('|')),
      );
      const depart = (resource: string): { x: number; y: number } | undefined => {
        const source = producteurs.find((h) => yieldOf(h.terrain as Terrain) === resource && miennes.has(h.id))
          ?? producteurs.find((h) => yieldOf(h.terrain as Terrain) === resource);
        const hex = source?.id ?? pub.hexes[Math.floor(pub.hexes.length / 2)]?.id;
        return hex === undefined ? undefined : plateau.current?.projeterHex(hex);
      };

      const arrivee = (resource: string): { x: number; y: number } | undefined => {
        const pile = document.querySelector(`[data-ressource="${resource}"]`);
        if (!pile) return undefined;
        const cadre = pile.getBoundingClientRect();
        return { x: cadre.left + cadre.width / 2, y: cadre.top + cadre.height / 2 };
      };

      setVols(composerVols(miens as Record<string, number>, depart, arrivee, Date.now()));

      // La pile cesse d'afficher son gain une fois les cartes arrivées.
      fin = window.setTimeout(() => setRecolte({}), 2000);
    };

    const lancee = window.setTimeout(recolter, retardDes.current * 1000);
    return () => {
      window.clearTimeout(lancee);
      window.clearTimeout(fin);
    };
    // `pub` et `priv` sont lus au passage, mais c'est l'arrivée d'une
    // production qui déclenche : les suivre relancerait l'animation à chaque
    // message du serveur, donc plusieurs fois par seconde.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [production]);

  // Pendant la mise en place, le jeu impose la suite : colonie puis route.
  // Inutile de demander au joueur de choisir ce qu'il sait déjà.
  const freeBuilding = card?.kind === 'freeBuild';
  /*
   * Annoncer ou construire : le mode se déduit, il ne s'arme plus.
   *
   * C'était un interrupteur séparé du choix de construction, et une fois
   * armé plus rien à l'écran ne le rappelait : on cliquait « Colonie » en
   * croyant bâtir, et on annonçait. Le correctif d'alors désarmait
   * l'interrupteur au bon moment — il traitait la conséquence. La cause
   * était qu'un état invisible décidait du sens d'un clic.
   *
   * Hors de son tour, on ne peut de toute façon qu'annoncer ; à son tour, on
   * ne peut que construire. L'état était donc redondant avec les capacités,
   * et les boutons peuvent dire eux-mêmes ce qu'ils font.
   */
  const annonce = !caps.has('CAN_BUILD') && !freeBuilding && caps.has('CAN_DECLARE_BUILD');

  const canPick = caps.has('CAN_BUILD') || freeBuilding || annonce;
  const setupIntent: BuildKind = caps.has('CAN_PLACE_SETUP')
    ? ((priv?.spots.roads.length ?? 0) > 0 ? 'road' : 'settlement')
    : null;
  const active = setupIntent ?? intent;

  const picking = setupIntent !== null || canPick;

  /**
   * Les arêtes ouvertes à la seconde route.
   *
   * Volontairement un peu large : une arête voisine de la première n'est pas
   * forcément légale — une colonie adverse peut couper le passage — mais le
   * moteur tranche, et un refus motivé vaut mieux qu'une arête invisible.
   */
  const secondRoadSpots = (first: string): string[] => {
    const taken = new Set([...(pub?.roads.map((r) => r.edge) ?? []), first]);
    const out = new Set<string>((priv?.spots.roads ?? []).filter((e) => !taken.has(e)));
    for (const vertex of graph?.verticesOfEdgeOnBoard(first) ?? []) {
      for (const edge of graph?.edgesOfVertexOnBoard(vertex) ?? []) {
        if (!taken.has(edge)) out.add(edge);
      }
    }
    return [...out];
  };

  const roadCard = card?.kind === 'roadBuilding' ? card : undefined;
  const knightArmed = card?.kind === 'knight';

  const shownVertices = knightArmed || roadCard ? []
    : !picking ? []
    : active === 'settlement' ? priv?.spots.settlements
    : active === 'city' ? priv?.spots.cities
    : active === 'metropolis' ? priv?.spots.metropolises
    : active === 'monument' ? priv?.spots.monuments
    : [];
  const shownEdges = roadCard
    ? (roadCard.edges[0] === undefined ? priv?.spots.roads : secondRoadSpots(roadCard.edges[0]))
    : knightArmed ? []
    : !picking ? []
    : active === 'road' ? priv?.spots.roads
    : active === 'maritime' ? priv?.spots.maritime
    : [];

  const place = useCallback((kind: BuildKind, target: string) => {
    if (!kind || !pub) return;
    const setup = pub.phase === 'setup';

    if (card?.kind === 'freeBuild' && !setup) {
      // La carte offre la combinaison de ressources : mêmes règles de
      // placement, aucun paiement.
      send('PLAY_FREE_BUILD', {
        target: kind === 'road' ? { kind: 'road', edge: target } : { kind, vertex: target },
      });
      setCard(null);
    } else if (annonce && !setup) {
      // L'annonce vise un emplacement sans le prendre : les ressources sont
      // réservées, la résolution aura lieu en fin de cycle.
      send('DECLARE_BUILD', {
        target: kind === 'road' ? { kind: 'road', edge: target } : { kind, vertex: target },
      });
    } else if (kind === 'maritime') {
      send('BUILD_MARITIME_ROUTE', { edge: target });
    } else if (kind === 'road') {
      send(setup ? 'PLACE_SETUP_ROAD' : 'BUILD_ROAD', { edge: target });
    } else if (kind === 'settlement') {
      send(setup ? 'PLACE_SETUP_SETTLEMENT' : 'BUILD_SETTLEMENT', { vertex: target });
    } else if (kind === 'metropolis') {
      send('BUILD_METROPOLIS', { vertex: target });
    } else if (kind === 'monument') {
      send('BUILD_MONUMENT', { vertex: target });
    } else {
      send('BUILD_CITY', { vertex: target });
    }
    setIntent(null);
  }, [pub, send, annonce, card]);

  /** Construction de routes : deux clics, ou un seul si le joueur s'arrête. */
  const pickRoad = (edge: string): void => {
    if (card?.kind !== 'roadBuilding') return;
    const edges = [...card.edges, edge];
    if (edges.length < 2) { setCard({ ...card, edges }); return; }
    send('PLAY_ROAD_BUILDING', { edges });
    setCard(null);
  };

  /** Le déplacement du voleur, avec ou sans victime selon ce qu'offre l'hexagone. */
  const moveRobber = (hex: string, victim?: string): void => {
    const type = card?.kind === 'knight' ? 'PLAY_KNIGHT' : 'MOVE_ROBBER';
    send(type, { to: hex, ...(victim ? { victim } : {}) });
    setCard(null);
    setRobbing(null);
  };

  const clickHex = (hex: string): void => {
    const victims = priv?.spots.robberVictims[hex] ?? [];
    // Un seul candidat : le demander serait une cérémonie inutile.
    if (victims.length === 1) { moveRobber(hex, victims[0]); return; }
    if (victims.length === 0) { moveRobber(hex); return; }
    setRobbing({ hex, victims });
  };

  if (name === null) return <NameEntry onChoose={(chosen) => {
    localStorage.setItem(NAME_KEY, chosen);
    setName(chosen);
  }} />;

  if (!pub || !priv || !seat) {
    return (
      <div className="gc-splash">
        <h1>Grandes Colonies</h1>
        <p>{status === 'full' ? 'La partie est complète.' : 'Connexion au serveur…'}</p>
      </div>
    );
  }

  // Avant le lancement, rien n'est jouable : montrer le plateau ferait
  // croire à une panne plutôt qu'à une attente.
  if (!pub.started) return <Lobby view={pub} me={priv.id} myName={name} />;

  const me = pub.players.find((p) => p.id === priv.id);
  const myIntents = pub.intents.filter((i) => i.player === priv.id);
  const overLimit = (me?.handSize ?? 0) > pub.handLimit;

  /**
   * Armer un type de construction referme le tiroir.
   *
   * Sur téléphone le choix se fait dans un panneau qui couvre le plateau :
   * le garder ouvert cacherait précisément les emplacements qu'on vient de
   * demander à voir.
   */
  const chooseIntent = (kind: BuildKind): void => {
    setIntent(kind);
    if (kind !== null) setDrawer(null);
  };

  const canBuildNow = caps.has('CAN_BUILD') || freeBuilding || annonce;

  /** Tous les emplacements ouverts, types confondus : la pastille de l'onglet. */
  const spotCount = priv.spots.settlements.length + priv.spots.cities.length
    + priv.spots.roads.length + priv.spots.maritime.length
    + priv.spots.metropolises.length + priv.spots.monuments.length;

  const cardCount = priv.playableDevCards.length + priv.pendingDevCards.length;

  /* ── les morceaux, communs aux deux mises en page ─────────────────── */

  const board = (
    <Board
      ref={plateau}
      view={pub}
      highlightVertices={shownVertices ?? []}
      highlightEdges={shownEdges ?? []}
      onVertexClick={(vertex) => place(active, vertex)}
      onEdgeClick={(edge) => (roadCard ? pickRoad(edge) : place(active, edge))}
      onHexClick={clickHex}
      robberTargets={
        caps.has('CAN_MOVE_ROBBER') || knightArmed ? priv.spots.robber : []
      }
    />
  );

  const playerList = (
    <aside className="gc-players">
      {pub.players.map((player) => (
        <div
          key={player.id}
          className={[
            'gc-player',
            player.role === 'active' ? 'is-active' : '',
            player.role === 'paired' ? 'is-paired' : '',
            player.connected ? '' : 'is-away',
            player.id === priv.id ? 'is-me' : '',
          ].join(' ')}
        >
          <span className="gc-chip" style={{ background: colorOf(player.id, order) }} />
          <span className="gc-name">{player.name}</span>
          {player.role !== 'idle' && (
            <span className="gc-role">{player.role === 'active' ? 'Actif' : 'Associé'}</span>
          )}
          {player.hasMonument && <span className="gc-monument" title="Monument élevé">▲</span>}
          <span className="gc-stat">{player.publicPoints} PV · {player.handSize} c.</span>
          {player.mustDiscard > 0 && <span className="gc-warn" title="Doit défausser">⚠</span>}
        </div>
      ))}
    </aside>
  );

  const hand = (
    <div className="gc-hand">
      {Object.entries(priv.hand).map(([resource, count]) => (
        <span
          key={resource}
          // Visé par les cartes en vol : c'est par cet attribut que
          // l'animation retrouve la pile où atterrir.
          data-ressource={resource}
          className={`gc-res${recolte[resource] ? ' is-gagne' : ''}`}
          title={RESOURCE_LABELS[resource] ?? resource}
        >
          <ResourceIcon resource={resource} />
          <strong>{count}</strong>
          {recolte[resource] ? <em className="gc-res-gain">+{recolte[resource]}</em> : null}
        </span>
      ))}
      <span className={`gc-limit${overLimit ? ' is-over' : ''}`}>
        {me?.handSize ?? 0} / {pub.handLimit}
        {overLimit && ' — un 7 te ferait défausser'}
      </span>
    </div>
  );

  /** Les annonces en cours, qu'on peut retirer tant que le cycle n'est pas clos. */
  const intentChips = myIntents.length > 0 && (
    <div className="gc-my-intents">
      <span className="gc-my-intents-label">Annonces</span>
      {myIntents.map((declared) => (
        <button
          key={declared.id}
          className="gc-action gc-action-mini gc-action-quiet"
          onClick={() => send('CANCEL_BUILD', { intentId: declared.id })}
          title="Retirer l'annonce et récupérer les ressources"
        >
          {declared.contested ? 'contestée' : 'en attente'} ✕
        </button>
      ))}
    </div>
  );

  const buildButtons = (
    <>
      {/*
        * Route, colonie et ville sont les trois seules constructions que le
        * moteur sait résoudre en annonce (contrat §3) — d'où le verbe ici et
        * nulle part ailleurs. Les trois sont féminines, ce qui laisse une
        * seule tournure à écrire.
        */}
      <Build label={annonce ? 'Annoncer une route' : 'Route'} kind="road"
             count={priv.spots.roads.length} annonce={annonce}
             active={intent} setActive={chooseIntent} enabled={canBuildNow} priced={compact} />
      <Build label={annonce ? 'Annoncer une colonie' : 'Colonie'} kind="settlement"
             count={priv.spots.settlements.length} annonce={annonce}
             active={intent} setActive={chooseIntent} enabled={canBuildNow} priced={compact} />
      <Build label={annonce ? 'Annoncer une ville' : 'Ville'} kind="city"
             count={priv.spots.cities.length} annonce={annonce}
             active={intent} setActive={chooseIntent} enabled={canBuildNow} priced={compact} />
      {/* La voie maritime n'apparaît que là où il y a de la mer à longer. */}
      {priv.spots.maritime.length > 0 && (
        <Build label="Voie maritime" kind="maritime" count={priv.spots.maritime.length}
               active={intent} setActive={chooseIntent} enabled={caps.has('CAN_BUILD')} priced={compact} />
      )}
      {/* Rareté oblige : on ne montre la métropole que s'il en reste une. */}
      {priv.spots.metropolises.length > 0 && (
        <Build label="Métropole" kind="metropolis" count={priv.spots.metropolises.length}
               active={intent} setActive={chooseIntent} enabled={caps.has('CAN_BUILD')} priced={compact} />
      )}
      {priv.spots.monuments.length > 0 && (
        <Build label="Monument" kind="monument" count={priv.spots.monuments.length}
               active={intent} setActive={chooseIntent} enabled={caps.has('CAN_BUILD')} priced={compact} />
      )}
    </>
  );

  const devCards = (inline: boolean) => (
    <DevCards
      priv={priv}
      inline={inline}
      armed={card?.kind}
      onCancel={() => setCard(null)}
      onBoardCard={(request) => { setCard({ kind: request.kind, edges: [] }); setIntent(null); setDrawer(null); }}
      onInvention={(resources) => send('PLAY_INVENTION', { resources })}
      onMonopoly={(resource) => send('PLAY_MONOPOLY', { resource })}
    />
  );

  const buyCard = (
    <Action label="Carte dév." hint="devCard" priced={compact}
            enabled={caps.has('CAN_BUY_DEV_CARD')} onClick={() => send('BUY_DEV_CARD')}
            reason="pas assez de ressources" />
  );

  const tradePanel = (
    <Trade
      pub={pub}
      priv={priv}
      canOffer={caps.has('CAN_TRADE_PLAYER')}
      canBank={caps.has('CAN_TRADE_BANK')}
      onOffer={(giveCounts, receive, to) =>
        send('CREATE_TRADE', { give: giveCounts, receive, ...(to ? { to } : {}) })}
      onAccept={(offerId) => send('ACCEPT_TRADE', { offerId })}
      onCancel={(offerId) => send('CANCEL_TRADE', { offerId })}
      onBank={(giveCounts, receive) => send('TRADE_WITH_BANK', { give: giveCounts, receive })}
      onPort={(port, giveCounts, receive) =>
        send('TRADE_AT_PORT', { port, give: giveCounts, receive })}
    />
  );

  const overlays = (
    <>
      {market && (
        <Market
          view={pub}
          priv={priv}
          onAccept={(offerId) => { send('ACCEPT_TRADE', { offerId }); setMarket(false); }}
          onCancel={(offerId) => send('CANCEL_TRADE', { offerId })}
          onClose={() => setMarket(false)}
        />
      )}

      {pub.winner && <GameOver view={pub} me={priv.id} />}

      {/* Bloquant, et avant tout le reste : le choix oriente la partie. */}
      {!pub.winner && priv.chosenObjective === undefined && priv.offeredObjectives.length > 0 && (
        <ObjectiveChoice
          priv={priv}
          onChoose={(objective) => send('CHOOSE_OBJECTIVE', { objective })}
        />
      )}

      {/*
        * La défausse recouvre l'écran, et c'est un sept qui l'ouvre : la
        * montrer avant que les dés se posent, ce serait annoncer le résultat
        * par la sanction. Elle attend donc la fin du roulement — le moteur,
        * lui, a déjà tout enregistré.
        */}
      {priv.mustDiscard > 0 && !jetEnCours && (
        <Discard pub={pub} priv={priv} onDiscard={(resources) => send('DISCARD', { resources })} />
      )}

      {robbing && (
        <div className="gc-modal-backdrop">
          <div className="gc-modal">
            <header className="gc-modal-head">
              <span className="gc-modal-title">Qui dépouilles-tu ?</span>
            </header>
            <p className="gc-modal-hint">
              Une carte au hasard, prise dans la main de la victime.
            </p>
            <div className="gc-victims">
              {robbing.victims.map((victim) => {
                const target = pub.players.find((p) => p.id === victim);
                return (
                  <button
                    key={victim}
                    className="gc-action gc-action-quiet"
                    onClick={() => moveRobber(robbing.hex, victim)}
                  >
                    <span className="gc-chip" style={{ background: colorOf(victim, order) }} />
                    {target?.name ?? victim}
                    <small>{target?.handSize ?? 0} cartes</small>
                  </button>
                );
              })}
            </div>
            {/* Renoncer reste possible : mieux vaut un voleur bien placé sans
                vol qu'un joueur bloqué qui n'ose pas cliquer. */}
            <div className="gc-modal-actions">
              <button className="gc-action gc-action-quiet" onClick={() => moveRobber(robbing.hex)}>
                Ne voler personne
              </button>
            </div>
          </div>
        </div>
      )}

      {notice && <div className="gc-notice">{notice}</div>}
    </>
  );

  /*
   * Les bandeaux d'accompagnement d'une carte en cours.
   *
   * Ils disent l'étape suivante, et sur téléphone ils flottent au-dessus de
   * la barre du bas : une carte armée sans consigne visible est la première
   * cause de clics perdus sur le plateau.
   */
  const cardBanner = (
    <>
      {roadCard && (
        <div className="gc-card-progress">
          <span>
            {roadCard.edges.length === 0
              ? 'Construction de routes : choisis ta première route.'
              : 'Choisis la seconde, ou pose-en une seule.'}
          </span>
          {roadCard.edges[0] !== undefined && (
            <button
              className="gc-action gc-action-mini"
              onClick={() => { send('PLAY_ROAD_BUILDING', { edges: roadCard.edges }); setCard(null); }}
            >
              Une seule suffit
            </button>
          )}
          <button className="gc-action gc-action-mini gc-action-quiet" onClick={() => setCard(null)}>
            Annuler
          </button>
        </div>
      )}

      {freeBuilding && (
        <div className="gc-card-progress">
          <span>Bâtisseur : choisis ce que tu construis, puis l'emplacement.</span>
          <button className="gc-action gc-action-mini gc-action-quiet" onClick={() => setCard(null)}>
            Annuler
          </button>
        </div>
      )}
    </>
  );

  /* ── téléphone ────────────────────────────────────────────────────── */

  if (compact) {
    /*
     * L'action qui fait avancer la partie, et elle seule, sous le pouce.
     *
     * Les jeux de plateau mobiles ne montrent jamais neuf boutons de même
     * poids : ils en montrent un, gros, à droite — celui qu'on cherche neuf
     * fois sur dix — et rangent le reste derrière des onglets. L'ordre suit
     * celui du tour, si bien qu'un seul est jamais disponible à la fois.
     */
    const primary = caps.has('CAN_ROLL_DICE')
      ? { label: 'Lancer les dés', hint: 'roll', run: () => send('ROLL_DICE') }
      : caps.has('CAN_END_TURN')
        ? { label: 'Fin d’action', hint: 'endTurn', run: () => send('END_TURN') }
        : caps.has('CAN_END_CYCLE')
          ? { label: 'Fin de cycle', hint: 'endCycle', run: () => send('END_CYCLE') }
          : undefined;

    /*
     * Ce que le plateau attend, quand il attend quelque chose.
     *
     * Un type armé n'a d'effet qu'au toucher suivant, ailleurs : sans cette
     * ligne, le joueur voit son bouton s'allumer, le tiroir se fermer, et
     * plus rien — il rappuie, et désarme ce qu'il venait d'armer.
     */
    const armed = knightArmed
      ? { text: 'Chevalier : touche l’hexagone où poser le voleur.', undo: () => setCard(null) }
      : setupIntent !== null
        ? { text: `Mise en place : pose ta ${BUILD_LABELS[setupIntent] ?? 'pièce'} sur le plateau.` }
        : intent !== null
          ? {
            text: annonce
              ? `Touche l’emplacement à réserver — ${BUILD_LABELS[intent] ?? intent} annoncée.`
              : `Touche l’emplacement — ${BUILD_LABELS[intent] ?? intent}.`,
            undo: () => setIntent(null),
          }
          : caps.has('CAN_MOVE_ROBBER')
            ? { text: 'Touche l’hexagone où poser le voleur.' }
            : undefined;

    const sheet = drawer === null ? undefined
      : drawer === 'build' ? (
        <>
          {!canBuildNow && (
            <p className="gc-sheet-idle">
              Tu ne peux rien poser pour l’instant. Dès que la fenêtre s’ouvre, les
              boutons proposeront d’annoncer une construction pour la fin du cycle.
            </p>
          )}
          <div className="gc-sheet-grid">{buildButtons}</div>
          {intentChips}
        </>
      ) : drawer === 'trade' ? tradePanel
      : drawer === 'cards' ? (
        <>
          {devCards(true)}
          <div className="gc-sheet-grid">{buyCard}</div>
        </>
      ) : drawer === 'journal' ? (
        <Journal view={pub} entries={journal} />
      ) : playerList;

    return (
      <div className="gc-app gc-compact">
        {/* Le plateau occupe l'écran entier ; tout le reste flotte dessus. */}
        <main className="gc-board-wrap">{board}</main>

        <header className="gc-hud">
          <div className="gc-timer">{formatTimer(timer?.remainingMs)}</div>
          <div className="gc-hud-text">
            <div className="gc-phase">
              Cycle {pub.cycle} · {phaseLabel(pub.phase)}
              {status !== 'open' && ` · ${status === 'reconnecting' ? 'reconnexion…' : status}`}
            </div>
            <div className="gc-sentence">{orderSentence(pub, priv)}</div>
          </div>
          {roll && <Dice a={roll.a} b={roll.b} total={roll.total} />}
        </header>

        {/*
          * La table, réduite à ce qu'on en consulte en jouant : qui est actif,
          * qui mène, qui a trop de cartes. Le détail est à un doigt de là.
          */}
        <aside className="gc-rail">
          {pub.players.map((player) => (
            <button
              key={player.id}
              className={[
                'gc-rail-player',
                player.role === 'active' ? 'is-active' : '',
                player.role === 'paired' ? 'is-paired' : '',
                player.connected ? '' : 'is-away',
                player.id === priv.id ? 'is-me' : '',
              ].join(' ')}
              onClick={() => setDrawer('players')}
              title={`${player.name} — ${player.publicPoints} PV, ${player.handSize} cartes`}
            >
              <span className="gc-chip" style={{ background: colorOf(player.id, order) }} />
              <span className="gc-rail-name">{player.name}</span>
              {player.mustDiscard > 0
                ? <span className="gc-warn">⚠</span>
                : <span className="gc-rail-pv">{player.publicPoints}</span>}
            </button>
          ))}
        </aside>

        <Gains vols={vols} />

        {(armed || roadCard || freeBuilding) && (
          <div className="gc-armed">
            {armed && (
              <>
                <span className="gc-armed-text">{armed.text}</span>
                {armed.undo && (
                  <button className="gc-action gc-action-mini gc-action-quiet" onClick={armed.undo}>
                    Annuler
                  </button>
                )}
              </>
            )}
            {cardBanner}
          </div>
        )}

        <footer className="gc-dock">
          {hand}
          <nav className="gc-tabs">
            <Tab label="Bâtir" drawer="build" open={drawer} onOpen={setDrawer}
                 badge={canBuildNow ? spotCount : undefined} lit={intent !== null} />
            <Tab label="Commerce" drawer="trade" open={drawer} onOpen={setDrawer}
                 badge={pub.offers.length || undefined}
                 lit={caps.has('CAN_TRADE_PLAYER') || caps.has('CAN_TRADE_BANK')} />
            <Tab label="Cartes" drawer="cards" open={drawer} onOpen={setDrawer}
                 badge={cardCount || undefined} lit={card !== null} />
            <Tab label="Journal" drawer="journal" open={drawer} onOpen={setDrawer} />
          </nav>
          {/* Toujours là, jamais ailleurs : le pouce le retrouve sans regarder. */}
          <button
            className="gc-primary"
            disabled={primary === undefined}
            onClick={() => primary?.run()}
          >
            {primary?.label ?? 'En attente'}
          </button>
        </footer>

        {drawer !== null && (
          <>
            <div className="gc-sheet-veil" onClick={() => setDrawer(null)} />
            <section className="gc-sheet" role="dialog" aria-label={DRAWER_TITLES[drawer]}>
              <header className="gc-sheet-head">
                <span className="gc-sheet-title">{DRAWER_TITLES[drawer]}</span>
                {/*
                  * Le marché s'ouvre depuis l'en-tête, pas depuis le corps.
                  *
                  * Placé sous le formulaire, il passait sous le bord du
                  * panneau dès que les trois menus étaient affichés : il
                  * fallait deviner qu'on pouvait faire défiler pour l'avoir.
                  */}
                {drawer === 'trade' && (
                  <button
                    className="gc-sheet-act"
                    onClick={() => { setMarket(true); setDrawer(null); }}
                  >
                    Marché
                    {pub.offers.length > 0 && <span className="gc-tab-badge">{pub.offers.length}</span>}
                  </button>
                )}
                <button className="gc-sheet-close" onClick={() => setDrawer(null)} aria-label="Fermer">
                  ✕
                </button>
              </header>
              <div className="gc-sheet-body">{sheet}</div>
            </section>
          </>
        )}

        {overlays}
      </div>
    );
  }

  /* ── grand écran ──────────────────────────────────────────────────── */

  return (
    <div className="gc-app">
      <header className="gc-order">
        <div className="gc-timer">{formatTimer(timer?.remainingMs)}</div>
        <div className="gc-order-text">
          <div className="gc-phase">
            Cycle {pub.cycle} · {phaseLabel(pub.phase)}
          </div>
          <div className="gc-sentence">{orderSentence(pub, priv)}</div>
          <div className="gc-who">
            Actif : {nameOf(pub, pub.activePlayer)} · Associé : {nameOf(pub, pub.pairedPlayer)}
            {status !== 'open' && ` · ${status === 'reconnecting' ? 'reconnexion…' : status}`}
          </div>
        </div>
        {roll && <Dice a={roll.a} b={roll.b} total={roll.total} />}
      </header>

      <div className="gc-main">
        {playerList}

        {/*
          * Le commerce garde sa colonne en permanence, même quand on ne peut
          * rien y faire. Le faire apparaître et disparaître décalait le
          * journal et recentrait le plateau à chaque changement de phase, et
          * une interface qui bouge sous le doigt se lit mal.
          */}
        <div className="gc-side">
          {tradePanel}
          <Journal view={pub} entries={journal} />
        </div>

        <main className="gc-board-wrap">{board}</main>
      </div>

      <Gains vols={vols} />

      <footer className="gc-footer">
        {hand}
        {intentChips}
        {cardBanner}

        <div className="gc-actions">
          {buildButtons}
          {devCards(false)}
          <Hint text={HINTS['market']?.text ?? ''} note={HINTS['market']?.note ?? ''}>
            <button className="gc-action gc-action-quiet" onClick={() => setMarket(true)}>
              Marché
              <small>{pub.offers.length} offre{pub.offers.length > 1 ? 's' : ''}</small>
            </button>
          </Hint>
          <Action label="Lancer les dés" hint="roll"
                  enabled={caps.has('CAN_ROLL_DICE')} onClick={() => send('ROLL_DICE')} />
          {buyCard}
          <Action label="Fin d'action" hint="endTurn"
                  enabled={caps.has('CAN_END_TURN')} onClick={() => send('END_TURN')} />
          <Action label="Fin de cycle" hint="endCycle"
                  enabled={caps.has('CAN_END_CYCLE')} onClick={() => send('END_CYCLE')} />
        </div>
      </footer>

      {overlays}
    </div>
  );
}

/**
 * Un onglet de la barre du bas.
 *
 * La pastille porte le nombre qui décide d'y aller — emplacements ouverts,
 * offres sur la table, cartes en main. Sans elle, il faudrait ouvrir chaque
 * tiroir à chaque tour pour savoir s'il a quelque chose à dire.
 */
function Tab({ label, drawer, open, onOpen, badge, lit = false }: {
  label: string;
  drawer: Exclude<Drawer, null>;
  open: Drawer;
  onOpen: (drawer: Drawer) => void;
  badge?: number | undefined;
  lit?: boolean;
}) {
  return (
    <button
      className={`gc-tab${open === drawer ? ' is-open' : ''}${lit ? ' is-lit' : ''}`}
      onClick={() => onOpen(open === drawer ? null : drawer)}
    >
      {label}
      {badge !== undefined && badge > 0 && <span className="gc-tab-badge">{badge}</span>}
    </button>
  );
}

/** Saisie du nom, avant la première connexion. */
function NameEntry({ onChoose }: { onChoose: (name: string) => void }) {
  const [value, setValue] = useState('');
  const ready = value.trim().length > 0;

  return (
    <div className="gc-splash">
      <h1>Grandes Colonies</h1>
      <form
        className="gc-join"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) onChoose(value.trim().slice(0, 18));
        }}
      >
        <label htmlFor="gc-name">Ton nom</label>
        <input
          id="gc-name"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Pierre"
          maxLength={18}
          autoFocus
        />
        <button className="gc-action" type="submit" disabled={!ready}>Rejoindre</button>
      </form>
    </div>
  );
}

/**
 * Bouton de construction : il bascule le plateau en mode « choisis un
 * emplacement » plutôt que d'agir aussitôt.
 *
 * Le nombre d'emplacements disponibles est affiché : un joueur qui a les
 * ressources mais aucun endroit où bâtir doit le comprendre sans essayer.
 */
function Build({ label, kind, count, active, setActive, enabled, annonce = false, priced = false }: {
  label: string;
  kind: Exclude<BuildKind, null>;
  count: number;
  active: BuildKind;
  setActive: (kind: BuildKind) => void;
  enabled: boolean;
  /** Le clic annoncera au lieu de bâtir : le bouton doit le dire lui-même. */
  annonce?: boolean;
  /** Le prix écrit sur le bouton, au lieu d'une infobulle au survol. */
  priced?: boolean;
}) {
  const usable = enabled && count > 0;
  const hint = HINTS[kind];
  const button = (
    <button
      className={`gc-action${active === kind ? ' is-armed' : ''}${annonce ? ' gc-action-quiet' : ''}`}
      disabled={!usable}
      onClick={() => setActive(active === kind ? null : kind)}
    >
      {label}
      {priced && hint?.cost && <CostLine cost={COSTS[hint.cost]} className="gc-action-cost" />}
      {enabled && count === 0 && <small>aucun emplacement</small>}
      {usable && (
        <small>
          {count} emplacement{count > 1 ? 's' : ''}{annonce ? ' · fin de cycle' : ''}
        </small>
      )}
    </button>
  );

  /*
   * Sur téléphone, pas d'infobulle.
   *
   * Elle s'ouvre au survol, geste qui n'existe pas au doigt ; le toucher qui
   * la déclenchait était le même que celui qui arme le bouton, si bien
   * qu'elle apparaissait pour disparaître aussitôt — après avoir recouvert
   * les boutons voisins et débordé du panneau, qui défile et donc rogne.
   * Le prix vaut mieux dit sur le bouton, où il reste.
   */
  if (priced) return button;

  // Hors de son tour, c'est la mécanique de l'annonce qu'il faut expliquer,
  // pas celle de la construction : le geste est le même, la conséquence non.
  const aide = annonce ? HINTS['declare'] : hint;

  return (
    <Hint text={aide?.text ?? ''} {...(aide?.cost ? { cost: aide.cost } : {})}
          {...(aide?.note ? { note: aide.note } : {})}>
      {button}
    </Hint>
  );
}

/** Un bouton qui dit pourquoi il est grisé — exigence du brief d'interface. */
function Action({ label, enabled, onClick, reason, hint, priced = false }: {
  label: string; enabled: boolean; onClick: () => void;
  reason?: string; hint?: string; priced?: boolean;
}) {
  const help = hint === undefined ? undefined : HINTS[hint];
  const button = (
    <button className="gc-action" disabled={!enabled} onClick={onClick}>
      {label}
      {priced && help?.cost && <CostLine cost={COSTS[help.cost]} className="gc-action-cost" />}
      {!enabled && reason && <small>{reason}</small>}
    </button>
  );

  if (priced) return button;

  return (
    <Hint text={help?.text ?? ''} {...(help?.cost ? { cost: help.cost } : {})}
          {...(help?.note ? { note: help.note } : {})}>
      {button}
    </Hint>
  );
}

function nameOf(view: PublicGameView, id: string | undefined): string {
  if (!id) return '—';
  return view.players.find((p) => p.id === id)?.name ?? id;
}

function phaseLabel(phase: PublicGameView['phase']): string {
  switch (phase) {
    case 'setup': return 'Mise en place';
    case 'production': return 'Production';
    case 'activeTurn': return 'Tour';
    case 'freeTrade': return 'Commerce libre';
    case 'ended': return 'Partie terminée';
  }
}
