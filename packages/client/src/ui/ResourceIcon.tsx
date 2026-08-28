/**
 * Pictogrammes des ressources.
 *
 * Dessinés en SVG plutôt qu'importés : à cette taille — dix-huit pixels dans
 * une main, douze dans une modale — une image matricielle devient une bouillie,
 * et il en faudrait deux versions pour les écrans à forte densité. Un tracé
 * reste net partout et prend une centaine d'octets.
 *
 * Chaque ressource a sa couleur, mais toutes viennent de la palette Céramique :
 * l'écran doit rester un ensemble, pas un nuancier. La forme fait le gros du
 * travail — un joueur daltonien reconnaît l'épi de blé sans lire la teinte.
 */

import type { ReactElement } from 'react';

export type ResourceName = 'wood' | 'brick' | 'wool' | 'grain' | 'ore' | 'gold' | 'fish';

/** Teintes des ressources, dérivées de la palette. */
const TINTS: Record<ResourceName, string> = {
  wood: '#4A6B3A',   // olive sombre
  brick: '#A63A17',  // terre cuite, l'accent du thème
  wool: '#8C9A86',   // vert-gris pâle
  grain: '#C8912B',  // blé mûr
  ore: '#5A6470',    // ardoise
  gold: '#8A6420',   // or patiné
  fish: '#3E6C7A',   // bleu égéen
};

export const RESOURCE_LABELS: Record<string, string> = {
  wood: 'Bois', brick: 'Brique', wool: 'Laine',
  grain: 'Blé', ore: 'Minerai', gold: 'Or', fish: 'Poisson',
};

/**
 * Les tracés, sur une grille de 24.
 *
 * Tous partagent le même parti : une silhouette pleine et deux ou trois
 * traits de détail. Plus de détail se perdrait, moins rendrait les sept
 * pictogrammes confusables entre eux.
 */
function shape(resource: ResourceName): ReactElement {
  switch (resource) {
    /*
     * Rondin de profil. Vu de bout, avec ses cernes concentriques, il se
     * lisait comme une cible de fléchettes : la longueur est ce qui dit
     * « bille de bois ».
     */
    case 'wood':
      return (
        <>
          <rect x="6" y="7.2" width="15" height="9.6" rx="1" fill="currentColor" />
          <ellipse cx="6" cy="12" rx="3.1" ry="4.8" fill="currentColor" />
          <ellipse cx="6" cy="12" rx="1.9" ry="3" fill="none" stroke="#F2E9D4" strokeWidth="1.1" opacity=".6" />
          <ellipse cx="6" cy="12" rx=".7" ry="1.1" fill="#F2E9D4" opacity=".7" />
          <path d="M11 9.4h7M11.8 14.4h6.5" stroke="#F2E9D4" strokeWidth=".9" opacity=".32" strokeLinecap="round" />
        </>
      );

    // Deux assises décalées : c'est le décalage qui fait lire « maçonnerie ».
    case 'brick':
      return (
        <>
          <rect x="3" y="6.5" width="18" height="4.6" rx=".4" fill="currentColor" />
          <rect x="3" y="12.9" width="18" height="4.6" rx=".4" fill="currentColor" />
          <rect x="10.9" y="6.5" width="1.5" height="4.6" fill="#F2E9D4" opacity=".6" />
          <rect x="6.4" y="12.9" width="1.5" height="4.6" fill="#F2E9D4" opacity=".6" />
          <rect x="15.4" y="12.9" width="1.5" height="4.6" fill="#F2E9D4" opacity=".6" />
        </>
      );

    /*
     * Un mouton entier. La toison seule, avec ses pattes sous elle, se lisait
     * comme un nuage de pluie ; c'est la tête qui lève le doute.
     */
    case 'wool':
      return (
        <>
          <path d="M8.6 18.4v2.4M12.4 18.6v2.2M16 18.2v2.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          <path
            d="M9 6.6c1.3 0 2.1.6 2.6 1.3.6-.5 1.4-.8 2.3-.8 1.2 0 2.2.6 2.8 1.4.4-.2.9-.3 1.4-.3 1.7 0 3 1.3 3 3 0 .8-.3 1.5-.8 2 .5.5.8 1.2.8 2 0 1.7-1.3 3-3 3H9.5C7.6 18.2 6 16.7 6 14.8c0-.7.2-1.3.6-1.9-.5-.5-.8-1.3-.8-2.1 0-1.7 1.4-3.1 3.2-3.1z"
            fill="currentColor"
          />
          <ellipse cx="5.2" cy="9.4" rx="3.1" ry="3.5" fill="currentColor" />
          <ellipse cx="5.2" cy="9.4" rx="3.1" ry="3.5" fill="#1B1310" opacity=".35" />
          <ellipse cx="2.9" cy="7.6" rx="1.3" ry="1.7" fill="currentColor" transform="rotate(-28 2.9 7.6)" />
          <circle cx="4.3" cy="8.9" r=".85" fill="#F2E9D4" />
        </>
      );

    /*
     * Épi de blé. Les grains couchés et un bouton au sommet en faisaient une
     * plume ; il leur fallait de l'angle, un vrai vide entre les paires, et
     * deux feuilles au pied pour ancrer la tige.
     */
    case 'grain':
      return (
        <>
          <path d="M12 22v-9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <path d="M12 17.6c-2.6 0-4.3-1.2-4.9-2.9 2.4-.7 4.2.3 4.9 1.6zM12 17.6c2.6 0 4.3-1.2 4.9-2.9-2.4-.7-4.2.3-4.9 1.6z" fill="currentColor" opacity=".85" />
          {[0, 1, 2].map((i) => {
            const y = 12.4 - i * 3.1;
            return (
              <g key={i}>
                <path d={`M12 ${y} c-2.6 -.4 -3.9 -1.9 -4.1 -3.7 2.3 -.2 3.8 1.1 4.1 2.6z`} fill="currentColor" />
                <path d={`M12 ${y} c2.6 -.4 3.9 -1.9 4.1 -3.7 -2.3 -.2 -3.8 1.1 -4.1 2.6z`} fill="currentColor" />
              </g>
            );
          })}
          <path d="M12 4.2c-1.3 1-1.9 2.3-1.9 3.6h3.8c0-1.3-.6-2.6-1.9-3.6z" fill="currentColor" />
        </>
      );

    // Roche facettée : les arêtes claires suffisent à dire « minéral ».
    case 'ore':
      return (
        <>
          <path d="M12 3.4l8 5.2-3 10.4H7L4 8.6z" fill="currentColor" />
          <path d="M12 3.4l-3 5.6 3 9.9 3-9.9zM4 8.6h16" stroke="#F2E9D4" strokeWidth="1.15" fill="none" opacity=".55" />
        </>
      );

    /*
     * Pile de pièces. Empilées sans écart, les trois ellipses formaient une
     * masse informe : c'est le liseré clair entre chacune qui les sépare.
     */
    case 'gold':
      return (
        <>
          {[17.4, 13.4, 9.4].map((cy, i) => (
            <g key={i}>
              <ellipse cx="12" cy={cy} rx="7.4" ry="2.9" fill="currentColor" />
              <ellipse cx="12" cy={cy - 0.9} rx="7.4" ry="2.9" fill="none" stroke="#F2E9D4" strokeWidth="1" opacity=".45" />
            </g>
          ))}
          <ellipse cx="12" cy="9.4" rx="3.6" ry="1.3" fill="#F2E9D4" opacity=".4" />
          <path d="M20.2 3.4l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" fill="currentColor" />
        </>
      );

    // Poisson : corps en amande, queue triangulaire, œil réservé.
    case 'fish':
      return (
        <>
          <path d="M3.6 12c3-4.2 6.6-6.3 10-6.3 2.6 0 4.8 1.2 6.3 2.8-.9 1.2-1.4 2.4-1.4 3.5s.5 2.3 1.4 3.5c-1.5 1.6-3.7 2.8-6.3 2.8-3.4 0-7-2.1-10-6.3z" fill="currentColor" />
          <path d="M20.4 8.5c1.4-.6 2.6-.4 3.1.2-.6.8-.6 5.8 0 6.6-.5.6-1.7.8-3.1.2z" fill="currentColor" opacity=".75" />
          <circle cx="8.4" cy="10.6" r="1.15" fill="#F2E9D4" />
        </>
      );
  }
}

export interface ResourceIconProps {
  readonly resource: string;
  readonly size?: number;
}

export function ResourceIcon({ resource, size = 18 }: ResourceIconProps) {
  const name = resource as ResourceName;
  if (!(name in TINTS)) return null;

  return (
    <svg
      className="gc-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      style={{ color: TINTS[name] }}
      role="img"
      aria-label={RESOURCE_LABELS[name] ?? name}
    >
      {shape(name)}
    </svg>
  );
}
