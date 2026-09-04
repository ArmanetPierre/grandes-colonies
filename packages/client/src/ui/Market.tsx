/**
 * Le marché : toutes les offres de la table, d'un seul coup d'œil.
 *
 * Le panneau de commerce ne montre que ce qui concerne le joueur — ses
 * propres offres et celles qui lui sont adressées. À douze, cela cache
 * l'essentiel : savoir que trois joueurs réclament du minerai vaut mieux que
 * de l'apprendre en proposant le sien au premier venu.
 *
 * Les offres sont publiques par nature — elles passent déjà dans la vue
 * publique — donc rien ne fuit ici qui ne soit déjà connu de tous.
 */

import type { PublicGameView, PublicOffer, PrivatePlayerView } from '@grandes-colonies/protocol';

import { colorOf } from './Board.jsx';
import { ResourceIcon } from './ResourceIcon.jsx';

/** Une liste de ressources, en pictogrammes plutôt qu'en mots. */
function Counts({ counts }: { counts: object }) {
  const entries = Object.entries(counts as Record<string, number>).filter(([, n]) => n > 0);
  if (entries.length === 0) return <span className="gc-market-none">rien</span>;

  return (
    <span className="gc-market-counts">
      {entries.map(([resource, n]) => (
        <span key={resource} className="gc-market-count">
          <ResourceIcon resource={resource} size={16} />
          {n}
        </span>
      ))}
    </span>
  );
}

export interface MarketProps {
  readonly view: PublicGameView;
  readonly priv: PrivatePlayerView;
  readonly onAccept: (offerId: string) => void;
  readonly onCancel: (offerId: string) => void;
  readonly onClose: () => void;
}

export function Market({ view, priv, onAccept, onCancel, onClose }: MarketProps) {
  const nameOf = (id: string): string => view.players.find((p) => p.id === id)?.name ?? id;
  const order = view.players.map((p) => p.id);
  const acceptable = new Set(priv.acceptableOffers);
  const hand = priv.hand as Record<string, number>;

  /** Peut-on payer ce que l'offre réclame ? */
  const affordable = (offer: PublicOffer): boolean =>
    Object.entries(offer.receive as Record<string, number>)
      .every(([resource, n]) => (hand[resource] ?? 0) >= n);

  return (
    <div className="gc-modal-backdrop" onClick={onClose}>
      <div className="gc-modal gc-modal-wide" onClick={(e) => e.stopPropagation()}>
        <header className="gc-modal-head">
          <span className="gc-modal-title">Le marché</span>
          <span className="gc-modal-count">
            {view.offers.length} offre{view.offers.length > 1 ? 's' : ''}
          </span>
        </header>
        <p className="gc-modal-hint">
          Toutes les offres en cours, y compris celles qui ne te sont pas adressées.
          Elles disparaissent à la fin du cycle.
        </p>

        {view.offers.length === 0 ? (
          <p className="gc-market-empty">Personne ne propose rien pour l'instant.</p>
        ) : (
          <ul className="gc-market-list">
            {view.offers.map((offer) => {
              const mine = offer.from === priv.id;
              const open = acceptable.has(offer.id);
              return (
                <li key={offer.id} className={`gc-market-row${mine ? ' is-mine' : ''}`}>
                  <span className="gc-market-who">
                    <span className="gc-chip" style={{ background: colorOf(offer.from, order) }} />
                    {mine ? 'Toi' : nameOf(offer.from)}
                  </span>

                  <span className="gc-market-terms">
                    <Counts counts={offer.give} />
                    <span className="gc-market-arrow">↔</span>
                    <Counts counts={offer.receive} />
                  </span>

                  {/* Une offre nominative n'intéresse que son destinataire :
                      le dire évite de croire qu'on pourrait la prendre. */}
                  <span className="gc-market-target">
                    {offer.to === undefined
                      ? 'à tout le monde'
                      : `à ${offer.to === priv.id ? 'toi' : nameOf(offer.to)}`}
                  </span>

                  <span className="gc-market-action">
                    {mine ? (
                      <button className="gc-action gc-action-mini gc-action-quiet"
                              onClick={() => onCancel(offer.id)}>
                        Retirer
                      </button>
                    ) : open ? (
                      <button className="gc-action gc-action-mini"
                              disabled={!affordable(offer)}
                              onClick={() => onAccept(offer.id)}>
                        {affordable(offer) ? 'Accepter' : 'Trop cher'}
                      </button>
                    ) : (
                      <span className="gc-market-none">—</span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        <div className="gc-modal-actions">
          <button className="gc-action gc-action-quiet" onClick={onClose}>Fermer</button>
        </div>
      </div>
    </div>
  );
}
