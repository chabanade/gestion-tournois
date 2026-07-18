// @ts-check
import { makeId } from '../ids.js';
import { splitIntoGroups, generateGroupMatches } from './groups.js';
import { generateBracket } from './knockout.js';

/** Jeton de qualification : "Q:<position>:<indexPoule>" (position 1-indexée). */
export function qualToken(position, divIndex) {
  return `Q:${position}:${divIndex}`;
}

/**
 * Analyse un jeton de qualification.
 * @param {string} token
 * @returns {({position:number, divIndex:number}|null)}
 */
export function parseQualToken(token) {
  const mm = /^Q:(\d+):(\d+)$/.exec(token);
  if (!mm) return null;
  return { position: Number(mm[1]), divIndex: Number(mm[2]) };
}

/**
 * Construit un tournoi "poules + phases finales" : répartit en poules, génère
 * les matchs de poule et un arbre sur les qualifiés (encore inconnus → jetons).
 *
 * @param {import('../types.js').Team[]} teams
 * @param {{groupCount:number, qualifiersPerGroup:number, doubleLeg?:boolean, thirdPlace?:boolean, rng?:()=>number, makeId?:(p?:string)=>string}} opts
 * @returns {{divisions: import('../types.js').Division[], matches: import('../types.js').Match[]}}
 */
export function generateGroupsKnockout(teams, opts) {
  const mkId = opts.makeId || ((p) => makeId(p));
  const divisions = splitIntoGroups(teams, opts.groupCount, {
    rng: opts.rng,
    qualifiersPerGroup: opts.qualifiersPerGroup,
    makeId: mkId,
  });
  const groupMatches = generateGroupMatches(divisions, { doubleLeg: opts.doubleLeg, makeId: mkId });

  // Liste des qualifiés en ordre de têtes de série : tous les 1ers (ordre des
  // poules), puis tous les 2es, etc. Le seeding standard croise ensuite les
  // poules pour éviter les rematchs de poule au 1er tour.
  /** @type {string[]} */
  const entrants = [];
  for (let pos = 1; pos <= opts.qualifiersPerGroup; pos++) {
    for (let d = 0; d < divisions.length; d++) {
      entrants.push(qualToken(pos, d));
    }
  }
  const { matches: bracket } = generateBracket(entrants, { thirdPlace: opts.thirdPlace, makeId: mkId });

  // Les jetons de qualification déposés dans homeId/awayId par generateBracket
  // sont déplacés dans homeToken/awayToken : ainsi ils ne sont JAMAIS écrasés
  // par null tant que la poule n'est pas terminée (le jeton reste la source
  // de vérité, homeId n'est renseigné qu'une fois le qualifié connu).
  for (const m of bracket) {
    if (typeof m.homeId === 'string' && parseQualToken(m.homeId)) {
      m.homeToken = m.homeId;
      m.homeId = null;
    }
    if (typeof m.awayId === 'string' && parseQualToken(m.awayId)) {
      m.awayToken = m.awayId;
      m.awayId = null;
    }
  }

  return { divisions, matches: groupMatches.concat(bracket) };
}
