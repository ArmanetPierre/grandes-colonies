/**
 * Les cartes développement en main.
 *
 * Chaque carte demande un geste différent — deux ressources pour l'Invention,
 * une seule pour le Monopole, un ou deux emplacements pour Construction de
 * routes — et c'est précisément ce qui rendait un bouton unique impossible.
 * Le panneau assume donc trois formes de choix, mais garde une règle : on
 * clique la carte, *puis* on précise. Jamais l'inverse.
 *
 * Les cartes achetées ce tour restent visibles, grisées : les cacher ferait
 * croire à l'achat perdu.
 */

import { useState } from 'react';

import type { PrivatePlayerView } from '@grand-colonies/protocol';

import { CARD_TITLES, DevCardArt } from './DevCardArt.jsx';
import { RESOURCE_LABELS, ResourceIcon } from './ResourceIcon.jsx';

/** Les ressources qu'une carte peut viser — l'or et le poisson compris. */
const CHOOSABLE = ['wood', 'brick', 'wool', 'grain', 'ore', 'gold', 'fish'] as const;

/** Ce que le panneau demande à l'écran de jeu d'armer sur le plateau. */
/** Réexporté pour le journal, qui nomme les cartes jouées. */
export { CARD_TITLES as CARD_LABELS } from './DevCardArt.jsx';

export type CardRequest =
  | { readonly kind: 'knight' }
  | { readonly kind: 'roadBuilding' }
  | { readonly kind: 'freeBuild' };

export interface DevCardsProps {
  readonly priv: PrivatePlayerView;
  /** Cartes qui se jouent sur le plateau : l'écran de jeu prend le relais. */
  readonly onBoardCard: (request: CardRequest) => void;
  readonly onInvention: (resources: Record<string, number>) => void;
  readonly onMonopoly: (resource: string) => void;
  /** Ce qui est déjà armé sur le plateau, pour le montrer comme tel. */
  readonly armed: string | undefined;
  readonly onCancel: () => void;
}

export function DevCards({
  priv, onBoardCard, onInvention, onMonopoly, armed, onCancel,
}: DevCardsProps) {
  const [choosing, setChoosing] = useState<'invention' | 'monopoly' | null>(null);
  const playable = priv.playableDevCards;
  const pending = priv.pendingDevCards;

  if (playable.length === 0 && pending.length === 0) return null;

  const canPlay = priv.capabilities.includes('CAN_PLAY_DEV_CARD');
  const canKnight = priv.capabilities.includes('CAN_PLAY_KNIGHT');
  const playableFor = (card: string): boolean => (card === 'knight' ? canKnight : canPlay);

  // Une carte par tour : dès qu'une est armée, les autres attendent.
  const start = (card: string): void => {
    if (card === 'invention' || card === 'monopoly') setChoosing(card);
    else onBoardCard({ kind: card as CardRequest['kind'] });
  };

  return (
    <>
      <div className="gc-devcards">
        <span className="gc-devcards-label">Cartes</span>
        {playable.map((card, index) => (
          <button
            key={`${card}-${index}`}
            className="gc-card-button"
            disabled={!playableFor(card)}
            title={CARD_TITLES[card] ?? card}
            onClick={() => (armed === card ? onCancel() : start(card))}
          >
            <DevCardArt card={card} armed={armed === card} />
          </button>
        ))}
        {/* Face cachée : on la montre quand même, la cacher ferait croire à
            l'achat perdu. */}
        {pending.map((card, index) => (
          <button key={`p-${card}-${index}`} className="gc-card-button" disabled>
            <DevCardArt card={card} facedown />
          </button>
        ))}
      </div>

      {choosing === 'invention' && (
        <PickResources
          title="Invention"
          hint="Choisis deux ressources : la banque te les donne."
          count={2}
          onCancel={() => setChoosing(null)}
          onConfirm={(picked) => { onInvention(picked); setChoosing(null); }}
        />
      )}

      {choosing === 'monopoly' && (
        <PickResources
          title="Monopole"
          hint="Choisis une ressource : tous les autres joueurs te la cèdent."
          count={1}
          onCancel={() => setChoosing(null)}
          onConfirm={(picked) => {
            const resource = Object.keys(picked)[0];
            if (resource) onMonopoly(resource);
            setChoosing(null);
          }}
        />
      )}
    </>
  );
}

/**
 * Choix de ressources, à une ou deux unités.
 *
 * Le bouton de validation ne s'active qu'au compte exact : le moteur refuse
 * tout autre nombre, autant que l'écran le dise avant l'aller-retour.
 */
function PickResources({ title, hint, count, onConfirm, onCancel }: {
  title: string;
  hint: string;
  count: number;
  onConfirm: (picked: Record<string, number>) => void;
  onCancel: () => void;
}) {
  const [picked, setPicked] = useState<Record<string, number>>({});
  const total = Object.values(picked).reduce((sum, n) => sum + n, 0);

  const add = (resource: string, delta: number): void => {
    setPicked((current) => {
      const next = (current[resource] ?? 0) + delta;
      if (next < 0) return current;
      if (delta > 0 && total >= count) return current;
      const updated = { ...current, [resource]: next };
      if (next === 0) delete updated[resource];
      return updated;
    });
  };

  return (
    <div className="gc-modal-backdrop">
      <div className="gc-modal">
        <header className="gc-modal-head">
          <span className="gc-modal-title">{title}</span>
          <span className="gc-modal-count">{total} / {count}</span>
        </header>
        <p className="gc-modal-hint">{hint}</p>

        <div className="gc-pick-grid">
          {CHOOSABLE.map((resource) => (
            <div key={resource} className="gc-pick-row">
              <span className="gc-pick-name">
                <ResourceIcon resource={resource} />
                {RESOURCE_LABELS[resource] ?? resource}
              </span>
              <button className="gc-action gc-action-mini" onClick={() => add(resource, -1)}
                      disabled={(picked[resource] ?? 0) === 0}>−</button>
              <span className="gc-pick-count">{picked[resource] ?? 0}</span>
              <button className="gc-action gc-action-mini" onClick={() => add(resource, 1)}
                      disabled={total >= count}>+</button>
            </div>
          ))}
        </div>

        <div className="gc-modal-actions">
          <button className="gc-action gc-action-quiet" onClick={onCancel}>Annuler</button>
          <button className="gc-action" disabled={total !== count} onClick={() => onConfirm(picked)}>
            Jouer
          </button>
        </div>
      </div>
    </div>
  );
}
