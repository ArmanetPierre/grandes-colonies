/**
 * Le relief des terres.
 *
 * Une tuile n'est plus une dalle plate qui porte une image de montagne :
 * c'est une montagne. Le sommet se soulève, les collines bombent, les champs
 * ondulent à peine — et la lumière rasante fait le reste.
 *
 * Toute la difficulté tient en une phrase : **le bord d'une tuile ne bouge
 * presque pas, son centre bouge beaucoup.** Les routes courent sur les arêtes
 * et les colonies se posent sur les sommets, c'est-à-dire exactement là où
 * trois tuiles se rejoignent ; donner à chaque terrain sa propre altitude de
 * bord aurait transformé le réseau routier en escalier, avec des routes
 * suspendues au-dessus du champ voisin. Le dénivelé entre deux bords reste
 * donc sous un dixième de rayon d'hexagone — moins que l'épaisseur d'une
 * route — tandis que le bombement central va jusqu'à la moitié d'un rayon.
 *
 * L'altitude se calcule sur l'anneau de subdivision et non sur la distance
 * réelle au centre. C'est ce qui garantit que le bord est *exactement* à
 * zéro tout du long : une tuile ne peut donc pas laisser voir un jour sous
 * sa voisine, quel que soit le profil qu'on lui donne.
 */

import { BufferAttribute, BufferGeometry } from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Un dôme lisse : pente nulle au centre comme au bord. */
const dome = (t: number): number => Math.cos((t * Math.PI) / 2) ** 2;

/**
 * Un pic à sommet aplati.
 *
 * Le plateau du sommet n'est pas une coquetterie : c'est là que se pose le
 * jeton numéroté, et un jeton en équilibre sur une pointe se lit mal.
 */
const pic = (t: number): number => {
  const PLATEAU = 0.22;
  if (t <= PLATEAU) return 1;
  return (1 - (t - PLATEAU) / (1 - PLATEAU)) ** 1.7;
};

/** Une croupe : le dôme creusé d'un cran, pour que les collines n'en soient pas. */
const croupe = (t: number): number => dome(t) * (0.72 + 0.28 * Math.cos(t * Math.PI * 2));

export interface Profil {
  /** De combien le bord de la tuile monte au-dessus du niveau commun. */
  readonly base: number;
  /** De combien le centre monte au-dessus du bord. */
  readonly crete: number;
  readonly forme: (t: number) => number;
}

/**
 * Ce que chaque terrain fait de son relief.
 *
 * Les valeurs suivent ce que la tuile représente, pas une échelle réelle :
 * une montagne de Catan tient dans la main, et ce qu'on lui demande est
 * d'être reconnaissable de trois quarts, à la distance où l'on lit un jeton.
 */
const PROFILS: Readonly<Record<string, Profil>> = {
  mountain: { base: 0.10, crete: 0.44, forme: pic },
  hills: { base: 0.06, crete: 0.20, forme: croupe },
  gold: { base: 0.05, crete: 0.16, forme: pic },
  forest: { base: 0.04, crete: 0.13, forme: dome },
  desert: { base: 0.01, crete: 0.10, forme: croupe },
  pasture: { base: 0.02, crete: 0.08, forme: dome },
  field: { base: 0.01, crete: 0.05, forme: dome },
  unexplored: { base: 0.04, crete: 0.08, forme: dome },
  fish: { base: 0.00, crete: 0.03, forme: dome },
};

const PLAT: Profil = { base: 0, crete: 0, forme: () => 0 };

export function profilDe(terrain: string): Profil {
  return PROFILS[terrain] ?? PLAT;
}

/** L'altitude du bord d'une tuile, au-dessus du niveau commun des terres. */
export function baseDe(terrain: string): number {
  return profilDe(terrain).base;
}

/** L'altitude de son point le plus haut : là où se posent jeton et voleur. */
export function sommetDe(terrain: string): number {
  const profil = profilDe(terrain);
  return profil.base + profil.crete * profil.forme(0);
}

/**
 * L'altitude d'un point de la tuile, à `t` du centre vers le bord.
 *
 * Le voleur ne se tient pas au centre — il partagerait la place du jeton —
 * mais un peu de côté. Le poser à l'altitude du sommet le ferait flotter
 * au-dessus de la pente ; il faut donc savoir ce que vaut le terrain là où
 * ses pieds se posent.
 */
export function hauteurRelative(terrain: string, t: number): number {
  const profil = profilDe(terrain);
  return profil.base + profil.crete * profil.forme(Math.min(1, Math.max(0, t)));
}

/** Finesse de la subdivision. Dix anneaux : six cents triangles, invisibles à l'œil. */
const ANNEAUX = 10;

/**
 * La surface sculptée d'une tuile.
 *
 * Six secteurs triangulaires subdivisés, du centre vers chaque côté. Les
 * secteurs partagent leurs bords en double, puis `mergeVertices` les recoud :
 * sans cette couture, chaque rayon de l'hexagone porterait une arête de
 * lumière, les normales étant calculées séparément de part et d'autre.
 */
export function geoRelief(terrain: string, rayon: number): BufferGeometry {
  const { crete, forme } = profilDe(terrain);

  // L'hexagone pointe en haut : un sommet dans l'axe des `z`, comme le prisme
  // qui le porte et comme la maille du plateau.
  const coins = Array.from({ length: 6 }, (_, k) => ({
    x: rayon * Math.sin((k * Math.PI) / 3),
    z: rayon * Math.cos((k * Math.PI) / 3),
  }));

  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];

  for (let k = 0; k < 6; k++) {
    const a = coins[k]!;
    const b = coins[(k + 1) % 6]!;
    const depart = positions.length / 3;

    // Un secteur : le centre, puis `ANNEAUX` rangées jusqu'au côté.
    for (let i = 0; i <= ANNEAUX; i++) {
      for (let j = 0; j <= i; j++) {
        const versA = (i - j) / ANNEAUX;
        const versB = j / ANNEAUX;
        const x = a.x * versA + b.x * versB;
        const z = a.z * versA + b.z * versB;
        positions.push(x, crete * forme(i / ANNEAUX), z);
        // Le même placage que la face plate qu'on remplace : l'image reste
        // inscrite dans l'hexagone, sans décalage d'une tuile à l'autre.
        uvs.push((x / rayon + 1) / 2, (1 - z / rayon) / 2);
      }
    }

    const rang = (i: number, j: number): number => depart + (i * (i + 1)) / 2 + j;
    for (let i = 0; i < ANNEAUX; i++) {
      for (let j = 0; j <= i; j++) {
        index.push(rang(i, j), rang(i + 1, j), rang(i + 1, j + 1));
        if (j < i) index.push(rang(i, j), rang(i + 1, j + 1), rang(i, j + 1));
      }
    }
  }

  const geo = new BufferGeometry();
  geo.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geo.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geo.setIndex(index);

  const cousue = mergeVertices(geo);
  geo.dispose();
  cousue.computeVertexNormals();
  return cousue;
}

/**
 * Une orientation stable, tirée de l'identifiant d'une tuile.
 *
 * Huit montagnes taillées dans la même géométrie se lisent comme huit
 * exemplaires du même tampon. On les fait tourner d'un multiple de soixante
 * degrés — la seule rotation qui laisse un hexagone à sa place — ce qui suffit
 * à casser la répétition sans coûter une géométrie de plus.
 *
 * Tirée de l'identifiant et non du hasard : la carte doit être la même à
 * chaque rendu, et deux joueurs doivent voir le même monde.
 */
export function orientationDe(id: string): number {
  let empreinte = 0;
  for (const caractere of id) empreinte = (empreinte * 31 + caractere.charCodeAt(0)) >>> 0;
  return ((empreinte % 6) * Math.PI) / 3;
}
