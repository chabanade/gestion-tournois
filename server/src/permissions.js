// @ts-check
/**
 * Règles d'autorisation par rôle. Volontairement strictes et lisibles :
 * - organisateur (admin) : tout ;
 * - table de marque (table) : uniquement saisir/annuler un score, et seulement
 *   pour les matchs planifiés sur SES terrains ;
 * - public : rien (lecture seule via GET / WebSocket).
 *
 * @param {{role:string, courts?:number[]}} auth
 * @param {{type:string, matchId?:string}} command
 * @param {import('../../src/engine/index.js').Tournament} state
 * @returns {{ok:boolean, reason?:string}}
 */
export function authorize(auth, command, state) {
  if (auth.role === 'admin') return { ok: true };
  if (auth.role === 'table') {
    if (command.type !== 'SET_RESULT' && command.type !== 'CLEAR_RESULT') {
      return { ok: false, reason: 'La table de marque ne peut que saisir des scores.' };
    }
    const match = state.matches.find((m) => m.id === command.matchId);
    if (!match) return { ok: false, reason: 'Match inconnu.' };
    const court = match.slot?.court;
    if (court == null || !(auth.courts || []).includes(court)) {
      return { ok: false, reason: 'Ce match n\'est pas sur un de vos terrains.' };
    }
    return { ok: true };
  }
  return { ok: false, reason: 'Lecture seule.' };
}
