// @ts-check
/**
 * Créateurs de commandes. Toute mutation de l'état passe par une commande :
 * l'UI ne modifie jamais l'état directement. Chaque commande porte `clientId`
 * et `ts` (posés par la couche store) pour préparer la synchronisation
 * temps réel future sans la réécrire.
 */

export const setResult = (matchId, result) => ({ type: 'SET_RESULT', matchId, result });
export const clearResult = (matchId) => ({ type: 'CLEAR_RESULT', matchId });
export const moveMatch = (matchId, slot) => ({ type: 'MOVE_MATCH', matchId, slot });
export const swapMatches = (aId, bId) => ({ type: 'SWAP_MATCHES', aId, bId });
export const setBranding = (branding) => ({ type: 'SET_BRANDING', branding });
export const setRuleset = (ruleset) => ({ type: 'SET_RULESET', ruleset });
export const setName = (name) => ({ type: 'SET_NAME', name });
export const setSchedule = (schedule) => ({ type: 'SET_SCHEDULE', schedule });
export const generateStructure = (options) => ({ type: 'GENERATE_STRUCTURE', options });
export const generateScheduleCmd = () => ({ type: 'GENERATE_SCHEDULE' });
export const setTeams = (teams) => ({ type: 'SET_TEAMS', teams });
