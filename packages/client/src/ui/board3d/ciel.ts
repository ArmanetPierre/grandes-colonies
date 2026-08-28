/**
 * Le ciel, et ce qu'il éclaire.
 *
 * Un dégradé du zénith à l'horizon, peint sur un canevas et projeté autour
 * de la scène. Il sert deux fois : c'est le fond que l'on voit quand on
 * incline la caméra vers l'horizon, et c'est la source de l'environnement
 * que réfléchissent l'eau et les toits.
 *
 * Cette seconde fonction est la vraie raison de son existence. Une surface
 * métallique ne s'éclaire pas, elle réfléchit : sans environnement à
 * refléter, la mer rendait parfaitement noire, quelle que soit la lumière
 * qu'on lui envoyait. C'est le genre de panne qui ressemble à une erreur de
 * matériau alors qu'il n'y manque qu'un ciel.
 */

import {
  EquirectangularReflectionMapping, LinearFilter, PMREMGenerator, SRGBColorSpace,
  type Texture, CanvasTexture, type WebGLRenderer,
} from 'three';

export interface Ciel {
  /** Le fond de la scène : ce qu'on voit là où rien n'est dessiné. */
  readonly fond: Texture;
  /** L'environnement réfléchi par les matériaux. */
  readonly environnement: Texture;
  detruire(): void;
}

/**
 * Peint le ciel en projection équirectangulaire.
 *
 * La bande du haut est le zénith, celle du bas le nadir ; l'horizon est à
 * mi-hauteur. Un simple dégradé vertical suffit : on ne cherche pas des
 * nuages, on cherche que l'eau ait quelque chose de crédible à refléter et
 * que le regard trouve une ligne d'horizon en se relevant.
 */
function peindreCiel(): HTMLCanvasElement | undefined {
  const toile = document.createElement('canvas');
  toile.width = 1024;
  toile.height = 512;
  const ctx = toile.getContext('2d');
  if (!ctx) return undefined;

  const degrade = ctx.createLinearGradient(0, 0, 0, 512);
  degrade.addColorStop(0.00, '#0f2b46');   // zénith
  degrade.addColorStop(0.30, '#4a7ea6');
  degrade.addColorStop(0.46, '#a8c8dc');
  degrade.addColorStop(0.50, '#e6d9bd');   // la brume de l'horizon
  degrade.addColorStop(0.54, '#2b5570');
  degrade.addColorStop(1.00, '#0a1e2c');   // l'eau, sous la ligne
  ctx.fillStyle = degrade;
  ctx.fillRect(0, 0, 1024, 512);

  /*
   * Un soleil bas, à l'ouest.
   *
   * Il ne sert pas à être vu — la caméra regarde le plateau, pas
   * l'horizon — mais à être réfléchi : c'est lui qui pose la traînée
   * lumineuse sur l'eau, et sans elle la mer reste une nappe morte quelle
   * que soit sa couleur.
   */
  const halo = ctx.createRadialGradient(760, 232, 4, 760, 232, 150);
  halo.addColorStop(0, 'rgba(255,244,214,.95)');
  halo.addColorStop(0.35, 'rgba(255,226,170,.35)');
  halo.addColorStop(1, 'rgba(255,214,150,0)');
  ctx.fillStyle = halo;
  ctx.fillRect(560, 60, 400, 340);

  return toile;
}

export function creerCiel(renderer: WebGLRenderer): Ciel | undefined {
  const toile = peindreCiel();
  if (!toile) return undefined;

  const fond = new CanvasTexture(toile);
  fond.mapping = EquirectangularReflectionMapping;
  fond.colorSpace = SRGBColorSpace;
  fond.minFilter = LinearFilter;
  fond.magFilter = LinearFilter;
  fond.needsUpdate = true;

  // Le pré-filtrage transforme l'image en une pile de réflexions floutées,
  // une par rugosité. C'est ce qui permet à un toit mat et à l'eau lisse de
  // puiser dans le même ciel sans se ressembler.
  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const environnement = pmrem.fromEquirectangular(fond).texture;
  pmrem.dispose();

  return {
    fond,
    environnement,
    detruire: (): void => { fond.dispose(); environnement.dispose(); },
  };
}
