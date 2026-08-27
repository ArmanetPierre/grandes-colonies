/**
 * Défausse après un 7.
 *
 * C'est le pic de temps mort n° 1 du jeu : elle se déclenche pour tous les
 * joueurs concernés en même temps, une dizaine de fois par partie, et bloque
 * la progression jusqu'au dernier. Tout ici vise les dix secondes :
 *
 *   — une **proposition est déjà sélectionnée** à l'ouverture, de sorte que
 *     valider sans réfléchir soit un geste unique ;
 *   — la proposition entame la pile la plus fournie, ce qui préserve la
 *     diversité de la main — perdre sa seule brique coûte bien plus cher que
 *     perdre un bois sur cinq ;
 *   — l'**avancement des autres** est affiché : attendre en sachant qui l'on
 *     attend est moins pénible qu'attendre dans le vide.
 */

import { useMemo, useState } from 'react';

import { suggestDiscard } from '@grand-colonies/engine';
import type { PrivatePlayerView, PublicGameView } from '@grand-colonies/protocol';

const LABELS: Record<string, string> = {
  wood: 'Bois', brick: 'Brique', wool: 'Laine',
  grain: 'Blé', ore: 'Minerai', gold: 'Or', fish: 'Poisson',
};

export interface DiscardProps {
  readonly pub: PublicGameView;
  readonly priv: PrivatePlayerView;
  readonly onDiscard: (resources: Record<string, number>) => void;
}

export function Discard({ pub, priv, onDiscard }: DiscardProps) {
  const required = priv.mustDiscard;
  const suggestion = useMemo(
    () => suggestDiscard(priv.hand, required) as Record<string, number>,
    [priv.hand, required],
  );
  const [picked, setPicked] = useState<Record<string, number>>(suggestion);

  const total = Object.values(picked).reduce((sum, n) => sum + n, 0);
  const ready = total === required;

  const adjust = (resource: string, delta: number): void => {
    setPicked((current) => {
      const held = (priv.hand as Record<string, number>)[resource] ?? 0;
      const next = Math.min(held, Math.max(0, (current[resource] ?? 0) + delta));
      return { ...current, [resource]: next };
    });
  };

  const waiting = pub.players.filter((p) => p.mustDiscard > 0 && p.id !== priv.id);
  const done = pub.players.filter((p) => p.mustDiscard === 0 && p.handSize > 0 && p.id !== priv.id);

  return (
    <div className="gc-modal-backdrop">
      <div className="gc-modal">
        <header className="gc-modal-head">
          <span className="gc-modal-title">Un 7 !</span>
          <span className="gc-modal-sub">Défausse {required} carte{required > 1 ? 's' : ''}</span>
        </header>

        <p className="gc-modal-hint">
          Proposition du jeu — déjà sélectionnée. Ajuste si tu préfères.
        </p>

        <div className="gc-discard-rows">
          {Object.entries(priv.hand as Record<string, number>).map(([resource, held]) => (
            <div key={resource} className="gc-discard-row">
              <span className="gc-discard-name">{LABELS[resource] ?? resource}</span>
              <span className="gc-discard-held">{held}</span>
              <button onClick={() => adjust(resource, -1)} disabled={(picked[resource] ?? 0) === 0}>−</button>
              <span className="gc-discard-count">{picked[resource] ?? 0}</span>
              <button onClick={() => adjust(resource, 1)} disabled={(picked[resource] ?? 0) >= held}>+</button>
            </div>
          ))}
        </div>

        <footer className="gc-modal-foot">
          <button className="gc-action" disabled={!ready} onClick={() => onDiscard(picked)}>
            Défausser {total} / {required}
          </button>
          {/* Savoir qui l'on attend rend l'attente supportable. */}
          {(waiting.length > 0 || done.length > 0) && (
            <div className="gc-waiting">
              {done.length > 0 && <span>{done.length} joueur{done.length > 1 ? 's ont' : ' a'} fini</span>}
              {waiting.length > 0 && <span> · en attente de {waiting.map((p) => p.name).join(', ')}</span>}
            </div>
          )}
        </footer>
      </div>
    </div>
  );
}
