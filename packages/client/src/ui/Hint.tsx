/**
 * Infobulle d'action.
 *
 * Un bouton nommé « Métropole » ne dit ni ce qu'elle apporte ni ce qu'elle
 * coûte, et le joueur qui découvre le jeu doit deviner ou demander. À douze
 * autour d'une table, demander coûte cher : chaque question suspend la partie.
 *
 * Le coût est lu dans `COSTS`, la table même que le moteur débite. Une
 * infobulle qui recopierait les prix finirait par mentir au premier
 * ajustement d'équilibrage — et c'est le genre de mensonge qu'un joueur ne
 * pardonne pas, puisqu'il a construit son tour dessus.
 */

import { type ReactNode, useCallback, useLayoutEffect, useRef, useState } from 'react';

import { COSTS, RESOURCES, type ResourceCounts, amount } from '@grandes-colonies/engine';

import { ResourceIcon } from './ResourceIcon.jsx';

/** Ce que coûte chaque action, ou rien si elle est gratuite. */
export type CostKind = keyof typeof COSTS;

export interface HintProps {
  /** Ce que fait l'action, en une phrase. */
  readonly text: string;
  readonly cost?: CostKind;
  /** Précision affichée sous le coût — rareté, quota, condition. */
  readonly note?: string;
  readonly children: ReactNode;
}

/**
 * Le prix, en pictogrammes.
 *
 * Exporté parce qu'il sert aussi hors infobulle : sur téléphone le coût est
 * écrit à même le bouton, faute de survol à quoi le suspendre.
 */
export function CostLine({ cost, className = 'gc-hint-cost' }: {
  cost: ResourceCounts;
  className?: string;
}) {
  const entries = RESOURCES
    .map((resource) => [resource, amount(cost, resource)] as const)
    .filter(([, n]) => n > 0);

  if (entries.length === 0) return null;

  return (
    <span className={className}>
      {entries.map(([resource, n]) => (
        <span key={resource} className="gc-hint-cost-item">
          <ResourceIcon resource={resource} size={15} />
          {n}
        </span>
      ))}
    </span>
  );
}

/** Marge minimale entre l'infobulle et le bord de la fenêtre. */
const EDGE = 8;

/**
 * Enveloppe un bouton d'une explication au survol.
 *
 * La position est calculée plutôt que laissée au CSS. Un simple centrage sur
 * le bouton débordait de l'écran pour le dernier de la rangée : « Fin de
 * cycle » expliquait ce qu'il faisait à moitié hors du cadre. Le calcul borne
 * l'infobulle à la fenêtre, ce qu'aucune règle CSS ne sait faire sans
 * connaître sa largeur.
 *
 * `:focus-within` reste dans la feuille de style : l'infobulle vient donc
 * aussi au clavier, et au toucher sur téléphone où le survol n'existe pas.
 */
export function Hint({ text, cost, note, children }: HintProps) {
  const wrap = useRef<HTMLSpanElement>(null);
  const bubble = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(false);
  const [left, setLeft] = useState<number>();

  useLayoutEffect(() => {
    if (!shown) return;
    const anchor = wrap.current?.getBoundingClientRect();
    const width = bubble.current?.offsetWidth ?? 0;
    if (!anchor || width === 0) return;

    const centred = anchor.left + anchor.width / 2 - width / 2;
    const clamped = Math.min(Math.max(centred, EDGE), window.innerWidth - width - EDGE);
    setLeft(clamped - anchor.left);
  }, [shown, text]);

  const open = useCallback(() => setShown(true), []);
  const close = useCallback(() => { setShown(false); setLeft(undefined); }, []);

  return (
    <span
      className="gc-hint-wrap"
      ref={wrap}
      onPointerEnter={open}
      onPointerLeave={close}
      onFocus={open}
      onBlur={close}
    >
      {children}
      {shown && (
        <span
          className="gc-hint"
          role="tooltip"
          ref={bubble}
          // Avant la mesure, l'infobulle reste invisible : la voir sauter en
          // place serait pire que de l'attendre une image de plus.
          style={left === undefined ? { visibility: 'hidden' } : { left, opacity: 1 }}
        >
          <span className="gc-hint-text">{text}</span>
          {cost !== undefined && <CostLine cost={COSTS[cost]} />}
          {note !== undefined && <span className="gc-hint-note">{note}</span>}
        </span>
      )}
    </span>
  );
}
