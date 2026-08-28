/**
 * Les deux dés, et leur roulement.
 *
 * Le lancer n'était qu'une ligne de texte — « 1 + 5 = 6 » — au coin de
 * l'écran. À douze joueurs, c'est pourtant le seul moment où la table entière
 * regarde la même chose, et il passait inaperçu.
 *
 * L'animation est en CSS et les faces en SVG : aucune dépendance ajoutée pour
 * trois secondes de roulement, et les points restent nets à toute taille. Le
 * roulement dure le temps qu'il faut pour attirer l'œil sans retarder le jeu
 * — il n'attend rien, l'état est déjà à jour derrière.
 *
 * Depuis que les dés roulent aussi sur le plateau, ce bandeau n'annonce plus
 * le lancer : il le confirme, et le garde jusqu'au suivant. C'est l'écran de
 * jeu qui lui transmet le résultat au bon moment — assez tard pour que les
 * deux roulements s'arrêtent ensemble, ce dont `DUREE_BANDEAU` est la mesure.
 */

import { useEffect, useRef, useState } from 'react';

/** Position des points, en douzièmes de face, pour chaque valeur. */
const PIPS: Readonly<Record<number, readonly (readonly [number, number])[]>> = {
  1: [[6, 6]],
  2: [[3.5, 3.5], [8.5, 8.5]],
  3: [[3.5, 3.5], [6, 6], [8.5, 8.5]],
  4: [[3.5, 3.5], [8.5, 3.5], [3.5, 8.5], [8.5, 8.5]],
  5: [[3.5, 3.5], [8.5, 3.5], [6, 6], [3.5, 8.5], [8.5, 8.5]],
  6: [[3.5, 3.2], [8.5, 3.2], [3.5, 6], [8.5, 6], [3.5, 8.8], [8.5, 8.8]],
};

function Face({ value }: { value: number }) {
  return (
    <svg className="gc-die" viewBox="0 0 12 12" role="img" aria-label={`dé ${value}`}>
      <rect x=".5" y=".5" width="11" height="11" rx="2.2"
            fill="var(--gc-raised)" stroke="var(--gc-ink)" strokeWidth=".7" />
      {(PIPS[value] ?? []).map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="1.15" fill="var(--gc-accent)" />
      ))}
    </svg>
  );
}

/**
 * La durée du roulement, en secondes.
 *
 * Publiée parce que le plateau s'accorde dessus : l'écran de jeu retarde la
 * valeur de ce qu'il faut pour que ce roulement-ci se termine à l'instant où
 * les dés de la carte se posent. Deux animations du même événement qui ne
 * finissent pas ensemble se lisent comme deux lancers.
 */
export const DUREE_BANDEAU = 0.62;

export interface DiceProps {
  readonly a: number;
  readonly b: number;
  readonly total: number;
}

export function Dice({ a, b, total }: DiceProps) {
  const [rolling, setRolling] = useState(false);
  const [faces, setFaces] = useState<[number, number]>([a, b]);
  /** Le lancer déjà montré : sans lui, chaque diffusion relancerait l'animation. */
  const shown = useRef<string>('');

  useEffect(() => {
    const key = `${a}-${b}-${total}`;
    if (shown.current === key) return undefined;
    const first = shown.current === '';
    shown.current = key;

    // Au premier affichage — une page rechargée en pleine partie — on montre
    // le résultat sans roulement : il n'y a rien à annoncer.
    if (first) { setFaces([a, b]); return undefined; }

    setRolling(true);
    const shuffle = setInterval(() => {
      setFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
    }, 70);
    const settle = setTimeout(() => {
      clearInterval(shuffle);
      setFaces([a, b]);
      setRolling(false);
    }, DUREE_BANDEAU * 1000);

    return () => { clearInterval(shuffle); clearTimeout(settle); };
  }, [a, b, total]);

  return (
    <div className={`gc-dice${rolling ? ' is-rolling' : ''}`} title="Dernier lancer">
      <Face value={faces[0]} />
      <Face value={faces[1]} />
      <span className="gc-dice-total">{rolling ? '—' : total}</span>
    </div>
  );
}
