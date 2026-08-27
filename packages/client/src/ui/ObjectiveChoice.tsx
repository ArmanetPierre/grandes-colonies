/**
 * Choix de l'objectif secret, au début de la partie.
 *
 * Deux objectifs sont proposés, un seul est conservé, et il vaut 2 points sur
 * les 15 à atteindre : c'est une décision d'ouverture, pas une formalité. Elle
 * oriente toute la partie — viser quatre villes ou douze routes ne se joue
 * pas de la même manière.
 *
 * L'écran est donc bloquant. Sans lui, le moteur retombait sur le premier des
 * deux objectifs et le choix n'avait tout simplement jamais lieu.
 */

import type { PrivatePlayerView } from '@grand-colonies/protocol';

import { objectiveDescription, objectiveTitle } from './objectives.js';

export interface ObjectiveChoiceProps {
  readonly priv: PrivatePlayerView;
  readonly onChoose: (objective: string) => void;
}

export function ObjectiveChoice({ priv, onChoose }: ObjectiveChoiceProps) {
  return (
    <div className="gc-modal-backdrop">
      <div className="gc-modal gc-modal-wide">
        <header className="gc-modal-head">
          <span className="gc-modal-title">Ton objectif secret</span>
        </header>
        <p className="gc-modal-hint">
          Garde-en un. Il vaut 2 points, personne ne le connaîtra avant la fin
          de la partie.
        </p>

        <div className="gc-objectives">
          {priv.offeredObjectives.map((objective) => (
            <button
              key={objective}
              className="gc-objective"
              onClick={() => onChoose(objective)}
            >
              <span className="gc-objective-title">{objectiveTitle(objective)}</span>
              <span className="gc-objective-desc">{objectiveDescription(objective)}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
