// @ts-check
import { makeRng } from '../ids.js';
import { normalizeResult } from '../scoring/score.js';
import { rankTeams } from './tiebreakers.js';

/**
 * Calcule le classement LIVE d'une poule.
 *
 * @param {import('../types.js').Division} division
 * @param {import('../types.js').Match[]} matches tous les matchs du tournoi
 * @param {import('../types.js').Ruleset} ruleset
 * @param {string} [rngSeed] seed du tirage au sort déterministe
 * @returns {import('../types.js').Standing[]}
 */
export function computeStandings(division, matches, ruleset, rngSeed = 'seed') {
  /** @type {Map<string, import('../types.js').Standing>} */
  const rows = new Map();
  for (const id of division.teamIds) {
    rows.set(id, {
      teamId: id, rank: 0, played: 0, won: 0, drawn: 0, lost: 0,
      goalsFor: 0, goalsAgainst: 0, goalDiff: 0, points: 0, disciplinary: 0,
    });
  }

  const groupMatches = matches.filter(
    (m) => m.phase === 'group' && m.divisionId === division.id && m.result && m.result.finished,
  );

  for (const m of groupMatches) {
    if (m.homeId === null || m.awayId === null) continue;
    const home = rows.get(m.homeId);
    const away = rows.get(m.awayId);
    if (!home || !away) continue;
    const r = normalizeResult(m.result, ruleset);

    home.played += 1; away.played += 1;
    home.goalsFor += r.homeGoals; home.goalsAgainst += r.awayGoals;
    away.goalsFor += r.awayGoals; away.goalsAgainst += r.homeGoals;

    if (r.fairPlay) {
      home.disciplinary += r.fairPlay.home || 0;
      away.disciplinary += r.fairPlay.away || 0;
    }

    if (r.homeGoals > r.awayGoals) {
      home.won += 1; away.lost += 1;
      home.points += ruleset.winPoints; away.points += ruleset.lossPoints;
    } else if (r.awayGoals > r.homeGoals) {
      away.won += 1; home.lost += 1;
      away.points += ruleset.winPoints; home.points += ruleset.lossPoints;
    } else {
      home.drawn += 1; away.drawn += 1;
      home.points += ruleset.drawPoints; away.points += ruleset.drawPoints;
    }

    // Pénalité de points pour l'équipe déclarée forfait.
    if (r.forfeit === 'home' && ruleset.forfeitLosePoints) home.points += ruleset.forfeitLosePoints;
    if (r.forfeit === 'away' && ruleset.forfeitLosePoints) away.points += ruleset.forfeitLosePoints;
  }

  // Différence de buts + éventuel impact du fair-play sur les points.
  for (const s of rows.values()) {
    s.goalDiff = s.goalsFor - s.goalsAgainst;
    if (ruleset.fairPlayAffectsPoints) s.points -= s.disciplinary;
  }

  const rng = makeRng(`${rngSeed}:${division.id}`);
  return rankTeams([...rows.values()], ruleset.tiebreakers, matches, ruleset, rng);
}

/**
 * Renvoie les équipes qualifiées d'une poule (les `qualifyCount` premières).
 * @param {import('../types.js').Standing[]} standings
 * @param {number} count
 * @returns {string[]}
 */
export function qualifiedTeams(standings, count) {
  return standings.slice(0, count).map((s) => s.teamId);
}
