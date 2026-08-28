/**
 * Le plateau.
 *
 * Ce fichier ne dessine rien. Il ouvre une scène Three.js dans un cadre, lui
 * transmet la vue publique à chaque changement, et la referme quand le
 * composant s'en va. Tout le rendu vit dans `board3d/`.
 *
 * La séparation n'est pas cosmétique. Une scène 3D est un objet à durée de
 * vie longue — un contexte graphique, des tampons sur la carte, une boucle
 * d'affichage — là où un composant React est une fonction rejouée à chaque
 * rendu. Les mêler aurait signifié reconstruire la carte à chaque battement
 * de l'interface ; ici React ne fait qu'ouvrir, notifier, et fermer.
 */

import { type RefObject, useEffect, useImperativeHandle, useRef, useState } from 'react';

import type { PublicGameView } from '@grand-colonies/protocol';

import { ScenePlateau, couleurDe } from './board3d/scene.js';

/** Les douze identités, inchangées : le reste de l'interface s'y réfère. */
export const colorOf = couleurDe;

/**
 * Ce que le reste de l'interface peut demander au plateau.
 *
 * Deux gestes que la vue publique ne sait pas exprimer : faire sauter les
 * jetons qui viennent de produire — un instant, pas un état — et traduire un
 * hexagone en pixels d'écran, pour que les ressources gagnées puissent voler
 * jusqu'à la main du joueur.
 */
export interface PoigneePlateau {
  signalerProduction(hexes: readonly string[]): void;
  projeterHex(hex: string): { x: number; y: number } | undefined;
}

export interface BoardProps {
  readonly view: PublicGameView;
  readonly ref?: RefObject<PoigneePlateau | null>;
  readonly onVertexClick?: (vertex: string) => void;
  readonly onEdgeClick?: (edge: string) => void;
  readonly onHexClick?: (hex: string) => void;
  readonly highlightVertices?: readonly string[];
  readonly highlightEdges?: readonly string[];
  /** Hexagones où le voleur peut être posé. */
  readonly robberTargets?: readonly string[];
}

export function Board({
  view, ref, onVertexClick, onEdgeClick, onHexClick,
  highlightVertices = [], highlightEdges = [], robberTargets = [],
}: BoardProps) {
  const cadre = useRef<HTMLDivElement>(null);
  const scene = useRef<ScenePlateau | null>(null);
  const [deplace, setDeplace] = useState(false);
  const [panne, setPanne] = useState(false);

  /*
   * Les rappels, tenus dans une référence.
   *
   * La scène les reçoit une fois, à sa création, et les gardera des minutes
   * durant ; les fonctions que React fabrique, elles, changent à chaque
   * rendu. Sans cette indirection il faudrait soit remonter la scène à
   * chaque battement de l'interface, soit poser une route en appelant le
   * gestionnaire d'il y a trois tours.
   */
  const rappels = useRef({ onVertexClick, onEdgeClick, onHexClick });
  rappels.current = { onVertexClick, onEdgeClick, onHexClick };

  useEffect(() => {
    const hote = cadre.current;
    if (!hote) return undefined;

    let plateau: ScenePlateau;
    try {
      plateau = new ScenePlateau(hote, {
        onVertexClick: (v) => rappels.current.onVertexClick?.(v),
        onEdgeClick: (e) => rappels.current.onEdgeClick?.(e),
        onHexClick: (h) => rappels.current.onHexClick?.(h),
        onCadrage: setDeplace,
      });
    } catch {
      // Sans WebGL il n'y a pas de partie possible, mais il y a une phrase à
      // dire : un cadre vide et noir laisserait croire à une panne du jeu.
      setPanne(true);
      return undefined;
    }

    scene.current = plateau;
    return () => {
      scene.current = null;
      plateau.detruire();
    };
  }, []);

  /*
   * La scène est prévenue à chaque changement de la vue.
   *
   * Les tableaux de surbrillance sont recréés par le parent à chaque rendu :
   * les comparer par référence relancerait la mise à jour sans cesse. On les
   * réduit donc à une chaîne, qui ne change que lorsque leur contenu change.
   */
  const sommetsClefs = highlightVertices.join(';');
  const aretesClefs = highlightEdges.join(';');
  const voleurClefs = robberTargets.join(';');

  useEffect(() => {
    scene.current?.mettreAJour({ view, highlightVertices, highlightEdges, robberTargets });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, sommetsClefs, aretesClefs, voleurClefs, panne]);

  useImperativeHandle(ref, () => ({
    signalerProduction: (hexes) => scene.current?.signalerProduction(hexes),
    projeterHex: (hex) => scene.current?.projeterHex(hex),
  }), []);

  if (panne) {
    return (
      <div className="gc-board-fit gc-board-panne">
        <p>
          Ce navigateur n'expose pas WebGL, dont le plateau a besoin pour
          s'afficher. Essaie un autre navigateur, ou vérifie que
          l'accélération matérielle est active.
        </p>
      </div>
    );
  }

  return (
    <div className="gc-board-fit" ref={cadre}>
      {deplace && (
        <button
          className="gc-recentrer"
          onClick={() => scene.current?.recentrer()}
          title="Revoir tout le plateau"
        >
          Recentrer
        </button>
      )}
    </div>
  );
}
