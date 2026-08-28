/**
 * Commerce.
 *
 * Le game design en fait le cœur du jeu à douze, et la simulation l'a
 * confirmé : les parties raccourcissent de 40 % dès que les joueurs
 * négocient. Mais le contexte change tout — **ils sont dans la même pièce**.
 * La négociation reste donc orale : cette interface ne sert pas à marchander,
 * elle sert à **exécuter vite** un accord déjà conclu à voix haute, pendant
 * une fenêtre de trente secondes.
 *
 * D'où trois partis pris : composer une offre tient en trois gestes, les
 * offres reçues s'empilent sans modale qui interromprait, et une offre
 * devenue caduque le dit au lieu de disparaître sans explication.
 */

import { useState } from 'react';

import type { PrivatePlayerView, PublicGameView } from '@grand-colonies/protocol';

import { ResourceIcon } from './ResourceIcon.jsx';

const CORE = ['wood', 'brick', 'wool', 'grain', 'ore'] as const;
const SHORT: Record<string, string> = {
  wood: 'Bois', brick: 'Brique', wool: 'Laine',
  grain: 'Blé', ore: 'Minerai', gold: 'Or', fish: 'Poisson',
};

export interface TradeProps {
  readonly pub: PublicGameView;
  readonly priv: PrivatePlayerView;
  readonly canOffer: boolean;
  readonly canBank: boolean;
  readonly onOffer: (give: Record<string, number>, receive: Record<string, number>, to?: string) => void;
  readonly onAccept: (offerId: string) => void;
  readonly onCancel: (offerId: string) => void;
  readonly onBank: (give: Record<string, number>, receive: Record<string, number>) => void;
}

export function Trade({ pub, priv, canOffer, canBank, onOffer, onAccept, onCancel, onBank }: TradeProps) {
  const [give, setGive] = useState<string>('wood');
  const [want, setWant] = useState<string>('ore');
  const [target, setTarget] = useState<string>('');

  const hand = priv.hand as Record<string, number>;
  const held = (resource: string): number => hand[resource] ?? 0;
  const bankRate = priv.bankRates[give] ?? 4;

  const mine = pub.offers.filter((o) => o.from === priv.id);
  const incoming = pub.offers.filter(
    (o) => o.from !== priv.id && (o.to === undefined || o.to === priv.id),
  );

  return (
    <aside className="gc-trade">
      <div className="gc-trade-head">Commerce</div>

      <div className="gc-trade-compose">
        <label>
          Je donne
          {/* Une balise `option` n'accepte pas de dessin : l'icône se place
              donc à côté du menu, et suit la ressource choisie. */}
          <span className="gc-trade-pick">
            <ResourceIcon resource={give} size={20} />
          <select value={give} onChange={(e) => setGive(e.target.value)}>
            {CORE.map((r) => (
              <option key={r} value={r}>{SHORT[r]} ({held(r)})</option>
            ))}
          </select>
          </span>
        </label>
        <label>
          Je veux
          <span className="gc-trade-pick">
            <ResourceIcon resource={want} size={20} />
            <select value={want} onChange={(e) => setWant(e.target.value)}>
              {CORE.map((r) => <option key={r} value={r}>{SHORT[r]}</option>)}
            </select>
          </span>
        </label>
        <label>
          À
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">tout le monde</option>
            {pub.players.filter((p) => p.id !== priv.id).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </label>

        <div className="gc-trade-buttons">
          <button
            className="gc-action"
            disabled={!canOffer || give === want || held(give) < 2}
            onClick={() => onOffer({ [give]: 2 }, { [want]: 1 }, target || undefined)}
          >
            Proposer 2 ↔ 1
          </button>
          {/* Le taux bancaire dépend des ports possédés : on l'affiche pour
              qu'un joueur voie l'intérêt d'en occuper un. */}
          <button
            className="gc-action gc-action-quiet"
            disabled={!canBank || give === want || held(give) < bankRate}
            onClick={() => onBank({ [give]: bankRate }, { [want]: 1 })}
          >
            Banque {bankRate}:1
            {bankRate < 4 && <small>port</small>}
          </button>
        </div>
      </div>

      {incoming.length > 0 && (
        <div className="gc-trade-list">
          <div className="gc-trade-sub">Offres reçues ({incoming.length})</div>
          {incoming.map((offer) => {
            const cost = Object.entries(offer.receive as Record<string, number>);
            const affordable = cost.every(([r, n]) => held(r) >= n);
            return (
              <div key={offer.id} className={`gc-offer${affordable ? '' : ' is-stale'}`}>
                <span className="gc-offer-who">{nameOf(pub, offer.from)}</span>
                <span className="gc-offer-terms">
                  {describe(offer.give)} ↔ {describe(offer.receive)}
                </span>
                <button
                  className="gc-action gc-action-mini"
                  disabled={!affordable}
                  onClick={() => onAccept(offer.id)}
                >
                  {affordable ? 'Accepter' : 'Trop cher'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {mine.length > 0 && (
        <div className="gc-trade-list">
          <div className="gc-trade-sub">Mes offres</div>
          {mine.map((offer) => (
            <div key={offer.id} className="gc-offer">
              <span className="gc-offer-terms">
                {describe(offer.give)} ↔ {describe(offer.receive)}
              </span>
              <button className="gc-action gc-action-mini gc-action-quiet" onClick={() => onCancel(offer.id)}>
                Retirer
              </button>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

function describe(counts: Record<string, number> | object): string {
  return Object.entries(counts as Record<string, number>)
    .map(([resource, n]) => `${n} ${SHORT[resource] ?? resource}`)
    .join(' + ');
}

function nameOf(view: PublicGameView, id: string): string {
  return view.players.find((p) => p.id === id)?.name ?? id;
}
