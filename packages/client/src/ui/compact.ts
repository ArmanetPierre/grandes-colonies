/**
 * Le format téléphone, tel que le sait le composant plutôt que la feuille de
 * style.
 *
 * Une requête média suffit à déplacer des boîtes, pas à changer de mise en
 * page : sur téléphone, les panneaux ne se resserrent pas, ils **disparaissent
 * derrière des tiroirs** qu'on ouvre au doigt. Un tiroir a un état, donc il
 * faut que le composant sache dans quel monde il vit.
 *
 * Le seuil réunit les deux façons dont un téléphone se présente : couché il
 * est large mais bas — 852 × 393 sur un iPhone récent, donc au-delà du seuil
 * de largeur — et debout il est étroit. C'est la même interface dans les deux
 * cas, seule l'orientation des barres change, et elle relève du style.
 */

import { useEffect, useState } from 'react';

export const COMPACT_QUERY =
  '(max-width: 780px), (orientation: landscape) and (max-height: 560px)';

/** Vrai tant que l'écran est celui d'un téléphone, dans un sens ou l'autre. */
export function useCompact(): boolean {
  const [compact, setCompact] = useState(
    () => typeof window !== 'undefined'
      && typeof window.matchMedia === 'function'
      && window.matchMedia(COMPACT_QUERY).matches,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia(COMPACT_QUERY);
    const update = (): void => setCompact(query.matches);
    // Une rotation d'écran change la réponse : on la relit à l'abonnement,
    // au cas où elle aurait changé entre le premier rendu et cet effet.
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return compact;
}
