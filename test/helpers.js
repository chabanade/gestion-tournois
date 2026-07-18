// @ts-check
/** Utilitaires de test partagés. */

/** @param {string[]} names */
export function makeTeams(names) {
  return names.map((name, i) => ({ id: name, name, seed: i + 1 }));
}

/**
 * Fabrique un match de poule terminé.
 * @param {string} divisionId
 * @param {string} homeId
 * @param {string} awayId
 * @param {number} hg
 * @param {number} ag
 * @param {object} [extra]
 */
export function groupMatch(divisionId, homeId, awayId, hg, ag, extra = {}) {
  return {
    id: `${homeId}-${awayId}`,
    divisionId,
    phase: 'group',
    round: 0,
    homeId,
    awayId,
    result: { homeGoals: hg, awayGoals: ag, finished: true, ...extra },
  };
}

/** Ordre des ids d'un classement. */
export function order(standings) {
  return standings.map((s) => s.teamId);
}
