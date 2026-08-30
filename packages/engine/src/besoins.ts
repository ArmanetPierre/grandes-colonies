/**
 * Ce qui manque pour bâtir, et par où le combler.
 *
 * Le game design fait du commerce le levier central (§37), et la simulation
 * le chiffre : les parties où les joueurs acceptent largement raccourcissent
 * de quarante pour cent. Mais à douze joueurs, un joueur qui vient de
 * produire ne sait pas d'un coup d'œil ce qui lui manque, ni ce qu'il peut
 * en faire — il faudrait tenir de tête cinq coûts, sa main, et sept taux de
 * banque qui bougent d'un cycle à l'autre.
 *
 * Tout était déjà là et rien ne le reliait : les coûts dans `COSTS`, la main
 * dans la vue privée, les taux dans la vue privée aussi, remise de port
 * comprise. Ce module fait la jonction, et rien d'autre : il ne décide pas,
 * il montre.
 *
 * C'est délibérément une fonction pure, hors de l'état de jeu. Elle ne sait
 * ni qui joue, ni quand ; on peut donc la poser sur la main d'un autre pour
 * un panneau de maître de jeu, ou sur une main hypothétique pour un bot.
 */

import type { Buildable, Resource, ResourceCounts } from './resources.js';
import { COSTS, RESOURCES, amount } from './resources.js';

/** Un échange à la banque : tant de `donne` contre une unité de `recoit`. */
export interface EchangeBanque {
  readonly donne: Resource;
  readonly nombre: number;
  readonly recoit: Resource;
}

export interface Besoin {
  readonly buildable: Buildable;
  /** Ce qui manque, ressource par ressource. Vide quand on peut déjà bâtir. */
  readonly manquant: ResourceCounts;
  /** Ce qui reste une fois le coût mis de côté : la monnaie d'échange. */
  readonly surplus: ResourceCounts;
  /**
   * Les échanges à la banque qui rapprochent, du moins cher au plus cher.
   * Ils sont cumulables : chacun consomme le surplus que le précédent laisse.
   */
  readonly banque: readonly EchangeBanque[];
  /** Ces échanges suffisent-ils à tout combler ? */
  readonly comble: boolean;
}

const vide = (c: ResourceCounts): boolean => RESOURCES.every((r) => amount(c, r) === 0);

function geler(brut: Partial<Record<Resource, number>>): ResourceCounts {
  const out: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) if ((brut[r] ?? 0) > 0) out[r] = brut[r] as number;
  return Object.freeze(out);
}

/**
 * Le chemin le moins cher pour combler un manque, à la banque seule.
 *
 * On sert d'abord la ressource la moins chère à donner, parce que le nombre
 * de cartes dépensées est ce qui compte : un joueur qui vide sa main pour
 * une brique perd la fenêtre suivante. Le tri est stable pour que deux mains
 * identiques donnent le même conseil — un conseil qui change tout seul d'une
 * image à l'autre n'inspire rien.
 *
 * On ne propose jamais de donner une ressource qui figure au coût : le
 * surplus l'exclut déjà, mais c'est la propriété qu'il faut retenir.
 */
function comblerParLaBanque(
  manquant: ResourceCounts,
  surplus: ResourceCounts,
  taux: Readonly<Partial<Record<Resource, number>>>,
): { echanges: EchangeBanque[]; comble: boolean } {
  const reste: Partial<Record<Resource, number>> = {};
  for (const r of RESOURCES) reste[r] = amount(surplus, r);

  const echanges: EchangeBanque[] = [];
  let comble = true;

  for (const voulue of RESOURCES) {
    let besoin = amount(manquant, voulue);
    while (besoin > 0) {
      // La moins chère parmi celles dont il reste assez. À prix égal, l'ordre
      // de RESOURCES tranche : deux mains identiques, un même conseil.
      const candidates = RESOURCES
        .filter((r) => r !== voulue)
        .map((r) => ({ r, prix: taux[r] ?? Infinity }))
        .filter(({ r, prix }) => Number.isFinite(prix) && (reste[r] ?? 0) >= prix);

      let meilleure = candidates[0];
      for (const c of candidates) if (c.prix < (meilleure?.prix ?? Infinity)) meilleure = c;
      if (!meilleure) { comble = false; break; }

      reste[meilleure.r] = (reste[meilleure.r] ?? 0) - meilleure.prix;
      echanges.push({ donne: meilleure.r, nombre: meilleure.prix, recoit: voulue });
      besoin--;
    }
  }

  return { echanges, comble };
}

/**
 * Ce qui manque pour chaque construction demandée.
 *
 * `taux` est le nombre de cartes à donner à la banque pour en recevoir une,
 * ressource par ressource — c'est `bankRates` de la vue privée, remises de
 * port déjà appliquées. Une ressource absente de `taux` est réputée
 * inéchangeable.
 */
export function besoinsPour(
  main: ResourceCounts,
  taux: Readonly<Partial<Record<Resource, number>>>,
  buildables: readonly Buildable[],
): Besoin[] {
  return buildables.map((buildable) => {
    const cout = COSTS[buildable];
    const manquantBrut: Partial<Record<Resource, number>> = {};
    const surplusBrut: Partial<Record<Resource, number>> = {};

    for (const r of RESOURCES) {
      const ecart = amount(cout, r) - amount(main, r);
      if (ecart > 0) manquantBrut[r] = ecart;
      else if (ecart < 0) surplusBrut[r] = -ecart;
    }

    const manquant = geler(manquantBrut);
    const surplus = geler(surplusBrut);

    if (vide(manquant)) {
      return { buildable, manquant, surplus, banque: [], comble: true };
    }

    const { echanges, comble } = comblerParLaBanque(manquant, surplus, taux);
    return { buildable, manquant, surplus, banque: Object.freeze(echanges), comble };
  });
}

/** Peut-on payer ce coût sans rien échanger ? */
export function peutPayer(main: ResourceCounts, buildable: Buildable): boolean {
  const cout = COSTS[buildable];
  return RESOURCES.every((r) => amount(main, r) >= amount(cout, r));
}
