/**
 * Ce qui manque pour bâtir, et par où le combler.
 *
 * Un retour de la première soirée : « proposition automatique de marché en
 * fonction de ce qu'il manque pour construire ». Tout était déjà à l'écran —
 * la main en bas, les coûts sur les boutons, le cours de la banque juste
 * au-dessus — mais réparti sur trois zones, et il fallait faire la
 * soustraction de tête pendant une fenêtre de trente secondes.
 *
 * Le panneau vit dans le commerce et non dans « Bâtir », parce que ce n'est
 * pas une aide à la construction : c'est une invitation à négocier. Le taux
 * de la banque y est le prix plancher, celui qu'on affiche pour que la table
 * sache ce qu'elle doit battre.
 *
 * Il ne montre que ce qui a un emplacement légal. Conseiller une ville à qui
 * n'a pas de colonie à améliorer serait du bruit, et le bruit est ce qui
 * fait qu'on cesse de lire un panneau.
 */

import { useMemo } from 'react';

import { type Buildable, besoinsPour } from '@grand-colonies/engine';
import type { PrivatePlayerView } from '@grand-colonies/protocol';

import { ResourceIcon } from './ResourceIcon.jsx';

const NOMS: Partial<Record<Buildable, string>> = {
  road: 'Route',
  settlement: 'Colonie',
  city: 'Ville',
  metropolis: 'Métropole',
  monument: 'Monument',
  devCard: 'Carte dév.',
};

/** Une liste de ressources en pictogrammes, comme partout ailleurs. */
function Cartes({ counts }: { counts: Readonly<Record<string, number>> }) {
  return (
    <>
      {Object.entries(counts).filter(([, n]) => n > 0).map(([resource, n]) => (
        <span key={resource} className="gc-manque-carte">
          <ResourceIcon resource={resource} size={14} />{n}
        </span>
      ))}
    </>
  );
}

export function Manques({ priv }: { priv: PrivatePlayerView }) {
  /*
   * L'ordre est celui du coût croissant, pas celui des boutons : ce qu'on
   * cherche ici c'est le geste le plus proche d'aboutir, et la carte
   * développement s'y glisse parce qu'elle n'a pas d'emplacement à trouver.
   */
  const cibles = useMemo<Buildable[]>(() => {
    const ouvert: Buildable[] = [];
    if (priv.spots.roads.length > 0) ouvert.push('road');
    if (priv.spots.settlements.length > 0) ouvert.push('settlement');
    if (priv.spots.cities.length > 0) ouvert.push('city');
    ouvert.push('devCard');
    if (priv.spots.metropolises.length > 0) ouvert.push('metropolis');
    if (priv.spots.monuments.length > 0) ouvert.push('monument');
    return ouvert;
  }, [priv.spots]);

  const besoins = useMemo(
    () => besoinsPour(priv.hand, priv.bankRates, cibles),
    [priv.hand, priv.bankRates, cibles],
  );

  if (besoins.length === 0) return null;

  return (
    <div className="gc-manques">
      <div className="gc-trade-sub">Ce qu’il te manque</div>
      {besoins.map((besoin) => {
        const nom = NOMS[besoin.buildable] ?? besoin.buildable;
        const rien = Object.keys(besoin.manquant).length === 0;

        // Le conseil se résume au premier échange : c'est le prochain geste,
        // et en énumérer quatre reviendrait à demander un plan plutôt qu'un
        // coup. Le compte dit qu'il y en aura d'autres.
        const premier = besoin.banque[0];
        const suite = besoin.banque.length - 1;

        return (
          <div key={besoin.buildable} className={`gc-manque${rien ? ' is-pret' : ''}`}>
            <span className="gc-manque-nom">{nom}</span>
            {rien ? (
              <span className="gc-manque-pret">tu peux la bâtir</span>
            ) : (
              <>
                <span className="gc-manque-liste"><Cartes counts={besoin.manquant} /></span>
                {premier ? (
                  <span className="gc-manque-voie">
                    <ResourceIcon resource={premier.donne} size={13} />
                    {premier.nombre} à la banque
                    {suite > 0 && ` · ${suite} autre${suite > 1 ? 's' : ''} échange${suite > 1 ? 's' : ''}`}
                    {!besoin.comble && ' · pas assez'}
                  </span>
                ) : (
                  <span className="gc-manque-voie gc-manque-loin">demande à la table</span>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
