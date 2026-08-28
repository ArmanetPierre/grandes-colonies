/**
 * Rendu du plateau.
 *
 * La géométrie tombe directement des identifiants du moteur, sans conversion
 * ni table de correspondance : un sommet **est** le trio d'hexagones qui s'y
 * rejoignent, donc sa position à l'écran est le barycentre de leurs trois
 * centres. Une arête est la paire qu'elle sépare : sa position est le milieu
 * des deux centres, et son angle celui qui les relie.
 *
 * C'est la même décision qui, côté moteur, garantissait l'unicité des
 * emplacements ; elle rend ici le rendu presque gratuit.
 */

import { useLayoutEffect, useRef, useState } from 'react';

import type { PublicGameView } from '@grand-colonies/protocol';

/**
 * Rayon du cercle circonscrit d'un hexagone, en pixels.
 *
 * Trente-deux est le plancher de lisibilité mesuré dans les wireframes :
 * en dessous, le jeton numéroté cesse d'être lisible. Un plateau XXL de
 * cinquante tuiles tient alors dans un écran de portable sans défilement.
 */
const SIZE = 32;

interface Point { x: number; y: number }

function hexCenter(id: string): Point {
  const [q, r] = id.split(',').map(Number);
  return {
    x: SIZE * Math.sqrt(3) * ((q ?? 0) + (r ?? 0) / 2),
    y: SIZE * 1.5 * (r ?? 0),
  };
}

/** Barycentre des hexagones cités dans une clé de sommet ou d'arête. */
function centroid(key: string): Point {
  const centers = key.split('|').map(hexCenter);
  const sum = centers.reduce((acc, c) => ({ x: acc.x + c.x, y: acc.y + c.y }), { x: 0, y: 0 });
  return { x: sum.x / centers.length, y: sum.y / centers.length };
}

/** Angle d'une arête, pour l'orienter comme la route qu'elle porte. */
function edgeAngle(key: string): number {
  const [a, b] = key.split('|').map(hexCenter);
  if (!a || !b) return 0;
  // La route est perpendiculaire à la ligne qui joint les deux centres.
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 90;
}

/** Les douze identités : couleur, forme et motif (voir identities.html). */
const PLAYER_COLORS = [
  '#A63A17', '#2D6E8E', '#5F7038', '#B8862B', '#7B3457', '#2E8B7A',
  '#3B4F91', '#C4692A', '#6B3F8F', '#2F7A4A', '#7A4A2E', '#3A3A3A',
] as const;

export function colorOf(playerId: string, order: readonly string[]): string {
  const index = order.indexOf(playerId);
  return PLAYER_COLORS[(index < 0 ? 0 : index) % PLAYER_COLORS.length] as string;
}

export interface BoardProps {
  readonly view: PublicGameView;
  readonly onVertexClick?: (vertex: string) => void;
  readonly onEdgeClick?: (edge: string) => void;
  readonly onHexClick?: (hex: string) => void;
  readonly highlightVertices?: readonly string[];
  readonly highlightEdges?: readonly string[];
  /** Hexagones où le voleur peut être posé. */
  readonly robberTargets?: readonly string[];
}

export function Board({
  view, onVertexClick, onEdgeClick, onHexClick,
  highlightVertices = [], highlightEdges = [], robberTargets = [],
}: BoardProps) {
  const centers = view.hexes.map((h) => hexCenter(h.id));
  const minX = Math.min(...centers.map((c) => c.x)) - SIZE * 1.2;
  const minY = Math.min(...centers.map((c) => c.y)) - SIZE * 1.2;
  const maxX = Math.max(...centers.map((c) => c.x)) + SIZE * 1.2;
  const maxY = Math.max(...centers.map((c) => c.y)) + SIZE * 1.2;

  const order = view.players.map((p) => p.id);
  const hotVertices = new Set(highlightVertices);
  const hotEdges = new Set(highlightEdges);
  const contested = new Set(view.intents.filter((i) => i.contested).map((i) => i.location));
  const robberSpots = new Set(robberTargets);

  const width = SIZE * Math.sqrt(3);
  const height = SIZE * 2;

  /*
   * Le plateau se met à l'échelle de la place qu'on lui laisse.
   *
   * Ses dimensions sont fixées par la géométrie — cinquante hexagones de
   * trente-deux pixels font une carte de plus de mille — et sur un téléphone
   * couché, où il ne reste que trois cents pixels de haut, on n'en voyait
   * qu'un coin. Le facteur ne dépasse jamais 1 : sur grand écran le plateau
   * garde sa taille de lecture plutôt que de s'étirer.
   */
  const boardWidth = maxX - minX;
  const boardHeight = maxY - minY;
  const frame = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return undefined;

    const fit = (): void => {
      const { width, height } = element.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      setScale(Math.min(1, width / boardWidth, height / boardHeight));
    };

    fit();
    // La place change à la rotation du téléphone comme à l'ouverture d'un
    // panneau : on suit le conteneur plutôt que la fenêtre.
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [boardWidth, boardHeight]);

  return (
    <div className="gc-board-fit" ref={frame}>
    <div
      className="gc-board"
      style={{
        width: boardWidth,
        height: boardHeight,
        transform: scale < 1 ? `scale(${scale})` : undefined,
      }}
    >
      {view.hexes.map((hex) => {
        const center = hexCenter(hex.id);
        return (
          <div
            key={hex.id}
            className={`gc-hex${robberSpots.has(hex.id) ? ' gc-hex-target' : ''}`}
            onClick={robberSpots.has(hex.id) ? () => onHexClick?.(hex.id) : undefined}
            style={{
              left: center.x - minX - width / 2,
              top: center.y - minY - height / 2,
              width,
              height,
              backgroundImage: `url(/assets/tiles/tile_${hex.terrain}.jpg)`,
            }}
          >
            {/* Une tuile bloquée s'assombrit : le voleur doit se voir sans lire. */}
            {hex.blocked && <div className="gc-robber" title="Voleur" />}
            {hex.token !== undefined && (
              <div className={`gc-token${hex.token === 6 || hex.token === 8 ? ' gc-token-hot' : ''}`}>
                {hex.token}
              </div>
            )}
          </div>
        );
      })}

      {view.roads.map((road) => {
        const mid = centroid(road.edge);
        return (
          <div
            key={road.edge}
            className={`gc-road${road.kind === 'maritime' ? ' gc-road-sea' : ''}`}
            style={{
              left: mid.x - minX,
              top: mid.y - minY,
              background: colorOf(road.owner, order),
              transform: `translate(-50%, -50%) rotate(${edgeAngle(road.edge)}deg)`,
            }}
          />
        );
      })}

      {/* Emplacements proposés : rendus avant les bâtiments pour rester dessous. */}
      {[...hotEdges].map((edge) => {
        const mid = centroid(edge);
        return (
          <button
            key={`spot-${edge}`}
            className="gc-spot gc-spot-edge"
            style={{
              left: mid.x - minX, top: mid.y - minY,
              transform: `translate(-50%, -50%) rotate(${edgeAngle(edge)}deg)`,
            }}
            onClick={() => onEdgeClick?.(edge)}
            aria-label="Construire une route ici"
          />
        );
      })}

      {[...hotVertices].map((vertex) => {
        const point = centroid(vertex);
        return (
          <button
            key={`spot-${vertex}`}
            className="gc-spot gc-spot-vertex"
            style={{ left: point.x - minX, top: point.y - minY }}
            onClick={() => onVertexClick?.(vertex)}
            aria-label="Construire ici"
          />
        );
      })}

      {view.buildings.map((building) => {
        const point = centroid(building.vertex);
        return (
          <div
            key={building.vertex}
            className={`gc-building gc-${building.kind}`}
            style={{
              left: point.x - minX,
              top: point.y - minY,
              background: colorOf(building.owner, order),
            }}
          />
        );
      })}

      {view.ports.map((port) => {
        const point = centroid(port.vertex);
        return (
          <div
            key={`port-${port.vertex}`}
            className="gc-port"
            style={{ left: point.x - minX, top: point.y - minY }}
            title={`Port ${port.kind}`}
          >
            {port.kind === 'generic' ? '3:1' : port.kind === 'merchant' ? '2:1' : '2:1'}
          </div>
        );
      })}

      {/* Un emplacement gelé se signale : c'est une règle invisible autrement. */}
      {view.frozenLocations.map((location) => {
        const key = location.slice(2);
        const point = centroid(key);
        return (
          <div
            key={`frozen-${location}`}
            className="gc-frozen"
            style={{ left: point.x - minX, top: point.y - minY }}
            title="Emplacement gelé ce cycle"
          >
            ✕
          </div>
        );
      })}

      {view.intents.map((intent) => {
        const key = intent.location.slice(2);
        const point = centroid(key);
        return (
          <div
            key={`intent-${intent.id}`}
            className={`gc-intent${contested.has(intent.location) ? ' gc-intent-contested' : ''}`}
            style={{
              left: point.x - minX,
              top: point.y - minY,
              borderColor: colorOf(intent.player, order),
            }}
            title={contested.has(intent.location) ? 'Annonce contestée' : 'Annonce en attente'}
          />
        );
      })}
    </div>
    </div>
  );
}
