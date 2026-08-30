/**
 * Les deux décisions d'un geste.
 *
 * Elles vivent ici, hors de la scène, parce qu'elles sont fausses de façon
 * silencieuse : rien à l'écran ne dit qu'un appui a été pris pour un
 * glissement, ni qu'une rotation a franchi une discontinuité. Séparées, elles
 * se vérifient sans WebGL et sans téléphone.
 *
 * Les deux bugs qu'elles corrigent ont été rapportés de la première soirée :
 * « déplacer le voleur ne fonctionne pas toujours, malgré l'appui sur la
 * zone » et « zoomer et faire tourner l'île fonctionne que dans un sens et à
 * l'envers ».
 */

/** Un point de l'écran, en pixels CSS. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * Dérive tolérée entre le doigt qui se pose et le doigt qui se lève, au-delà
 * de laquelle l'appui devient un glissement.
 *
 * Trois pixels conviennent à une souris, qui ne bouge pas toute seule. Ils ne
 * conviennent pas à un doigt : la pulpe s'étale à mesure qu'elle appuie, le
 * barycentre du contact se déplace, et l'écran rapporte cette dérive comme un
 * mouvement. Un appui franc sur un téléphone parcourt couramment une dizaine
 * de pixels sans que personne n'ait eu l'intention de glisser.
 *
 * D'où deux tolérances. Celle du doigt est prise volontairement large : rater
 * un appui coûte un tour de voleur, prendre un petit glissement pour un appui
 * coûte un clic à annuler.
 */
export const TOLERANCE_SOURIS = 3;
export const TOLERANCE_DOIGT = 12;

export function toleranceDe(typePointeur: string): number {
  return typePointeur === 'mouse' ? TOLERANCE_SOURIS : TOLERANCE_DOIGT;
}

/**
 * Le doigt a-t-il assez bougé pour que ce ne soit plus un appui ?
 *
 * La distance se mesure **depuis le point de départ**, jamais d'un événement
 * au suivant. C'était l'erreur : un seul rapport de six pixels suffisait à
 * classer le geste en glissement, alors même que le doigt revenait ensuite à
 * son point de départ. Un geste ne se juge pas à sa vitesse instantanée.
 */
export function estGlissement(depart: Point, courant: Point, typePointeur: string): boolean {
  return Math.hypot(courant.x - depart.x, courant.y - depart.y) > toleranceDe(typePointeur);
}

/**
 * L'écart entre deux angles, ramené dans (−π, π].
 *
 * `Math.atan2` rend un angle borné : deux doigts qui tournent régulièrement
 * franchissent tôt ou tard sa discontinuité, et la différence brute y saute
 * de 2π d'une image à l'autre. La carte partait alors en vrille. Comme on ne
 * croise cette frontière que d'un côté selon le sens de rotation, la rotation
 * paraissait ne fonctionner que dans un sens.
 *
 * Repasser par un sinus et un cosinus ramène l'écart au plus court chemin,
 * sans avoir à traiter le cas limite à la main.
 */
export function ecartAngulaire(de: number, vers: number): number {
  const brut = vers - de;
  return Math.atan2(Math.sin(brut), Math.cos(brut));
}

/**
 * Torsion cumulée avant que la rotation prenne effet, en radians (≈ 6°).
 *
 * Deux doigts qui pincent ne sont jamais parfaitement alignés d'une image à
 * l'autre : sans cette zone morte, un zoom pur faisait toujours pivoter la
 * carte d'un ou deux degrés. On attend donc que la torsion soit franche avant
 * de la suivre — après quoi on la suit intégralement, sans rattraper le retard
 * accumulé, qui se verrait comme un à-coup.
 */
export const TORSION_MORTE = 0.1;

/**
 * Sens de la rotation à deux doigts.
 *
 * L'écran a son axe vertical dirigé vers le bas, donc `atan2` y croît dans le
 * sens des aiguilles. Reste à savoir dans quel sens croît l'azimut de la
 * caméra : dans `Cadrage.appliquer()`, la caméra est placée en
 * `(sin azimut, ·, cos azimut)` et `deplacer()` donne `(cos azimut, ·,
 * −sin azimut)` pour la droite de l'écran. Un point posé en `x = 1` s'y
 * projette donc à droite quand l'azimut vaut zéro, et vers le bas quand il
 * vaut un quart de tour : de la droite vers le bas, c'est le sens des
 * aiguilles.
 *
 * Les deux tournent donc dans le même sens, et l'écart s'applique tel quel.
 * Le signe négatif qui figurait ici renversait la carte — c'est le « à
 * l'envers » du rapport de soirée.
 */
export function azimutDepuisTorsion(ecart: number): number {
  return ecart;
}
