// @ts-check
import { makeId, shuffle } from '../ids.js';
import { generateRoundRobin } from './roundRobin.js';

/**
 * Répartit des équipes en poules équilibrées.
 *
 * Si des têtes de série (`seed`) sont fournies, on répartit en "serpent"
 * (snake) : 1→A, 2→B, 3→C, 4→C, 5→B, 6→A... pour équilibrer la force des
 * poules. Sinon, tirage au sort déterministe via le RNG fourni.
 *
 * @param {import('../types.js').Team[]} teams
 * @param {number} groupCount
 * @param {{rng?:()=>number, qualifiersPerGroup?:number, makeId?:(p?:string)=>string}} [opts]
 * @returns {import('../types.js').Division[]}
 */
export function splitIntoGroups(teams, groupCount, opts = {}) {
  const mkId = opts.makeId || ((p) => makeId(p));
  const count = Math.max(1, Math.min(groupCount, teams.length));
  /** @type {import('../types.js').Division[]} */
  const divisions = [];
  for (let g = 0; g < count; g++) {
    divisions.push({
      id: mkId('div'),
      name: `Poule ${String.fromCharCode(65 + g)}`,
      teamIds: [],
      qualifyCount: opts.qualifiersPerGroup,
    });
  }

  const hasSeeds = teams.some((t) => typeof t.seed === 'number');
  let ordered;
  if (hasSeeds) {
    ordered = teams.slice().sort((a, b) => (a.seed ?? 1e9) - (b.seed ?? 1e9));
  } else if (opts.rng) {
    ordered = shuffle(teams, opts.rng);
  } else {
    ordered = teams.slice();
  }

  // Répartition serpent : indispensable pour ne pas concentrer les favoris.
  ordered.forEach((team, i) => {
    const row = Math.floor(i / count);
    const col = i % count;
    const g = row % 2 === 0 ? col : count - 1 - col;
    divisions[g].teamIds.push(team.id);
  });

  return divisions;
}

/**
 * Génère tous les matchs de poule (round-robin dans chaque division).
 * @param {import('../types.js').Division[]} divisions
 * @param {{doubleLeg?:boolean, makeId?:(p?:string)=>string}} [opts]
 * @returns {import('../types.js').Match[]}
 */
export function generateGroupMatches(divisions, opts = {}) {
  /** @type {import('../types.js').Match[]} */
  let matches = [];
  for (const div of divisions) {
    matches = matches.concat(
      generateRoundRobin(div.teamIds, {
        doubleLeg: opts.doubleLeg,
        divisionId: div.id,
        phase: 'group',
        makeId: opts.makeId,
      }),
    );
  }
  return matches;
}
