/**
 * Fin de partie.
 *
 * C'est ici que les objectifs secrets cessent d'en être, et c'est un moment
 * de jeu : chacun découvre ce que les autres poursuivaient depuis le début,
 * et pourquoi tel joueur s'obstinait à poser des routes.
 *
 * L'écran montre donc l'objectif de chacun, rempli ou non, plutôt qu'un
 * simple classement — un total sans explication ne se discute pas.
 */

import type { PublicGameView } from '@grand-colonies/protocol';

import { objectiveLabel } from './objectives.js';

export interface GameOverProps {
  readonly view: PublicGameView;
  readonly me: string;
}

export function GameOver({ view, me }: GameOverProps) {
  const nameOf = (id: string): string => view.players.find((p) => p.id === id)?.name ?? id;
  const winner = view.winner;

  return (
    <div className="gc-modal-backdrop">
      <div className="gc-modal gc-modal-wide">
        <header className="gc-modal-head">
          <span className="gc-modal-title">
            {winner === me ? 'Tu as gagné' : `${nameOf(winner ?? '')} l'emporte`}
          </span>
        </header>

        <table className="gc-standings">
          <tbody>
            {view.standings.map((row, rank) => (
              <tr key={row.player} className={row.player === winner ? 'is-winner' : ''}>
                <td className="gc-rank">{rank + 1}</td>
                <td className="gc-standing-name">
                  {nameOf(row.player)}
                  {row.player === me && ' (toi)'}
                </td>
                <td className="gc-standing-obj">
                  {row.objective ? objectiveLabel(row.objective) : '—'}
                  {row.objective && (
                    <span className={row.objectiveDone ? 'gc-done' : 'gc-missed'}>
                      {row.objectiveDone ? ' ✓ +2' : ' manqué'}
                    </span>
                  )}
                </td>
                <td className="gc-standing-points">{row.points} PV</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="gc-modal-hint">
          Objectif atteint : 2 points. Ils n'apparaissaient dans aucun score public.
        </p>
      </div>
    </div>
  );
}
