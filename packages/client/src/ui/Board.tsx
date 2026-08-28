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

import { type MouseEvent, type PointerEvent, type WheelEvent, useLayoutEffect, useRef, useState } from 'react';

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

/**
 * Les silhouettes des îles du large.
 *
 * Chacune sa forme : toutes taillées sur le même anneau, elles se lisaient
 * comme six exemplaires du même tampon. Une côte n'a pas deux fois la même
 * découpe, et c'est ce qui fait croire à un monde plutôt qu'à un motif.
 */
const SILHOUETTES: readonly (readonly (readonly [number, number])[])[] = [
  // Un croissant ouvert au sud.
  [[0, 0], [1, 0], [2, 0], [-1, 1], [2, 1], [-1, 2], [0, 2], [1, 2]],
  // Une longue barre orientée nord-est.
  [[0, 0], [1, -1], [2, -2], [3, -2], [-1, 1], [-1, 0]],
  // Un îlot solitaire, à peine un rocher.
  [[0, 0], [1, 0]],
  // Une masse trapue, la plus grande du lot.
  [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 1], [2, 0], [0, -1], [1, -1], [-1, 2]],
  // Un chapelet en diagonale.
  [[0, 0], [1, 1], [2, 2], [3, 2]],
  // Un fer à cheval.
  [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
  // Deux cailloux qui se touchent à peine.
  [[0, 0], [2, 0], [1, 1]],
  // Une pointe effilée vers le sud.
  [[0, 0], [1, 0], [0, 1], [0, 2], [1, 1]],
];

/**
 * Où poser les terres du large.
 *
 * Autour du plateau, à une quinzaine d'hexagones de son centre : assez loin
 * pour qu'on ne les confonde jamais avec des îles jouables, assez près pour
 * qu'on les voie sans dézoomer.
 */
const CAPS: readonly (readonly [number, number])[] = [
  [1, -14], [13, -15], [15, -2], [2, 13], [-13, 15], [-15, 3],
  [8, -16], [-8, 16], [16, -8], [-16, 8], [20, -21], [-20, 21],
];

interface Decor {
  readonly key: string;
  readonly x: number;
  readonly y: number;
  readonly terre: boolean;
}

/**
 * Le monde au-delà de la carte.
 *
 * De l'eau, la même dalle que celle du plateau, et quelques îles au large
 * réduites à leur silhouette. Elles ne sont pas jouables et n'existent pas
 * pour le moteur : elles disent seulement que l'archipel continue.
 *
 * Sans elles la carte flottait sur un aplat beige et s'arrêtait net, comme
 * découpée aux ciseaux.
 */
function decorAutour(
  ids: ReadonlySet<string>,
  bornes: { minX: number; minY: number; maxX: number; maxY: number },
  marge: number,
): Decor[] {
  // Les terres lointaines, d'abord : on saura ensuite quelle case est terre.
  const terres = new Set<string>();
  let sommeQ = 0;
  let sommeR = 0;
  for (const id of ids) {
    const [q, r] = id.split(',').map(Number);
    sommeQ += q ?? 0;
    sommeR += r ?? 0;
  }
  const centreQ = Math.round(sommeQ / Math.max(1, ids.size));
  const centreR = Math.round(sommeR / Math.max(1, ids.size));

  CAPS.forEach(([dq, dr], index) => {
    // Chaque cap reçoit une silhouette différente, dans un ordre fixe : la
    // carte doit être la même à chaque rendu.
    const forme = SILHOUETTES[index % SILHOUETTES.length] ?? [];
    for (const [q, r] of forme) {
      terres.add(`${centreQ + dq + q},${centreR + dr + r}`);
    }
  });

  const out: Decor[] = [];
  const pasY = SIZE * 1.5;
  const rMin = Math.floor((bornes.minY - marge) / pasY);
  const rMax = Math.ceil((bornes.maxY + marge) / pasY);

  for (let r = rMin; r <= rMax; r++) {
    // La grille axiale est cisaillée : la plage de `q` dépend de la rangée.
    const decalage = r / 2;
    const qMin = Math.floor((bornes.minX - marge) / (SIZE * Math.sqrt(3)) - decalage);
    const qMax = Math.ceil((bornes.maxX + marge) / (SIZE * Math.sqrt(3)) - decalage);

    for (let q = qMin; q <= qMax; q++) {
      const key = `${q},${r}`;
      if (ids.has(key)) continue;
      const { x, y } = hexCenter(key);
      out.push({ key, x, y, terre: terres.has(key) });
    }
  }
  return out;
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
  const [fitScale, setFitScale] = useState(1);

  useLayoutEffect(() => {
    const element = frame.current;
    if (!element) return undefined;

    const fit = (): void => {
      const { width, height } = element.getBoundingClientRect();
      if (width === 0 || height === 0) return;
      setFitScale(Math.min(1, width / boardWidth, height / boardHeight));
    };

    fit();
    // La place change à la rotation du téléphone comme à l'ouverture d'un
    // panneau : on suit le conteneur plutôt que la fenêtre.
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [boardWidth, boardHeight]);

  /*
   * Navigation : la loupe et le déplacement.
   *
   * L'ajustement automatique montre tout le plateau, ce qui suffit pour se
   * repérer mais pas pour viser une arête entre deux colonies. Le joueur
   * ajuste donc lui-même — molette ou pincement pour l'échelle, glissement
   * pour le cadrage.
   */
  /**
   * Échelle et cadrage tenus ensemble.
   *
   * Séparés, zoomer demandait d'appeler `setPan` depuis l'updater de
   * `setZoom` — un effet de bord dans une fonction censée être pure, que
   * React rejoue et applique deux fois. Le geste répondait alors du double.
   */
  const [vue, setVue] = useState({ zoom: 1, x: 0, y: 0 });
  /** Pointeurs en cours, pour distinguer un glissement d'un pincement. */
  const pointeurs = useRef(new Map<number, { x: number; y: number }>());
  const ecart = useRef(0);
  /** A-t-on bougé ? Sans cela, un glissement finirait par poser une route. */
  const glisse = useRef(false);

  /*
   * On peut reculer bien au-delà du plateau.
   *
   * C'est ce qui donne son sens au décor : à l'échelle de lecture on voit la
   * carte jouable, et en reculant on découvre que l'archipel continue. Un
   * plancher à 0,75 ne montrait jamais rien de plus.
   */
  const ZOOM_MIN = 0.32;
  const ZOOM_MAX = 4;

  /** Zoome en gardant sous le doigt le point qu'on visait. */
  const zoomerVers = (facteur: number, cx: number, cy: number): void => {
    const cadre = frame.current?.getBoundingClientRect();
    if (!cadre) return;
    setVue((v) => {
      const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.zoom * facteur));
      const reel = zoom / v.zoom;
      // Le point visé, exprimé depuis le centre du cadre, reste immobile.
      const dx = cx - cadre.left - cadre.width / 2;
      const dy = cy - cadre.top - cadre.height / 2;
      return { zoom, x: dx - (dx - v.x) * reel, y: dy - (dy - v.y) * reel };
    });
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    zoomerVers(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX, event.clientY);
  };

  const onPointerDown = (event: PointerEvent): void => {
    pointeurs.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    glisse.current = false;
    if (pointeurs.current.size === 2) {
      const [a, b] = [...pointeurs.current.values()];
      if (a && b) ecart.current = Math.hypot(a.x - b.x, a.y - b.y);
    }
    /*
     * Surtout pas de capture ici.
     *
     * Capturer le pointeur dès l'appui détourne vers le cadre le clic qui
     * suit : l'emplacement visé ne le recevait jamais, et plus rien ne se
     * posait sur le plateau — ni route, ni colonie, ni voleur. La capture
     * n'est utile qu'une fois le glissement engagé, pour le suivre hors du
     * cadre ; elle est donc prise au premier mouvement, pas avant.
     */
  };

  const onPointerMove = (event: PointerEvent): void => {
    const avant = pointeurs.current.get(event.pointerId);
    if (!avant) return;
    const apres = { x: event.clientX, y: event.clientY };
    pointeurs.current.set(event.pointerId, apres);

    if (pointeurs.current.size >= 2) {
      const [a, b] = [...pointeurs.current.values()];
      if (!a || !b) return;
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (ecart.current > 0 && distance > 0) {
        glisse.current = true;
        zoomerVers(distance / ecart.current, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      ecart.current = distance;
      return;
    }

    const dx = apres.x - avant.x;
    const dy = apres.y - avant.y;
    // Quelques pixels de tolérance : un doigt n'est jamais parfaitement
    // immobile, et un clic ne doit pas devenir un glissement pour autant.
    if (!glisse.current && Math.abs(dx) + Math.abs(dy) > 3) {
      glisse.current = true;
      // Le déplacement commence : on suit le doigt même s'il sort du cadre.
      const cadre = event.currentTarget as HTMLElement;
      if (!cadre.hasPointerCapture(event.pointerId)) cadre.setPointerCapture(event.pointerId);
    }
    if (glisse.current) setVue((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  };

  const onPointerUp = (event: PointerEvent): void => {
    pointeurs.current.delete(event.pointerId);
    if (pointeurs.current.size >= 2) return;
    ecart.current = 0;
    if (pointeurs.current.size > 0) return;

    /*
     * On oublie le glissement au tour de boucle suivant.
     *
     * Le clic éventuel arrive juste après le relâchement, avant les
     * minuteurs : il sera donc bien intercepté. Mais un pincement ne produit
     * aucun clic, et sans cet oubli le drapeau restait levé — le prochain
     * geste du joueur, parfaitement immobile, était mangé pour rien.
     */
    setTimeout(() => { glisse.current = false; }, 0);
  };

  /** Un glissement ne pose rien : on intercepte le clic qui le suivrait. */
  const onClickCapture = (event: MouseEvent): void => {
    if (!glisse.current) return;
    event.stopPropagation();
    event.preventDefault();
    glisse.current = false;
  };

  const recentrer = (): void => setVue({ zoom: 1, x: 0, y: 0 });
  const deplace = vue.zoom !== 1 || vue.x !== 0 || vue.y !== 0;

  const scale = fitScale * vue.zoom;
  const decor = decorAutour(
    new Set(view.hexes.map((h) => h.id)),
    { minX, minY, maxX, maxY },
    SIZE * 24,
  );

  return (
    <div
      className="gc-board-fit"
      ref={frame}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onClickCapture={onClickCapture}
    >
    <div
      className="gc-board"
      style={{
        width: boardWidth,
        height: boardHeight,
        transform: `translate(${vue.x}px, ${vue.y}px) scale(${scale})`,
      }}
    >
      {/* Le large, derrière tout le reste : le plateau ne s'arrête pas net. */}
      {decor.map((tuile) => (
        <div
          key={`decor-${tuile.key}`}
          className={`gc-hex gc-hex-large${tuile.terre ? ' gc-hex-lointain' : ''}`}
          aria-hidden="true"
          style={{
            left: tuile.x - minX - width / 2,
            top: tuile.y - minY - height / 2,
            width,
            height,
            ...(tuile.terre ? {} : { backgroundImage: 'url(/assets/tiles/tile_sea.jpg)' }),
          }}
        />
      ))}
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

      {deplace && (
        <button className="gc-recentrer" onClick={recentrer} title="Revoir tout le plateau">
          Recentrer
        </button>
      )}
    </div>
  );
}
