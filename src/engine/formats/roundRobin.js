// @ts-check
import { makeId } from '../ids.js';

/**
 * Génère un championnat toutes rondes (round-robin) par la MÉTHODE DU CERCLE.
 * Chaque équipe rencontre toutes les autres une fois (aller) ou deux (aller-retour).
 *
 * Méthode du cercle : on fixe une équipe, on fait tourner les autres. Nombre
 * impair d'équipes → on ajoute un "bye" (repos) : l'équipe opposée au bye ne
 * joue pas cette journée. Aucun match fantôme n'est produit.
 *
 * @param {string[]} teamIds
 * @param {{doubleLeg?:boolean, divisionId?:string, phase?:'group'|'knockout', startRound?:number, makeId?:(p?:string)=>string}} [opts]
 * @returns {import('../types.js').Match[]}
 */
export function generateRoundRobin(teamIds, opts = {}) {
  const { doubleLeg = false, divisionId, phase = 'group', startRound = 0 } = opts;
  const mkId = opts.makeId || ((p) => makeId(p));
  const ids = teamIds.slice();
  const BYE = null;
  if (ids.length < 2) return [];

  // Nombre impair → on insère un fantôme (bye) pour l'algorithme du cercle.
  /** @type {(string|null)[]} */
  const players = ids.length % 2 === 0 ? ids.slice() : ids.concat([/** @type {any} */ (BYE)]);
  const n = players.length;
  const rounds = n - 1;
  const half = n / 2;

  /** @type {import('../types.js').Match[]} */
  const matches = [];
  // arr[0] est fixe ; les autres tournent.
  let arr = players.slice();

  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const home = arr[i];
      const away = arr[n - 1 - i];
      if (home === BYE || away === BYE) continue; // équipe au repos cette journée
      // Alternance domicile/extérieur pour équilibrer.
      const swap = r % 2 === 1;
      matches.push(makeMatch(
        swap ? away : home,
        swap ? home : away,
        startRound + r,
        divisionId,
        phase,
        mkId,
      ));
    }
    // rotation : on garde arr[0], on fait pivoter le reste dans le sens horaire.
    arr = [arr[0], arr[n - 1], ...arr.slice(1, n - 1)];
  }

  if (doubleLeg) {
    const legTwo = matches.map((m) => makeMatch(
      /** @type {string} */ (m.awayId),
      /** @type {string} */ (m.homeId),
      m.round + rounds,
      divisionId,
      phase,
      mkId,
    ));
    return matches.concat(legTwo);
  }
  return matches;
}

/**
 * @param {string} homeId
 * @param {string} awayId
 * @param {number} round
 * @param {string|undefined} divisionId
 * @param {'group'|'knockout'} phase
 * @param {(p?:string)=>string} mkId
 * @returns {import('../types.js').Match}
 */
function makeMatch(homeId, awayId, round, divisionId, phase, mkId) {
  return {
    id: mkId('m'),
    divisionId,
    phase,
    round,
    homeId,
    awayId,
  };
}
