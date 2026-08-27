/**
 * Écran de jeu.
 *
 * Reprend la structure « bandeau d'ordre » des wireframes : l'état du joueur
 * occupe toute la largeur en haut, parce que la question qui revient sans
 * cesse à douze joueurs est « qu'est-ce que je peux faire, là, maintenant ? ».
 * Le reste de l'écran ne sert qu'à y répondre.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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

export function App({ url = `ws://${location.hostname}:2567` }: { url?: string }) {
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [seat, setSeat] = useState<SeatInfo>();
  const [pub, setPub] = useState<PublicGameView>();
  const [priv, setPriv] = useState<PrivatePlayerView>();
  const [timer, setTimer] = useState<TimerInfo>();
  const [notice, setNotice] = useState<string>();
  const connection = useRef<GameConnection | undefined>(undefined);

  useEffect(() => {
    const conn = new GameConnection({ url }, {
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
  }, [url]);

  const send = useCallback((type: string, extra: Record<string, unknown> = {}) => {
    connection.current?.send({ actionId: newActionId(), type, ...extra });
  }, []);

  const caps = useMemo(() => new Set(priv?.capabilities ?? []), [priv]);
  const order = useMemo(() => pub?.players.map((p) => p.id) ?? [], [pub]);

  if (!pub || !priv || !seat) {
    return (
      <div className="gc-splash">
        <h1>Grand Colonies</h1>
        <p>{status === 'full' ? 'La partie est complète.' : 'Connexion au serveur…'}</p>
      </div>
    );
  }

  const me = pub.players.find((p) => p.id === priv.id);
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

        <main className="gc-board-wrap">
          <Board view={pub} />
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

        <div className="gc-actions">
          <Action label="Lancer les dés" enabled={caps.has('CAN_ROLL_DICE')} onClick={() => send('ROLL_DICE')} />
          <Action label="Carte dév." enabled={caps.has('CAN_BUY_DEV_CARD')} onClick={() => send('BUY_DEV_CARD')}
                  reason="pas assez de ressources" />
          <Action label="Fin d'action" enabled={caps.has('CAN_END_TURN')} onClick={() => send('END_TURN')} />
          <Action label="Fin de cycle" enabled={caps.has('CAN_END_CYCLE')} onClick={() => send('END_CYCLE')} />
        </div>
      </footer>

      {notice && <div className="gc-notice">{notice}</div>}
    </div>
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
