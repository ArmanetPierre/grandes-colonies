/**
 * La géométrie du plateau, en trois dimensions.
 *
 * On garde la décision qui rendait l'ancien rendu presque gratuit : un sommet
 * **est** le trio d'hexagones qui s'y rejoignent, une arête **est** la paire
 * qu'elle sépare. Leur position dans la scène est donc le barycentre des
 * centres cités par leur identifiant — aucune table de correspondance, aucune
 * conversion, et l'unicité garantie par le moteur se transmet telle quelle.
 *
 * Le seul changement tient au repère. L'écran avait deux axes, la scène en a
 * trois : l'ancien `y` devient `z`, et `y` désigne désormais la hauteur. La
 * carte se lit donc à plat sur le sol, et tout ce qui dépasse — falaises,
 * maisons, jetons — s'élève sur l'axe qui n'existait pas.
 */

/**
 * Rayon du cercle circonscrit d'un hexagone, en unités de scène.
 *
 * Un, parce qu'aucune raison ne justifie autre chose : ce n'est plus un
 * nombre de pixels à négocier avec la lisibilité d'un jeton, c'est l'unité
 * dans laquelle tout le reste s'exprime. La caméra fait le travail que
 * faisait l'échelle.
 */
export const TAILLE = 1;

/** Épaisseur de la dalle de terre, entre le fond marin et sa surface. */
export const EPAISSEUR = 0.34;

/** Hauteur de la surface d'une tuile de terre — le sol sur lequel on bâtit. */
export const SOL = EPAISSEUR / 2;

/**
 * Le niveau moyen de la mer.
 *
 * Assez bas pour que la houle, qui monte et descend autour de lui, ne
 * dépasse jamais le haut des falaises. Ce qui flotte à sa surface ne se pose
 * pas à cette hauteur mais au-dessus de la crête : voir `SURFACE`.
 */
export const MER = -0.13;

export interface Point3 { readonly x: number; readonly z: number }

/**
 * Le centre d'un hexagone, depuis son identifiant axial `q,r`.
 *
 * L'hexagone est pointe en haut : les colonnes sont espacées de √3 et les
 * rangées de 3/2, la rangée impaire décalée d'une demi-colonne. C'est
 * exactement la disposition que produit `CylinderGeometry` à six segments,
 * ce qui évite d'avoir à la faire tourner.
 */
export function centreHex(id: string): Point3 {
  const [q, r] = id.split(',').map(Number);
  return {
    x: TAILLE * Math.sqrt(3) * ((q ?? 0) + (r ?? 0) / 2),
    z: TAILLE * 1.5 * (r ?? 0),
  };
}

/** Barycentre des hexagones cités dans une clé de sommet ou d'arête. */
export function barycentre(cle: string): Point3 {
  const centres = cle.split('|').map(centreHex);
  const somme = centres.reduce((acc, c) => ({ x: acc.x + c.x, z: acc.z + c.z }), { x: 0, z: 0 });
  return { x: somme.x / centres.length, z: somme.z / centres.length };
}

/**
 * La rotation qui couche une pièce dans l'axe d'une arête.
 *
 * L'arête est perpendiculaire à la ligne qui joint les deux centres. Reste à
 * traduire cela en rotation autour de la verticale, et le repère de Three.js
 * y met un piège : tourner de θ autour de `y` envoie l'axe X sur
 * `(cos θ, 0, −sin θ)` — le sens des `z` est inversé par rapport à
 * l'intuition. Résoudre l'égalité donne `−(φ + π/2)`, et non `φ + π/2`.
 *
 * Le calcul est fait ici plutôt qu'à l'appel : oublier ce signe une seule
 * fois pose toutes les routes en travers de leur arête, et le symptôme
 * ressemble à une erreur de géométrie alors que c'est une erreur de repère.
 */
export function rotationArete(cle: string): number {
  const [a, b] = cle.split('|').map(centreHex);
  if (!a || !b) return 0;
  return -(Math.atan2(b.z - a.z, b.x - a.x) + Math.PI / 2);
}

/** Un sommet appartient-il à au moins un hexagone de cette liste ? */
export function touche(cle: string, hexes: ReadonlySet<string>): boolean {
  return cle.split('|').some((id) => hexes.has(id));
}

export interface Bornes {
  readonly minX: number; readonly maxX: number;
  readonly minZ: number; readonly maxZ: number;
  readonly centreX: number; readonly centreZ: number;
  /** Demi-diagonale : de quoi cadrer le plateau entier d'un seul coup. */
  readonly rayon: number;
}

/** L'emprise au sol du plateau jouable, pour cadrer la caméra. */
export function bornes(ids: readonly string[]): Bornes {
  if (ids.length === 0) {
    return { minX: -1, maxX: 1, minZ: -1, maxZ: 1, centreX: 0, centreZ: 0, rayon: 1 };
  }
  const centres = ids.map(centreHex);
  const xs = centres.map((c) => c.x);
  const zs = centres.map((c) => c.z);
  const minX = Math.min(...xs) - TAILLE;
  const maxX = Math.max(...xs) + TAILLE;
  const minZ = Math.min(...zs) - TAILLE;
  const maxZ = Math.max(...zs) + TAILLE;
  return {
    minX, maxX, minZ, maxZ,
    centreX: (minX + maxX) / 2,
    centreZ: (minZ + maxZ) / 2,
    rayon: Math.hypot(maxX - minX, maxZ - minZ) / 2,
  };
}

/**
 * Les silhouettes des îles du large.
 *
 * Reprises telles quelles de l'ancien plateau, et pour la même raison :
 * taillées sur le même anneau, elles se lisaient comme six exemplaires du
 * même tampon. Une côte n'a pas deux fois la même découpe, et c'est ce qui
 * fait croire à un monde plutôt qu'à un motif.
 */
const SILHOUETTES: readonly (readonly (readonly [number, number])[])[] = [
  [[0, 0], [1, 0], [2, 0], [-1, 1], [2, 1], [-1, 2], [0, 2], [1, 2]],
  [[0, 0], [1, -1], [2, -2], [3, -2], [-1, 1], [-1, 0]],
  [[0, 0], [1, 0]],
  [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 1], [2, 0], [0, -1], [1, -1], [-1, 2]],
  [[0, 0], [1, 1], [2, 2], [3, 2]],
  [[0, 0], [1, 0], [2, 0], [0, 1], [2, 1], [0, 2], [1, 2], [2, 2]],
  [[0, 0], [2, 0], [1, 1]],
  [[0, 0], [1, 0], [0, 1], [0, 2], [1, 1]],
];

/**
 * Où poser les terres du large : autour du plateau, à une quinzaine
 * d'hexagones de son centre. Assez loin pour qu'on ne les confonde jamais
 * avec des îles jouables, assez près pour qu'on les voie sans reculer.
 */
const CAPS: readonly (readonly [number, number])[] = [
  [1, -14], [13, -15], [15, -2], [2, 13], [-13, 15], [-15, 3],
  [8, -16], [-8, 16], [16, -8], [-16, 8], [20, -21], [-20, 21],
];

/**
 * Les îles du large, en positions de scène.
 *
 * Elles ne sont pas jouables et n'existent pas pour le moteur : elles disent
 * seulement que l'archipel continue. Sans elles, la carte flottait sur un
 * aplat et s'arrêtait net, comme découpée aux ciseaux. La brume de distance
 * fait ici le travail que faisait le dégradé du cadre.
 */
export function ilesDuLarge(ids: ReadonlySet<string>): Point3[] {
  let sommeQ = 0;
  let sommeR = 0;
  for (const id of ids) {
    const [q, r] = id.split(',').map(Number);
    sommeQ += q ?? 0;
    sommeR += r ?? 0;
  }
  const centreQ = Math.round(sommeQ / Math.max(1, ids.size));
  const centreR = Math.round(sommeR / Math.max(1, ids.size));

  const cles = new Set<string>();
  CAPS.forEach(([dq, dr], index) => {
    // Chaque cap reçoit une silhouette différente, dans un ordre fixe : la
    // carte doit être la même à chaque rendu.
    const forme = SILHOUETTES[index % SILHOUETTES.length] ?? [];
    for (const [q, r] of forme) cles.add(`${centreQ + dq + q},${centreR + dr + r}`);
  });

  const out: Point3[] = [];
  for (const cle of cles) {
    if (ids.has(cle)) continue;
    out.push(centreHex(cle));
  }
  return out;
}
