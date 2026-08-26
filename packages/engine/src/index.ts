/**
 * Moteur de règles de Grand Colonies.
 *
 * Règle d'or : ce paquet ne dépend ni du réseau, ni du navigateur, ni du
 * rendu. Il doit pouvoir jouer une partie complète en mémoire, ce qui le
 * rend testable et simulable à grande échelle.
 */

export * from './board/axial.js';
export * from './board/graph.js';
