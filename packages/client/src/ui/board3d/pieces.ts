/**
 * Les volumes posés sur la carte.
 *
 * Chaque pièce est fabriquée une fois et fusionnée en une géométrie unique,
 * parce que toutes seront rendues par instanciation : une maison n'est pas un
 * objet de la scène mais une matrice dans un tampon, et un tampon ne sait
 * porter qu'une géométrie. C'est ce qui permet d'afficher les deux cents
 * pièces d'une partie à douze en une poignée d'appels de dessin.
 *
 * Les silhouettes comptent plus que le détail. À la distance de lecture, une
 * colonie fait douze pixels de haut : ce qui la distingue d'une ville n'est
 * pas sa texture, c'est sa masse et son profil. Elles sont donc dessinées
 * pour être reconnues de loin, et supporter qu'on s'approche.
 */

import {
  BoxGeometry, type BufferGeometry, CircleGeometry, CylinderGeometry, LatheGeometry,
  RingGeometry, TorusGeometry, Vector2,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Fusionne en plaçant chaque morceau, et abandonne les pièces détachées. */
function assembler(
  morceaux: readonly { geo: BufferGeometry; x?: number; y?: number; z?: number; rx?: number; ry?: number; rz?: number }[],
): BufferGeometry {
  const places = morceaux.map(({ geo, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0 }) => {
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    if (rz) geo.rotateZ(rz);
    geo.translate(x, y, z);
    return geo;
  });
  const total = mergeGeometries(places, false);
  for (const geo of places) geo.dispose();
  if (!total) throw new Error('Géométrie impossible à fusionner');
  total.computeVertexNormals();
  return total;
}

/**
 * La colonie : un corps de logis et son toit.
 *
 * La plus petite pièce du jeu, et la plus nombreuse. Son toit en pyramide
 * suffit à la faire lire comme une habitation là où un simple cube se serait
 * confondu avec un jeton.
 */
export function geoColonie(): BufferGeometry {
  return assembler([
    { geo: new BoxGeometry(0.30, 0.20, 0.28), y: 0.10 },
    // Le toit déborde légèrement des murs : sans avancée de toiture, la
    // pyramide se lisait comme la pointe d'un cristal, pas comme un toit.
    { geo: new CylinderGeometry(0, 0.25, 0.20, 4), y: 0.30, ry: Math.PI / 4 },
  ]);
}

/**
 * La ville : deux corps de bâtiment et une tour.
 *
 * Elle double la production d'une colonie, et sa silhouette double son
 * volume. La tour est ce qui la distingue à la distance où le toit d'une
 * colonie n'est plus qu'un point.
 */
export function geoVille(): BufferGeometry {
  return assembler([
    { geo: new BoxGeometry(0.42, 0.22, 0.32), y: 0.11 },
    { geo: new BoxGeometry(0.26, 0.20, 0.26), x: 0.07, y: 0.32 },
    { geo: new CylinderGeometry(0, 0.22, 0.16, 4), x: 0.07, y: 0.50, ry: Math.PI / 4 },
    { geo: new CylinderGeometry(0.09, 0.10, 0.44, 8), x: -0.14, y: 0.22 },
    { geo: new CylinderGeometry(0, 0.12, 0.14, 8), x: -0.14, y: 0.51 },
  ]);
}

/**
 * La métropole : la ville, fortifiée.
 *
 * Un donjon central et quatre tours d'angle. C'est la pièce la plus chère du
 * jeu et elle doit se voir comme telle : à douze joueurs, repérer d'un coup
 * d'œil qui a déjà bâti sa métropole change la façon dont on négocie.
 */
export function geoMetropole(): BufferGeometry {
  const tours = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({
    geo: new CylinderGeometry(0.075, 0.085, 0.40, 8),
    x: sx * 0.20, y: 0.20, z: sz * 0.16,
  })));
  const toits = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => ({
    geo: new CylinderGeometry(0, 0.10, 0.13, 8),
    x: sx * 0.20, y: 0.465, z: sz * 0.16,
  })));
  return assembler([
    { geo: new BoxGeometry(0.50, 0.16, 0.40), y: 0.08 },
    ...tours,
    ...toits,
    { geo: new BoxGeometry(0.24, 0.34, 0.24), y: 0.33 },
    { geo: new CylinderGeometry(0, 0.21, 0.18, 4), y: 0.59, ry: Math.PI / 4 },
  ]);
}

/**
 * Le monument : une colonne sur son socle.
 *
 * Il ne produit rien et ne bloque rien — il ne vaut que ses deux points de
 * victoire. Il est donc vertical et sans toit : rien dans sa forme ne
 * suggère qu'on y habite ou qu'on s'y défend.
 */
export function geoMonument(): BufferGeometry {
  return assembler([
    { geo: new BoxGeometry(0.30, 0.07, 0.30), y: 0.035 },
    { geo: new BoxGeometry(0.23, 0.05, 0.23), y: 0.095 },
    { geo: new CylinderGeometry(0.075, 0.10, 0.52, 10), y: 0.38 },
    { geo: new CylinderGeometry(0.13, 0.13, 0.05, 10), y: 0.665 },
    { geo: new CylinderGeometry(0, 0.11, 0.16, 10), y: 0.77 },
  ]);
}

/**
 * La route : une poutre biseautée.
 *
 * Un prisme à six pans couché est la façon la moins chère d'obtenir un
 * chanfrein : la lumière accroche ses arêtes, là où une simple boîte
 * restait un rectangle plat quelle que soit la lumière.
 */
export function geoRoute(): BufferGeometry {
  return assembler([
    { geo: new CylinderGeometry(0.085, 0.085, 0.84, 6), rz: Math.PI / 2 },
  ]);
}

/**
 * La route maritime : un radeau plutôt qu'une poutre.
 *
 * Plus large, plus plate, posée au ras de l'eau. Elle relie les mêmes
 * sommets qu'une route mais ne se confond pas avec elle : sur un archipel où
 * les deux coexistent, savoir laquelle on regarde décide d'un tour.
 */
export function geoRouteMaritime(): BufferGeometry {
  const planches = [-1, 0, 1].map((i) => ({
    geo: new BoxGeometry(0.80, 0.045, 0.085),
    z: i * 0.105,
  }));
  return assembler([
    ...planches,
    { geo: new BoxGeometry(0.10, 0.05, 0.34), x: -0.28, y: 0.03 },
    { geo: new BoxGeometry(0.10, 0.05, 0.34), x: 0.28, y: 0.03 },
  ]);
}

/**
 * Le voleur : un pion tourné.
 *
 * Une révolution plutôt qu'un assemblage — c'est la seule pièce dont la
 * forme n'a pas à évoquer un bâtiment, et un profil au tour donne la
 * silhouette de pion que tout joueur reconnaît sans légende.
 */
export function geoVoleur(): BufferGeometry {
  const profil = [
    new Vector2(0.00, 0.00), new Vector2(0.15, 0.00), new Vector2(0.155, 0.045),
    new Vector2(0.11, 0.075), new Vector2(0.085, 0.16), new Vector2(0.095, 0.27),
    new Vector2(0.13, 0.335), new Vector2(0.115, 0.375), new Vector2(0.06, 0.41),
    new Vector2(0.00, 0.425),
  ];
  const geo = new LatheGeometry(profil, 16);
  geo.computeVertexNormals();
  return geo;
}

/** Le disque d'un jeton : légèrement conique, pour que la tranche accroche. */
export function geoJeton(): BufferGeometry {
  return new CylinderGeometry(0.40, 0.43, 0.075, 28);
}

/** La face d'un jeton, où s'imprime le nombre : un simple disque à plat. */
export function geoFaceJeton(): BufferGeometry {
  const geo = new CircleGeometry(0.40, 28);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * L'anneau d'un emplacement proposé.
 *
 * Le plateau plat le signalait par une pastille. En volume il faut un
 * anneau : posé à plat sur la tuile, il reste lisible sous n'importe quel
 * angle de caméra, là où une pastille pleine disparaissait sous la pièce
 * qu'on s'apprête à poser.
 */
export function geoAnneau(): BufferGeometry {
  /*
   * Plus large que le bâtiment qu'il entoure.
   *
   * Un emplacement de ville se propose sur une colonie déjà bâtie : un
   * anneau serré passait sous l'avancée du toit, dont la base mesure 0,25,
   * et disparaissait entièrement. Le joueur lisait « 2 emplacements » dans
   * la barre d'actions sans en voir un seul sur la carte.
   *
   * Le rayon reste bien en deçà d'un demi-côté d'hexagone : deux sommets
   * voisins sont distants de 1, et leurs anneaux ne se touchent pas.
   */
  const geo = new RingGeometry(0.30, 0.46, 28);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Le fantôme d'une route proposée : la poutre, en plus mince. */
export function geoFantomeRoute(): BufferGeometry {
  return assembler([
    { geo: new CylinderGeometry(0.075, 0.075, 0.80, 6), rz: Math.PI / 2 },
  ]);
}

/**
 * L'anneau d'une annonce.
 *
 * Plus grand que celui d'un emplacement proposé, et porté à la couleur de
 * qui l'a faite : deux joueurs qui visent le même sommet doivent voir que
 * l'annonce est contestée avant la fin du cycle, pas après.
 */
export function geoAnneauAnnonce(): BufferGeometry {
  const geo = new TorusGeometry(0.30, 0.028, 8, 28);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * La cible d'un clic, plus large que ce qu'elle sert.
 *
 * Un pouce fait dix millimètres, un sommet en fait deux. Ces volumes ne sont
 * jamais dessinés — ils n'existent que pour être touchés, et leur générosité
 * est ce qui rend le plateau jouable sur téléphone.
 */
export function geoCible(): BufferGeometry {
  const geo = new CylinderGeometry(0.34, 0.34, 0.5, 8);
  return geo;
}

/** La cible d'une arête : allongée dans l'axe de la route. */
export function geoCibleArete(): BufferGeometry {
  return new BoxGeometry(0.8, 0.5, 0.34);
}

/**
 * L'anneau de poussière soulevé quand une pièce atterrit.
 *
 * Un disque à plat, qui portera la même image douce que l'écume : c'est le
 * même objet — un halo sans contour — et lui en fabriquer un second n'aurait
 * rien changé à ce qu'on voit.
 */
export function geoPoussiere(): BufferGeometry {
  const geo = new CircleGeometry(0.55, 20);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/** Le disque d'écume, posé au ras de l'eau sous chaque terre. */
export function geoEcume(): BufferGeometry {
  const geo = new CircleGeometry(1.42, 24);
  geo.rotateX(-Math.PI / 2);
  return geo;
}
