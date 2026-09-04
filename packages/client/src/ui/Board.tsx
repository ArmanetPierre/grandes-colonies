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

import type { PublicGameView } from '@grandes-colonies/protocol';

import { ScenePlateau, couleurDe } from './board3d/scene.js';

/** Les douze identités, inchangées : le reste de l'interface s'y réfère. */
export const colorOf = couleurDe;

/*
 * Combien de temps dure un lancer de dés.
 *
 * Republié ici parce que l'interface entière se règle dessus — le bandeau
 * attend pour afficher le total, les jetons attendent pour sauter — et que
 * rien de tout cela n'a de raison de connaître le module qui dessine les
 * dés. C'est une fonction et non une constante : sous
 * `prefers-reduced-motion`, il n'y a rien à attendre.
 */
export { dureeDuJet } from './board3d/roulement.js';

/**
 * Ce que le reste de l'interface peut demander au plateau.
 *
 * Trois gestes que la vue publique ne sait pas exprimer, parce que ce sont des
 * instants et non des états : faire sauter les jetons qui viennent de
 * produire, jeter les dés sur la carte, et traduire un hexagone en pixels
 * d'écran — pour que les ressources gagnées puissent voler jusqu'à la main du
 * joueur.
 */
export interface PoigneePlateau {
  signalerProduction(hexes: readonly string[]): void;
  projeterHex(hex: string): { x: number; y: number } | undefined;
  /** Jette les deux dés sur la carte. `cle` ne règle que l'allure du roulement. */
  lancerDes(a: number, b: number, cle: string): void;
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
    lancerDes: (a, b, cle) => scene.current?.lancerDes(a, b, cle),
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

  /*
   * Les commandes de cadrage.
   *
   * Elles n'existaient pas : le pincement était le seul moyen de cadrer, et
   * un geste raté laissait le joueur sans recours. Elles sont donc toujours
   * là, au bord droit, à portée du pouce — « Recentrer » vient s'y ajouter
   * quand il y a quelque chose à défaire.
   */
  return (
    <div className="gc-board-fit" ref={cadre}>
      <div className="gc-cadrage">
        <button
          className="gc-cadrage-bouton"
          onClick={() => scene.current?.zoomer(1.25)}
          title="Zoomer" aria-label="Zoomer"
        >
          +
        </button>
        <button
          className="gc-cadrage-bouton"
          onClick={() => scene.current?.zoomer(1 / 1.25)}
          title="Dézoomer" aria-label="Dézoomer"
        >
          −
        </button>
        {deplace && (
          <button
            className="gc-cadrage-bouton gc-cadrage-recentrer"
            onClick={() => scene.current?.recentrer()}
            title="Revoir tout le plateau" aria-label="Revoir tout le plateau"
          >
            Tout voir
          </button>
        )}
      </div>
    </div>
  );
}
