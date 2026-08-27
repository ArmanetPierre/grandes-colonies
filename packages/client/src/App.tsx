/**
 * Écran de jeu.
 *
 * Reprend la structure « bandeau d'ordre » des wireframes : l'état du joueur
 * occupe toute la largeur en haut, parce que la question qui revient sans
 * cesse à douze joueurs est « qu'est-ce que je peux faire, là, maintenant ? ».
 * Le reste de l'écran ne sert qu'à y répondre.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { BoardGraph, parseHexKey } from '@grand-colonies/engine';
import type { PrivatePlayerView, PublicGameView } from '@grand-colonies/protocol';

import {
  type ConnectionStatus,
  type Rejection,
  type SeatInfo,
  type TimerInfo,
  GameConnection,
  newActionId,
} from './net/connection.js';
import { Board, colorOf } from './ui/Board.jsx';
import { type CardRequest, DevCards } from './ui/DevCards.jsx';
import { Discard } from './ui/Discard.jsx';
import { GameOver } from './ui/GameOver.jsx';
import { Lobby } from './ui/Lobby.jsx';
import { ObjectiveChoice } from './ui/ObjectiveChoice.jsx';
import { Trade } from './ui/Trade.jsx';

const RESOURCE_LABELS: Record<string, string> = {
  wood: 'Bois', brick: 'Brique', wool: 'Laine',
  grain: 'Blé', ore: 'Minerai', gold: 'Or', fish: 'Poisson',
};

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

const NAME_KEY = 'grand-colonies:name';

export function App({ url = `ws://${location.hostname}:2567` }: { url?: string }) {
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
   * Ce que le joueur s'apprête à poser. Rien n'est cliquable tant qu'il n'a
   * pas choisi : sur un plateau de cinquante tuiles, afficher tous les
   * emplacements de tous les types en même temps serait illisible.
   */
  const [intent, setIntent] = useState<'settlement' | 'city' | 'road' | null>(null);
  /**
   * Annoncer plutôt que construire.
   *
   * C'est le même geste — choisir un type, puis un emplacement — mais
   * l'annonce réserve les ressources et attend la fin du cycle. Un
   * interrupteur explicite évite qu'on annonce en croyant construire.
   */
  const [declaring, setDeclaring] = useState(false);
  /**
   * La carte développement armée, et ce qu'elle a déjà collecté.
   *
   * Trois des cinq cartes se jouent sur le plateau, avec le même geste que la
   * construction. Les tenir dans un état à part évite de confondre « je pose
   * une route » et « je joue Construction de routes », qui ne coûtent pas la
   * même chose.
   */
  const [card, setCard] = useState<{ kind: CardRequest['kind']; edges: string[] } | null>(null);
  const connection = useRef<GameConnection | undefined>(undefined);

  useEffect(() => {
    if (name === null) return undefined;
    const conn = new GameConnection({ url, name }, {
      onStatus: setStatus,
      onSeat: setSeat,
      onPublic: setPub,
      onPrivate: setPriv,
      onTimer: setTimer,
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

  // Pendant la mise en place, le jeu impose la suite : colonie puis route.
  // Inutile de demander au joueur de choisir ce qu'il sait déjà.
  const freeBuilding = card?.kind === 'freeBuild';
  const canPick = caps.has('CAN_BUILD') || freeBuilding
    || (declaring && caps.has('CAN_DECLARE_BUILD'));
  const setupIntent: typeof intent = caps.has('CAN_PLACE_SETUP')
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
    : [];
  const shownEdges = roadCard
    ? (roadCard.edges[0] === undefined ? priv?.spots.roads : secondRoadSpots(roadCard.edges[0]))
    : knightArmed ? []
    : picking && active === 'road' ? priv?.spots.roads
    : [];

  const place = useCallback((kind: typeof intent, target: string) => {
    if (!kind || !pub) return;
    const setup = pub.phase === 'setup';

    if (card?.kind === 'freeBuild' && !setup) {
      // La carte offre la combinaison de ressources : mêmes règles de
      // placement, aucun paiement.
      send('PLAY_FREE_BUILD', {
        target: kind === 'road' ? { kind: 'road', edge: target } : { kind, vertex: target },
      });
      setCard(null);
    } else if (declaring && !setup) {
      // L'annonce vise un emplacement sans le prendre : les ressources sont
      // réservées, la résolution aura lieu en fin de cycle.
      send('DECLARE_BUILD', {
        target: kind === 'road' ? { kind: 'road', edge: target } : { kind, vertex: target },
      });
    } else if (kind === 'road') {
      send(setup ? 'PLACE_SETUP_ROAD' : 'BUILD_ROAD', { edge: target });
    } else if (kind === 'settlement') {
      send(setup ? 'PLACE_SETUP_SETTLEMENT' : 'BUILD_SETTLEMENT', { vertex: target });
    } else {
      send('BUILD_CITY', { vertex: target });
    }
    setIntent(null);
  }, [pub, send, declaring, card]);

  /** Construction de routes : deux clics, ou un seul si le joueur s'arrête. */
  const pickRoad = (edge: string): void => {
    if (card?.kind !== 'roadBuilding') return;
    const edges = [...card.edges, edge];
    if (edges.length < 2) { setCard({ ...card, edges }); return; }
    send('PLAY_ROAD_BUILDING', { edges });
    setCard(null);
  };

  const clickHex = (hex: string): void => {
    if (card?.kind === 'knight') {
      send('PLAY_KNIGHT', { to: hex });
      setCard(null);
      return;
    }
    send('MOVE_ROBBER', { to: hex });
  };

  if (name === null) return <NameEntry onChoose={(chosen) => {
    localStorage.setItem(NAME_KEY, chosen);
    setName(chosen);
  }} />;

  if (!pub || !priv || !seat) {
    return (
      <div className="gc-splash">
        <h1>Grand Colonies</h1>
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
        {pub.lastRoll && (
          <div className="gc-roll" title="Dernier lancer">
            {pub.lastRoll.a} + {pub.lastRoll.b} = <strong>{pub.lastRoll.total}</strong>
          </div>
        )}
      </header>

      <div className="gc-main">
        <aside className="gc-players">
          {pub.players.map((player) => (
            <div
              key={player.id}
              className={[
                'gc-player',
                player.role === 'active' ? 'is-active' : '',
                player.role === 'paired' ? 'is-paired' : '',
                player.connected ? '' : 'is-away',
              ].join(' ')}
            >
              <span className="gc-chip" style={{ background: colorOf(player.id, order) }} />
              <span className="gc-name">{player.name}</span>
              {player.role !== 'idle' && (
                <span className="gc-role">{player.role === 'active' ? 'Actif' : 'Associé'}</span>
              )}
              <span className="gc-stat">{player.publicPoints} PV · {player.handSize} c.</span>
              {player.mustDiscard > 0 && <span className="gc-warn" title="Doit défausser">⚠</span>}
            </div>
          ))}
        </aside>

        {(caps.has('CAN_TRADE_PLAYER') || caps.has('CAN_TRADE_BANK')) && (
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
          />
        )}

        <main className="gc-board-wrap">
          <Board
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
        </main>
      </div>

      <footer className="gc-footer">
        <div className="gc-hand">
          {Object.entries(priv.hand).map(([resource, count]) => (
            <span key={resource} className="gc-res" title={RESOURCE_LABELS[resource] ?? resource}>
              {RESOURCE_LABELS[resource] ?? resource} <strong>{count}</strong>
            </span>
          ))}
          <span className={`gc-limit${overLimit ? ' is-over' : ''}`}>
            {me?.handSize ?? 0} / {pub.handLimit}
            {overLimit && ' — un 7 te ferait défausser'}
          </span>
        </div>

        {myIntents.length > 0 && (
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
        )}

        <DevCards
          priv={priv}
          armed={card?.kind}
          onCancel={() => setCard(null)}
          onBoardCard={(request) => { setCard({ kind: request.kind, edges: [] }); setIntent(null); }}
          onInvention={(resources) => send('PLAY_INVENTION', { resources })}
          onMonopoly={(resource) => send('PLAY_MONOPOLY', { resource })}
        />

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

        <div className="gc-actions">
          <Build label="Route" kind="road" count={priv.spots.roads.length}
                 active={intent} setActive={setIntent}
                 enabled={caps.has('CAN_BUILD') || freeBuilding || (declaring && caps.has('CAN_DECLARE_BUILD'))} />
          <Build label="Colonie" kind="settlement" count={priv.spots.settlements.length}
                 active={intent} setActive={setIntent}
                 enabled={caps.has('CAN_BUILD') || freeBuilding || (declaring && caps.has('CAN_DECLARE_BUILD'))} />
          <Build label="Ville" kind="city" count={priv.spots.cities.length}
                 active={intent} setActive={setIntent}
                 enabled={caps.has('CAN_BUILD') || freeBuilding || (declaring && caps.has('CAN_DECLARE_BUILD'))} />
          {caps.has('CAN_DECLARE_BUILD') && !caps.has('CAN_BUILD') && (
            <button
              className={`gc-action gc-action-quiet${declaring ? ' is-armed' : ''}`}
              onClick={() => { setDeclaring((on) => !on); setIntent(null); }}
            >
              {declaring ? 'Annonce armée' : 'Annoncer'}
              <small>{declaring ? 'choisis un emplacement' : 'hors de ton tour'}</small>
            </button>
          )}
          <Action label="Lancer les dés" enabled={caps.has('CAN_ROLL_DICE')} onClick={() => send('ROLL_DICE')} />
          <Action label="Carte dév." enabled={caps.has('CAN_BUY_DEV_CARD')} onClick={() => send('BUY_DEV_CARD')}
                  reason="pas assez de ressources" />
          <Action label="Fin d'action" enabled={caps.has('CAN_END_TURN')} onClick={() => send('END_TURN')} />
          <Action label="Fin de cycle" enabled={caps.has('CAN_END_CYCLE')} onClick={() => send('END_CYCLE')} />
        </div>
      </footer>

      {pub.winner && <GameOver view={pub} me={priv.id} />}

      {/* Bloquant, et avant tout le reste : le choix oriente la partie. */}
      {!pub.winner && priv.chosenObjective === undefined && priv.offeredObjectives.length > 0 && (
        <ObjectiveChoice
          priv={priv}
          onChoose={(objective) => send('CHOOSE_OBJECTIVE', { objective })}
        />
      )}

      {priv.mustDiscard > 0 && (
        <Discard pub={pub} priv={priv} onDiscard={(resources) => send('DISCARD', { resources })} />
      )}

      {notice && <div className="gc-notice">{notice}</div>}
    </div>
  );
}

/** Saisie du nom, avant la première connexion. */
function NameEntry({ onChoose }: { onChoose: (name: string) => void }) {
  const [value, setValue] = useState('');
  const ready = value.trim().length > 0;

  return (
    <div className="gc-splash">
      <h1>Grand Colonies</h1>
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
function Build({ label, kind, count, active, setActive, enabled }: {
  label: string;
  kind: 'settlement' | 'city' | 'road';
  count: number;
  active: 'settlement' | 'city' | 'road' | null;
  setActive: (kind: 'settlement' | 'city' | 'road' | null) => void;
  enabled: boolean;
}) {
  const usable = enabled && count > 0;
  return (
    <button
      className={`gc-action${active === kind ? ' is-armed' : ''}`}
      disabled={!usable}
      onClick={() => setActive(active === kind ? null : kind)}
    >
      {label}
      {enabled && count === 0 && <small>aucun emplacement</small>}
      {usable && <small>{count} emplacement{count > 1 ? 's' : ''}</small>}
    </button>
  );
}

/** Un bouton qui dit pourquoi il est grisé — exigence du brief d'interface. */
function Action({ label, enabled, onClick, reason }: {
  label: string; enabled: boolean; onClick: () => void; reason?: string;
}) {
  return (
    <button className="gc-action" disabled={!enabled} onClick={onClick}>
      {label}
      {!enabled && reason && <small>{reason}</small>}
    </button>
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
