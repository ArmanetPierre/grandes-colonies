/**
 * Les images de la scène qui ne viennent pas d'un fichier.
 *
 * Les tuiles de terrain sont peintes et chargées telles quelles. Tout le
 * reste — jetons numérotés, panneaux de port, écume, croix des emplacements
 * gelés — est dessiné à l'exécution sur un canevas.
 *
 * C'est plus qu'une commodité. Ces motifs doivent rester nets quand le joueur
 * s'approche, et un jeton dessiné à cinq cents pixels de côté le reste
 * jusqu'au zoom maximum ; un fichier aurait figé sa définition et sa couleur.
 * Ils sont aussi les seuls éléments dont le texte doit suivre les données du
 * moteur : un jeton porte son nombre, un port son taux.
 */

import {
  CanvasTexture, LinearFilter, LinearMipmapLinearFilter, SRGBColorSpace,
  type Texture, TextureLoader,
} from 'three';

/** Côté du canevas des jetons et panneaux : net jusqu'au zoom maximum. */
const DEFINITION = 512;

function canevas(taille = DEFINITION): { toile: HTMLCanvasElement; ctx: CanvasRenderingContext2D } | undefined {
  const toile = document.createElement('canvas');
  toile.width = taille;
  toile.height = taille;
  const ctx = toile.getContext('2d');
  if (!ctx) return undefined;
  return { toile, ctx };
}

function enTexture(toile: HTMLCanvasElement): CanvasTexture {
  const texture = new CanvasTexture(toile);
  texture.colorSpace = SRGBColorSpace;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 8;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Un jeton numéroté, vu de dessus.
 *
 * Le disque est en pierre claire ; le nombre et ses pastilles de probabilité
 * passent au rouge sur 6 et 8. C'est la convention du jeu de plateau, et la
 * seule information de la carte qu'un joueur lit à chaque lancer : elle doit
 * se distinguer sans qu'on ait à s'approcher.
 */
export function textureJeton(valeur: number): Texture | undefined {
  const c = canevas();
  if (!c) return undefined;
  const { toile, ctx } = c;
  const m = DEFINITION / 2;
  const chaud = valeur === 6 || valeur === 8;

  // La pierre : un dégradé radial plutôt qu'un aplat, pour que le disque
  // paraisse bombé une fois éclairé de biais.
  const pierre = ctx.createRadialGradient(m * 0.8, m * 0.75, m * 0.1, m, m, m);
  pierre.addColorStop(0, '#F6EFE0');
  pierre.addColorStop(0.72, '#E7DCC6');
  pierre.addColorStop(1, '#C9BB9E');
  ctx.fillStyle = pierre;
  ctx.beginPath();
  ctx.arc(m, m, m * 0.96, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(90, 74, 48, .55)';
  ctx.lineWidth = DEFINITION * 0.022;
  ctx.stroke();

  const encre = chaud ? '#A3271B' : '#332A1E';
  ctx.fillStyle = encre;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${DEFINITION * (valeur >= 10 ? 0.44 : 0.52)}px Georgia, "Times New Roman", serif`;
  ctx.fillText(String(valeur), m, m - DEFINITION * 0.05);

  /*
   * Les pastilles de probabilité.
   *
   * Autant que de façons de faire le nombre avec deux dés : six pour le 7,
   * une pour le 2. Elles disent d'un coup d'œil ce que le nombre seul oblige
   * à calculer, et c'est sur elles qu'on choisit une colonie.
   */
  const chances = 6 - Math.abs(7 - valeur);
  const rayon = DEFINITION * 0.026;
  const pas = rayon * 3;
  const depart = m - (pas * (chances - 1)) / 2;
  for (let i = 0; i < chances; i++) {
    ctx.beginPath();
    ctx.arc(depart + i * pas, m + DEFINITION * 0.29, rayon, 0, Math.PI * 2);
    ctx.fill();
  }

  return enTexture(toile);
}

/** Ce qu'un port annonce : son taux, et la marchandise s'il en exige une. */
const MARCHANDISE: Readonly<Record<string, string>> = {
  wood: 'Bois', brick: 'Argile', wool: 'Laine', grain: 'Blé', ore: 'Minerai',
  merchant: 'Marchand', generic: 'Tout',
  // Les deux ports à contrat du §11 : leur ligne du bas dit l'échange entier,
  // parce que leur taux seul ne suffit pas à les distinguer d'un 2:1 ordinaire.
  mining: 'Minerai → Or', commercial: 'Deux sortes',
};

/**
 * Le gros chiffre du panneau.
 *
 * Le port générique prend trois cartes, tous les autres deux. Ce n'est donc
 * pas le taux qui distingue les ports à contrat — c'est la ligne du dessous,
 * et c'est pour cela qu'elle porte l'échange en toutes lettres.
 */
const TAUX: Readonly<Record<string, string>> = { generic: '3:1' };

/**
 * Le panneau d'un port.
 *
 * Une planche clouée, lisible de loin : le taux en gros, la marchandise en
 * petit. Un port générique prend trois ressources pour une, les autres deux.
 */
export function texturePort(kind: string): Texture | undefined {
  const c = canevas(256);
  if (!c) return undefined;
  const { toile, ctx } = c;
  const T = 256;
  const taux = TAUX[kind] ?? '2:1';

  ctx.clearRect(0, 0, T, T);
  // La planche n'occupe pas tout le carré : le reste est transparent, ce qui
  // évite un rectangle plein flottant au-dessus de la mer.
  const h = T * 0.56;
  const y = (T - h) / 2;
  ctx.fillStyle = '#8A6A42';
  ctx.strokeStyle = '#3E2E1C';
  ctx.lineWidth = 7;
  ctx.beginPath();
  ctx.roundRect(T * 0.06, y, T * 0.88, h, 14);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#FBF3E2';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `700 ${T * 0.3}px Georgia, serif`;
  ctx.fillText(taux, T / 2, y + h * 0.36);
  const legende = MARCHANDISE[kind] ?? kind;
  // « Minerai → Or » est deux fois plus long que « Blé » : à taille fixe il
  // débordait de la planche et se faisait couper par la transparence.
  const corps = legende.length > 9 ? T * 0.098 : T * 0.13;
  ctx.font = `600 ${corps}px "Helvetica Neue", Arial, sans-serif`;
  ctx.fillText(legende, T / 2, y + h * 0.74);

  return enTexture(toile);
}

/**
 * L'écume des côtes.
 *
 * Un anneau clair posé au ras de l'eau sous chaque terre. La mer et la
 * falaise se rencontraient sur une arête nette qui trahissait la maquette ;
 * l'écume donne à cette rencontre l'épaisseur qu'elle a dans le monde.
 */
export function textureEcume(): Texture | undefined {
  const c = canevas(256);
  if (!c) return undefined;
  const { toile, ctx } = c;
  const m = 128;
  const degrade = ctx.createRadialGradient(m, m, m * 0.55, m, m, m);
  degrade.addColorStop(0, 'rgba(255,255,255,0)');
  degrade.addColorStop(0.52, 'rgba(233,247,255,.5)');
  degrade.addColorStop(0.78, 'rgba(255,255,255,.28)');
  degrade.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, 256, 256);
  return enTexture(toile);
}

/** La croix d'un emplacement gelé — une règle qu'aucun dessin ne dirait. */
export function textureGel(): Texture | undefined {
  const c = canevas(128);
  if (!c) return undefined;
  const { toile, ctx } = c;
  ctx.strokeStyle = '#EDF4FF';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.shadowColor = 'rgba(20,40,70,.9)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(34, 34); ctx.lineTo(94, 94);
  ctx.moveTo(94, 34); ctx.lineTo(34, 94);
  ctx.stroke();
  return enTexture(toile);
}

/**
 * Les tuiles peintes, chargées une fois pour toutes.
 *
 * Le cache est global au module et non au plateau : une partie qui se
 * relance, ou un plateau qui se remonte après un changement de taille, ne
 * doit pas repayer le chargement de dix images d'un demi-méga-octet.
 */
const chargeur = new TextureLoader();
const cache = new Map<string, Texture>();

export function textureTerrain(terrain: string): Texture {
  const connue = cache.get(terrain);
  if (connue) return connue;
  const texture = chargeur.load(`/assets/tiles/tile_${terrain}.jpg`);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(terrain, texture);
  return texture;
}
