// @ts-check
import { normalizeResult } from '../scoring/score.js';

/**
 * @typedef {Object} MiniStats
 * @property {number} points
 * @property {number} goalDiff
 * @property {number} goalsFor
 * @property {number} played
 */

/**
 * Construit un mini-championnat sur les matchs joués UNIQUEMENT entre les
 * équipes encore à égalité (confrontation directe). En aller-retour, les deux
 * manches sont naturellement agrégées puisqu'on somme tous les matchs concernés.
 *
 * @param {string[]} tiedIds équipes à départager
 * @param {import('../types.js').Match[]} matches tous les matchs
 * @param {import('../types.js').Ruleset} ruleset
 * @returns {Map<string, MiniStats>}
 */
export function buildHeadToHeadTable(tiedIds, matches, ruleset) {
  const set = new Set(tiedIds);
  /** @type {Map<string, MiniStats>} */
  const table = new Map();
  for (const id of tiedIds) table.set(id, { points: 0, goalDiff: 0, goalsFor: 0, played: 0 });

  for (const m of matches) {
    if (m.phase !== 'group') continue;
    if (!m.result || !m.result.finished) continue;
    if (m.homeId === null || m.awayId === null) continue;
    // Seuls les matchs ENTRE équipes à égalité comptent.
    if (!set.has(m.homeId) || !set.has(m.awayId)) continue;

    const r = normalizeResult(m.result, ruleset);
    const home = table.get(m.homeId);
    const away = table.get(m.awayId);
    if (!home || !away) continue;

    home.played += 1;
    away.played += 1;
    home.goalsFor += r.homeGoals;
    away.goalsFor += r.awayGoals;
    home.goalDiff += r.homeGoals - r.awayGoals;
    away.goalDiff += r.awayGoals - r.homeGoals;

    if (r.homeGoals > r.awayGoals) {
      home.points += ruleset.winPoints;
      away.points += ruleset.lossPoints;
    } else if (r.awayGoals > r.homeGoals) {
      away.points += ruleset.winPoints;
      home.points += ruleset.lossPoints;
    } else {
      home.points += ruleset.drawPoints;
      away.points += ruleset.drawPoints;
    }
  }
  return table;
}
