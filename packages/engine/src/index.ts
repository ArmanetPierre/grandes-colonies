/**
 * Moteur de règles de Grand Colonies.
 *
 * Règle d'or : ce paquet ne dépend ni du réseau, ni du navigateur, ni du
 * rendu. Il doit pouvoir jouer une partie complète en mémoire, ce qui le
 * rend testable et simulable à grande échelle.
 */

export * from './board/axial.js';
export * from './board/graph.js';
export * from './board/board.js';
export * from './board/islands.js';
export * from './board/presets.js';
export * from './resources.js';
export * from './production.js';
export * from './placement.js';
export * from './longestRoute.js';
export * from './largestArmy.js';
export * from './titles.js';
export * from './rng.js';
export * from './devCards.js';
export * from './victory.js';
export * from './objectives.js';
export * from './ports.js';
export * from './influence.js';
export * from './barbarians.js';
export * from './market.js';
export * from './game/index.js';
