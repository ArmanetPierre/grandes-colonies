/**
 * Coordonnées axiales pour hexagones « pointe en haut ».
 *
 * Les tuiles générées sont découpées en hexagones pointe en haut (voir
 * SPEC_ASSETS_IMAGES.md), donc le moteur adopte la même orientation.
 *
 * Référence : https://www.redblobgames.com/grids/hexagons/
 */

export interface Axial {
  readonly q: number;
  readonly r: number;
}

/**
 * Les six voisins, dans le sens horaire en partant du nord-ouest.
 *
 * L'ordre n'est pas décoratif : il est ce qui permet de nommer sommets et
 * arêtes sans second système de coordonnées. Deux directions consécutives
 * encadrent exactement un coin de l'hexagone (voir `cornerHexes`).
 */
export const DIRECTIONS = [
  { q: 0, r: -1 },   // NO
  { q: 1, r: -1 },   // NE
  { q: 1, r: 0 },    // E
  { q: 0, r: 1 },    // SE
  { q: -1, r: 1 },   // SO
  { q: -1, r: 0 },   // O
] as const satisfies readonly Axial[];

export type Direction = 0 | 1 | 2 | 3 | 4 | 5;

export const DIRECTION_NAMES = ['NO', 'NE', 'E', 'SE', 'SO', 'O'] as const;

export function add(a: Axial, b: Axial): Axial {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function equals(a: Axial, b: Axial): boolean {
  return a.q === b.q && a.r === b.r;
}

/** Clé canonique d'un hexagone. Stable, comparable, sérialisable. */
export function hexKey(h: Axial): string {
  return `${h.q},${h.r}`;
}

export function parseHexKey(key: string): Axial {
  const [q, r] = key.split(',');
  if (q === undefined || r === undefined) throw new Error(`Clé d'hexagone invalide : ${key}`);
  return { q: Number(q), r: Number(r) };
}

/** Le voisin dans une direction donnée. */
export function neighbor(h: Axial, direction: Direction): Axial {
  return add(h, DIRECTIONS[direction]);
}

/** Les six voisins, dans l'ordre des directions. */
export function neighbors(h: Axial): Axial[] {
  return DIRECTIONS.map((d) => add(h, d));
}

/**
 * Les trois hexagones qui se touchent au coin `corner` de `h`.
 *
 * Un coin est encadré par deux directions consécutives : le coin 0 (nord)
 * est partagé avec les voisins NO et NE, le coin 1 (nord-est) avec NE et E,
 * et ainsi de suite.
 */
export function cornerHexes(h: Axial, corner: Direction): [Axial, Axial, Axial] {
  const next = ((corner + 1) % 6) as Direction;
  return [h, neighbor(h, corner), neighbor(h, next)];
}

/**
 * Distance en nombre d'hexagones. Utile pour générer un plateau circulaire
 * et pour les règles de portée.
 */
export function distance(a: Axial, b: Axial): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dq + dr) + Math.abs(dr)) / 2;
}

/** Tous les hexagones à `radius` ou moins de `center`, centre compris. */
export function hexesWithin(center: Axial, radius: number): Axial[] {
  const out: Axial[] = [];
  for (let q = -radius; q <= radius; q++) {
    const from = Math.max(-radius, -q - radius);
    const to = Math.min(radius, -q + radius);
    for (let r = from; r <= to; r++) {
      out.push({ q: center.q + q, r: center.r + r });
    }
  }
  return out;
}

/**
 * Projection en pixels, pour le rendu uniquement — le moteur n'en dépend
 * jamais. `size` est le rayon du cercle circonscrit (centre → coin).
 */
export function toPixel(h: Axial, size: number): { x: number; y: number } {
  return {
    x: size * Math.sqrt(3) * (h.q + h.r / 2),
    y: size * (3 / 2) * h.r,
  };
}
