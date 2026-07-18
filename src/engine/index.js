// @ts-check
/**
 * API publique du moteur de tournoi (JS pur, zéro dépendance, zéro UI).
 * Ce module est importable directement par les tests (`node --test`) et par
 * l'interface. Il ne connaît ni le DOM, ni le stockage, ni le réseau.
 */
export * from './types.js';
export * from './ids.js';
export * from './formats/index.js';
export { computeStandings, qualifiedTeams } from './standings/standings.js';
export { rankTeams, breakTies, applyCriterion } from './standings/tiebreakers.js';
export { buildHeadToHeadTable } from './standings/headToHead.js';
export { generateSchedule, slotStart } from './scheduling/scheduler.js';
export { validateSchedule } from './scheduling/constraints.js';
export { advanceBracket, bracketWinner } from './bracket/bracket.js';
export { normalizeResult, matchWinner, resolveSide } from './scoring/score.js';
export { applyCommand, createTournament } from './commands/reducer.js';
export * as commands from './commands/commands.js';
