/**
 * L'océan.
 *
 * Un plan très large, animé d'une houle calme. Il remplace les tuiles de mer
 * de l'ancien plateau : dessiner l'eau comme un pavage d'hexagones obligeait
 * à répéter la même image quarante-sept fois, et la répétition se voyait. Une
 * seule nappe continue, qui bouge, coûte moins cher et ment moins.
 *
 * Le matériau n'est pas écrit de zéro. On part du matériau standard de
 * Three.js et on greffe la houle dans son shader : l'éclairage, les ombres
 * reçues et la brume de distance restent ceux du moteur, et continueront de
 * fonctionner si la scène change d'éclairage. Un shader entièrement à soi
 * aurait fallu tout réimplémenter pour gagner une vague.
 */

import { Mesh, MeshStandardMaterial, PlaneGeometry } from 'three';

/**
 * Le paramètre que Three.js passe au greffon de shader.
 *
 * Son nom a changé d'une version à l'autre — `Shader`, puis
 * `WebGLProgramParametersWithUniforms`. On le déduit de la signature du
 * matériau plutôt que de l'importer : la greffe survit ainsi à la prochaine
 * mise à jour sans qu'on ait à courir après un nom de type.
 */
type ParametresShader = Parameters<MeshStandardMaterial['onBeforeCompile']>[0];

/**
 * Les trois trains de vagues.
 *
 * Décrits ici, en TypeScript, et non dans le shader : leur amplitude totale
 * décide de la hauteur à laquelle il faut poser tout ce qui flotte, et cette
 * hauteur doit se lire depuis le reste du programme. Les avoir écrits en
 * dur dans le GLSL les rendait invisibles au code qui en dépendait — les
 * panneaux de port disparaissaient sous les crêtes puis réapparaissaient,
 * ce qui ressemblait à un défaut d'affichage et n'était qu'un chiffre
 * augmenté d'un côté sans l'être de l'autre.
 */
const HOULES = [
  { direction: [1.0, 0.35], nombreDOnde: 0.55, amplitude: 0.065, vitesse: 0.75 },
  { direction: [-0.55, 1.0], nombreDOnde: 0.95, amplitude: 0.034, vitesse: 1.15 },
  { direction: [0.75, -0.9], nombreDOnde: 2.10, amplitude: 0.012, vitesse: 1.90 },
] as const;

/**
 * La hauteur maximale d'une crête au-dessus du niveau moyen.
 *
 * Ce que la mer peut atteindre au pire. Tout ce qui doit rester visible sur
 * l'eau — écume, panneaux de port, voies maritimes — se pose au-dessus.
 */
export const CRETE = HOULES.reduce((somme, h) => somme + h.amplitude, 0);

/** Le shader de houle, engendré depuis la description ci-dessus. */
function glslHoule(): string {
  const directions = HOULES.map(({ direction: [x, z] }, i) =>
    `vec2 d${i} = normalize(vec2(${x.toFixed(3)}, ${z.toFixed(3)}));`).join('\n    ');
  const constantes = HOULES.map(({ nombreDOnde, amplitude, vitesse }, i) =>
    `float k${i} = ${nombreDOnde.toFixed(3)}, a${i} = ${amplitude.toFixed(4)}, v${i} = ${vitesse.toFixed(3)};`).join('\n    ');
  const phases = HOULES.map((_, i) => `float f${i} = dot(d${i}, p) * k${i} + t * v${i};`).join('\n    ');
  const hauteur = HOULES.map((_, i) => `a${i} * sin(f${i})`).join(' + ');
  const penteX = HOULES.map((_, i) => `a${i} * k${i} * d${i}.x * cos(f${i})`).join(' + ');
  const penteZ = HOULES.map((_, i) => `a${i} * k${i} * d${i}.y * cos(f${i})`).join(' + ');

  return `
  // Des trains de vagues croisés. Un seul aurait donné un ondoiement régulier
  // de rideau de théâtre ; c'est leur interférence qui fait une mer.
  vec3 gcHoule(vec2 p, float t) {
    ${directions}
    ${constantes}
    ${phases}

    float h = ${hauteur};

    // La pente, calculée analytiquement plutôt qu'en comparant des points
    // voisins : la normale est alors exacte à toute résolution de maillage,
    // et la mer garde ses reflets même sur la grille allégée du téléphone.
    float dx = ${penteX};
    float dz = ${penteZ};
    return vec3(h, dx, dz);
  }
`;
}

const HOULE = glslHoule();

export interface Mer {
  readonly mesh: Mesh;
  /** Avance la houle. Appelé à chaque image, avec le temps écoulé en secondes. */
  animer(temps: number): void;
  detruire(): void;
}

/**
 * Fabrique la nappe d'eau.
 *
 * `etendue` est le côté du plan : il doit dépasser largement les îles du
 * large, sinon on aperçoit son bord en reculant — et un océan qui s'arrête
 * à l'équerre ruine d'un coup l'illusion que la carte continue.
 */
export function creerMer(etendue: number, subdivisions: number): Mer {
  // Le plan est tourné à la fabrication, pas à l'affichage : son repère local
  // coïncide alors avec celui du monde, et la houle peut s'écrire en `y`
  // plutôt qu'en `z`, ce qui évite d'avoir à retourner aussi les normales.
  const geometrie = new PlaneGeometry(etendue, etendue, subdivisions, subdivisions);
  geometrie.rotateX(-Math.PI / 2);

  /*
   * L'eau réfléchit plus qu'elle n'est éclairée.
   *
   * D'où le métal — mais un matériau métallique ne tire sa couleur que de ce
   * qu'il reflète : sans environnement, la mer rendait parfaitement noire.
   * Le ciel de la scène lui en donne un ; la valeur reste modérée pour que
   * l'eau garde tout de même sa teinte propre là où le ciel est sombre.
   */
  const materiau = new MeshStandardMaterial({
    color: 0x1b5679,
    roughness: 0.11,
    metalness: 0.34,
  });

  const uTemps = { value: 0 };

  materiau.onBeforeCompile = (shader: ParametresShader): void => {
    shader.uniforms['uTemps'] = uTemps;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n uniform float uTemps;\n ${HOULE}`)
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         vec3 gcOnde = gcHoule(position.xz, uTemps);
         objectNormal = normalize(vec3(-gcOnde.y, 1.0, -gcOnde.z));`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\n transformed.y += gcOnde.x;`,
      );
  };

  const mesh = new Mesh(geometrie, materiau);
  // La mer reçoit les ombres des îles mais n'en projette aucune : une nappe
  // horizontale ne peut rien ombrer sous elle, et l'exclure de la passe
  // d'ombres économise le plus grand maillage de la scène.
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  mesh.renderOrder = -1;

  return {
    mesh,
    animer: (temps: number): void => { uTemps.value = temps; },
    detruire: (): void => { geometrie.dispose(); materiau.dispose(); },
  };
}
