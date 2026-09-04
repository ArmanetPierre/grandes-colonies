/**
 * Libellés des objectifs secrets.
 *
 * Ils viennent du moteur, qui porte déjà titre et description en français.
 * Les recopier ici les aurait fait diverger au premier ajustement de règle —
 * et un objectif mal décrit se choisit mal.
 */

import { OBJECTIVES, type ObjectiveId } from '@grandes-colonies/engine';

export function objectiveTitle(id: string): string {
  return OBJECTIVES[id as ObjectiveId]?.title ?? id;
}

export function objectiveDescription(id: string): string {
  return OBJECTIVES[id as ObjectiveId]?.description ?? '';
}

/** Titre et description sur une ligne, pour un classement ou une liste. */
export function objectiveLabel(id: string): string {
  const objective = OBJECTIVES[id as ObjectiveId];
  return objective ? `${objective.title} — ${objective.description}` : id;
}
