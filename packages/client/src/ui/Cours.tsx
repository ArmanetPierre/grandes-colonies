/**
 * Le cours de la banque (§10).
 *
 * Le bouton « Marché » de l'écran ouvre déjà autre chose — la liste des
 * offres de la table. Cette bande porte donc le nom de ce qu'elle chiffre :
 * le prix auquel la **banque** convertit, et non celui que se consentent les
 * joueurs entre eux.
 *
 * Le taux bancaire était une constante que personne n'avait besoin de
 * regarder : 4:1, ou 3:1 quand on tenait un port. Il bouge maintenant, et un
 * prix qui bouge sans être affiché ne sert à rien — un joueur qui découvre
 * au clic que son bois vaut une carte de moins qu'au tour d'avant ne peut
 * rien en faire.
 *
 * D'où le parti de cette bande : elle ne montre pas *le marché*, elle montre
 * **ce que ce joueur-là paierait maintenant**, port compris. Le cours nu
 * reste accessible en infobulle, parce qu'il départage deux joueurs qui
 * négocient à voix haute.
 *
 * La flèche compte autant que le chiffre. Un cours sur le point de bouger
 * change la décision — vendre maintenant plutôt qu'au prochain cycle — et
 * c'est la seule chose que la bande ajoute à un simple prix affiché.
 */

import type { PrivatePlayerView, PublicGameView } from '@grand-colonies/protocol';

import { RESOURCE_LABELS, ResourceIcon } from './ResourceIcon.jsx';

/**
 * Les six du §10. Le poisson n'a de terrain sur aucun plateau actuel.
 *
 * Exportée parce que le panneau de commerce doit offrir **exactement** ces
 * ressources : afficher un prix de l'or dans cette bande sans le proposer
 * dans les menus revenait à annoncer un tarif que l'interface refusait
 * ensuite d'honorer.
 */
export const TRADED = ['wood', 'brick', 'wool', 'grain', 'ore', 'gold'] as const;

export interface CoursProps {
  readonly pub: PublicGameView;
  readonly priv: PrivatePlayerView;
}

export function Cours({ pub, priv }: CoursProps) {
  return (
    <div className="gc-cours">
      <div className="gc-cours-head">Cours de la banque</div>
      <ul className="gc-cours-list">
        {TRADED.map((resource) => {
          const cours = pub.market.rates[resource] ?? 4;
          const mine = priv.bankRates[resource] ?? cours;
          const drift = pub.market.drift[resource] ?? 0;

          return (
            <li
              key={resource}
              className={`gc-cours-item${mine < cours ? ' is-discounted' : ''}`}
              title={expliquerCours(RESOURCE_LABELS[resource] ?? resource, cours, mine, drift, pub.market.step)}
            >
              <ResourceIcon resource={resource} size={18} />
              <span className="gc-cours-rate">{mine}</span>
              <Arrow drift={drift} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Le sens du prochain cran.
 *
 * Une flèche montante annonce une **mauvaise** nouvelle pour qui détient la
 * ressource : il en faudra une de plus. On la colore donc comme un avis, pas
 * comme un gain, et on la double d'un mot dans l'infobulle — la couleur
 * seule ne dirait rien à un joueur daltonien.
 */
function Arrow({ drift }: { drift: number }) {
  if (drift === 0) return <span className="gc-cours-flat" aria-hidden="true">·</span>;
  const up = drift > 0;
  return (
    <span className={`gc-cours-arrow${up ? ' is-up' : ' is-down'}`} aria-hidden="true">
      {up ? '▲' : '▼'}
    </span>
  );
}

/**
 * L'infobulle : le cours nu, la remise du port, et ce qui vient.
 *
 * Exportée pour être testée : c'est elle qui fait l'arithmétique du « dans
 * combien de ventes », et se tromper d'une unité ferait vendre un joueur un
 * cycle trop tard.
 */
export function expliquerCours(
  label: string,
  cours: number,
  mine: number,
  drift: number,
  step: number,
): string {
  const parts = [`${label} — cours ${cours}:1`];
  if (mine < cours) parts.push(`tu paies ${mine}:1 grâce à ton port`);

  if (drift > 0) {
    const left = step - drift;
    parts.push(`${left} vente${left > 1 ? 's' : ''} de plus et il monte à ${cours + 1}:1`);
  } else if (drift < 0) {
    const left = step + drift;
    parts.push(`${left} achat${left > 1 ? 's' : ''} de plus et il descend à ${cours - 1}:1`);
  }

  return parts.join(' · ');
}
