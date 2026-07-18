// @ts-check

/**
 * Normalise un résultat brut selon le règlement :
 * - forfait → applique le score forfaitaire configuré ;
 * - conserve les tirs au but et le fair-play tels quels.
 * Ne modifie pas l'entrée.
 * @param {import('../types.js').MatchResult} result
 * @param {import('../types.js').Ruleset} ruleset
 * @returns {import('../types.js').MatchResult}
 */
export function normalizeResult(result, ruleset) {
  if (!result) return result;
  const out = { ...result };
  if (out.forfeit === 'home') {
    out.homeGoals = ruleset.forfeitScore[0];
    out.awayGoals = ruleset.forfeitScore[1];
  } else if (out.forfeit === 'away') {
    out.homeGoals = ruleset.forfeitScore[1];
    out.awayGoals = ruleset.forfeitScore[0];
  }
  return out;
}

/**
 * Désigne le vainqueur d'un match : buts, puis tirs au but si nul.
 * @param {import('../types.js').Match} match
 * @returns {('home'|'away'|'draw'|null)} null si non terminé
 */
export function matchWinner(match) {
  const r = match.result;
  if (!r || !r.finished) return null;
  if (r.forfeit === 'home') return 'away';
  if (r.forfeit === 'away') return 'home';
  if (r.homeGoals > r.awayGoals) return 'home';
  if (r.awayGoals > r.homeGoals) return 'away';
  // Nul : tirs au but s'ils existent (obligatoire en phase KO).
  if (r.penalties) {
    if (r.penalties.home > r.penalties.away) return 'home';
    if (r.penalties.away > r.penalties.home) return 'away';
  }
  return 'draw';
}

/**
 * Résout un côté d'un match d'arbre (vainqueur/perdant d'un match source).
 * @param {import('../types.js').MatchRef} ref
 * @param {Map<string, import('../types.js').Match>} byId
 * @returns {(string|null)}
 */
export function resolveSide(ref, byId) {
  const src = byId.get(ref.matchId);
  if (!src) return null;
  const w = matchWinner(src);
  if (w === null || w === 'draw') return null;
  const winnerId = w === 'home' ? src.homeId : src.awayId;
  const loserId = w === 'home' ? src.awayId : src.homeId;
  return ref.outcome === 'winner' ? winnerId : loserId;
}
