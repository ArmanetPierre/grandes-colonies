/**
 * Les ressources gagnées, en vol.
 *
 * Le joueur qui encaisse voyait son compteur changer dans la barre du bas.
 * Rien d'autre. À douze joueurs, où les dés tournent vite et où l'on regarde
 * ailleurs la moitié du temps, deux blés arrivés sans bruit ne sont pas
 * remarqués — et le tour d'après, on ne sait plus ce qu'on a.
 *
 * Chaque carte gagnée part donc de l'hexagone qui l'a produite et rejoint sa
 * pile. Le geste dit trois choses d'un coup : que quelque chose est arrivé,
 * quoi, et d'où — la dernière étant précisément celle qu'un compteur ne peut
 * pas dire.
 *
 * Le vol est en HTML par-dessus la scène, et non dans la scène. Sa
 * destination est un élément de l'interface, dont la position ne s'exprime
 * qu'en pixels d'écran ; l'y faire arriver depuis un objet 3D aurait demandé
 * de reprojeter la barre du bas dans le monde à chaque image, pour un
 * résultat que personne n'aurait distingué de celui-ci.
 */

import { useEffect, useState } from 'react';

import { ResourceIcon, type ResourceName } from './ResourceIcon.js';

/** Durée d'un vol, en millisecondes. Doit suivre `--gc-vol` dans la feuille. */
const DUREE = 780;

/** Décalage entre deux cartes de la même ressource. */
const ECART = 110;

/**
 * Combien de cartes volent au plus pour une même ressource.
 *
 * Un monopole peut rapporter huit briques d'un coup. Huit icônes en vol
 * n'informent pas mieux que trois, et masquent le plateau au moment où l'on
 * voudrait justement le regarder. Le compte exact reste lisible : il est
 * inscrit sur la pile d'arrivée.
 */
const MAX_PAR_RESSOURCE = 3;

export interface Vol {
  readonly id: string;
  readonly resource: ResourceName;
  readonly depart: { x: number; y: number };
  readonly arrivee: { x: number; y: number };
  readonly retard: number;
}

/** Prépare les vols d'une récolte : d'où part chaque carte, et quand. */
export function composerVols(
  gains: Readonly<Record<string, number>>,
  depart: (resource: string) => { x: number; y: number } | undefined,
  arrivee: (resource: string) => { x: number; y: number } | undefined,
  graine: number,
): Vol[] {
  const vols: Vol[] = [];
  for (const [resource, nombre] of Object.entries(gains)) {
    if (nombre <= 0) continue;
    const d = depart(resource);
    const a = arrivee(resource);
    // Sans point de départ ou d'arrivée visible — hexagone hors cadre, pile
    // pas encore affichée — on ne fait pas voler une carte de nulle part
    // vers nulle part. Le compteur, lui, dira toujours la vérité.
    if (!d || !a) continue;

    const combien = Math.min(nombre, MAX_PAR_RESSOURCE);
    for (let i = 0; i < combien; i++) {
      vols.push({
        id: `${graine}-${resource}-${i}`,
        resource: resource as ResourceName,
        depart: d,
        arrivee: a,
        retard: i * ECART,
      });
    }
  }
  return vols;
}

export function Gains({ vols }: { vols: readonly Vol[] }) {
  const [visibles, setVisibles] = useState<readonly Vol[]>([]);

  useEffect(() => {
    if (vols.length === 0) return undefined;
    setVisibles((actuels) => [...actuels, ...vols]);

    // Chaque volée se retire d'elle-même. Sans cela, une soirée de trois
    // heures laisserait quelques milliers de cartes mortes dans le document.
    const dernier = Math.max(...vols.map((v) => v.retard));
    const fin = window.setTimeout(() => {
      const partis = new Set(vols.map((v) => v.id));
      setVisibles((actuels) => actuels.filter((v) => !partis.has(v.id)));
    }, DUREE + dernier + 60);
    return () => window.clearTimeout(fin);
  }, [vols]);

  if (visibles.length === 0) return null;

  return (
    <div className="gc-vols" aria-hidden="true">
      {visibles.map((vol) => (
        <span
          key={vol.id}
          className="gc-vol"
          style={{
            left: vol.depart.x,
            top: vol.depart.y,
            // Le trajet est exprimé en écart plutôt qu'en destination : une
            // transformation coûte moins qu'une position animée, et c'est la
            // seule façon d'obtenir une courbe plutôt qu'une ligne droite.
            ['--gc-dx' as string]: `${vol.arrivee.x - vol.depart.x}px`,
            ['--gc-dy' as string]: `${vol.arrivee.y - vol.depart.y}px`,
            animationDelay: `${vol.retard}ms`,
          }}
        >
          <ResourceIcon resource={vol.resource} />
        </span>
      ))}
    </div>
  );
}
