// @ts-check
import { makeRng, makeId } from '../ids.js';
import { generateRoundRobin } from './roundRobin.js';
import { splitIntoGroups, generateGroupMatches } from './groups.js';
import { generateBracket } from './knockout.js';
import { generateGroupsKnockout, parseQualToken } from './groupsKnockout.js';
import { computeStandings } from '../standings/standings.js';

export { generateRoundRobin } from './roundRobin.js';
export { splitIntoGroups, generateGroupMatches } from './groups.js';
export { generateBracket, standardSeedOrder, nextPow2 } from './knockout.js';
export { generateGroupsKnockout, qualToken, parseQualToken } from './groupsKnockout.js';

/**
 * Construit la structure (poules + matchs) d'un tournoi selon son format.
 *
 * @param {import('../types.js').Format} format
 * @param {import('../types.js').Team[]} teams
 * @param {{doubleLeg?:boolean, groupCount?:number, qualifiersPerGroup?:number, thirdPlace?:boolean, rngSeed?:string, makeId?:(p?:string)=>string}} [options]
 * @returns {{divisions: import('../types.js').Division[], matches: import('../types.js').Match[]}}
 */
export function createStructure(format, teams, options = {}) {
  const mkId = options.makeId || ((p) => makeId(p));
  const rng = makeRng(options.rngSeed || 'seed');
  const teamIds = teams.map((t) => t.id);

  switch (format) {
    case 'championship':
    case 'roundRobin': {
      const div = { id: mkId('div'), name: 'Championnat', teamIds };
      const matches = generateRoundRobin(teamIds, { doubleLeg: options.doubleLeg, divisionId: div.id, makeId: mkId });
      return { divisions: [div], matches };
    }
    case 'knockout': {
      const seeded = teams.slice().sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9)).map((t) => t.id);
      const { matches } = generateBracket(seeded, { thirdPlace: options.thirdPlace, makeId: mkId });
      return { divisions: [], matches };
    }
    case 'groupsKnockout': {
      const { divisions, matches } = generateGroupsKnockout(teams, {
        groupCount: options.groupCount || 2,
        qualifiersPerGroup: options.qualifiersPerGroup || 2,
        doubleLeg: options.doubleLeg,
        thirdPlace: options.thirdPlace,
        rng,
        makeId: mkId,
      });
      return { divisions, matches };
    }
    default:
      return { divisions: [], matches: [] };
  }
}

/**
 * Résout les jetons de qualification (Q:pos:poule) de l'arbre en équipes réelles
 * dès que les poules concernées sont terminées. Retourne une copie des matchs.
 *
 * @param {import('../types.js').Tournament} t
 * @returns {import('../types.js').Match[]}
 */
export function resolveQualifiers(t) {
  // Pré-calcule les classements de chaque poule.
  const standingsByDiv = t.divisions.map((div) => computeStandings(div, t.matches, t.ruleset, t.rngSeed));
  const out = t.matches.map((m) => ({ ...m }));

  const resolve = (token) => {
    const parsed = parseQualToken(token);
    if (!parsed) return null;
    const st = standingsByDiv[parsed.divIndex];
    const div = t.divisions[parsed.divIndex];
    if (!st || !div) return null;
    // On ne résout que si la poule est terminée (tous ses matchs joués).
    if (!isDivisionComplete(div, t.matches)) return null;
    const row = st[parsed.position - 1];
    return row ? row.teamId : null;
  };

  for (const m of out) {
    if (m.phase !== 'knockout') continue;
    // On remplit homeId depuis le jeton uniquement quand il est résolvable.
    // Le jeton (homeToken) n'est jamais détruit : il reste la source de vérité.
    if (m.homeToken && m.homeId === null) {
      const id = resolve(m.homeToken);
      if (id) m.homeId = id;
    }
    if (m.awayToken && m.awayId === null) {
      const id = resolve(m.awayToken);
      if (id) m.awayId = id;
    }
  }
  return out;
}

/**
 * @param {import('../types.js').Division} div
 * @param {import('../types.js').Match[]} matches
 * @returns {boolean}
 */
export function isDivisionComplete(div, matches) {
  const groupMatches = matches.filter((m) => m.phase === 'group' && m.divisionId === div.id);
  return groupMatches.length > 0 && groupMatches.every((m) => m.result && m.result.finished);
}
