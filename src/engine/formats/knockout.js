// @ts-check
import { makeId } from '../ids.js';

/**
 * Ordre de placement standard des têtes de série dans un arbre de taille `size`
 * (puissance de 2). Retourne, pour chaque position de l'arbre, le numéro de
 * tête de série qui doit s'y trouver. Garantit que seed 1 et seed 2 ne peuvent
 * se croiser qu'en finale, etc.
 * @param {number} size
 * @returns {number[]}
 */
export function standardSeedOrder(size) {
  let seeds = [1, 2];
  while (seeds.length < size) {
    const sum = seeds.length * 2 + 1;
    /** @type {number[]} */
    const next = [];
    for (const s of seeds) {
      next.push(s);
      next.push(sum - s);
    }
    seeds = next;
  }
  return seeds;
}

/** Plus petite puissance de 2 >= n. */
export function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/**
 * Génère un arbre à élimination directe.
 *
 * `entrants` est fourni DANS L'ORDRE DES TÊTES DE SÉRIE (index 0 = seed 1).
 * Ce sont des identifiants d'équipes réels OU des jetons de qualification
 * (ex "QUAL:1A") résolus plus tard. Si le nombre d'entrants n'est pas une
 * puissance de 2, les byes sont attribués aux meilleures têtes de série :
 * elles entrent directement au 2e tour.
 *
 * @param {string[]} entrants ordre têtes de série
 * @param {{thirdPlace?:boolean, makeId?:(p?:string)=>string}} [opts]
 * @returns {{matches: import('../types.js').Match[]}}
 */
export function generateBracket(entrants, opts = {}) {
  const mkId = opts.makeId || ((p) => makeId(p));
  const n = entrants.length;
  if (n < 2) return { matches: [] };

  const size = nextPow2(n);
  const order = standardSeedOrder(size); // longueur = size
  // position i de l'arbre -> entrant (ou null si bye)
  /** @type {(string|null)[]} */
  const positions = order.map((seed) => (seed <= n ? entrants[seed - 1] : null));

  const totalRounds = Math.log2(size);
  /** @type {import('../types.js').Match[]} */
  const matches = [];
  // matrice des matchs par tour ; [round][slot]
  /** @type {import('../types.js').Match[][]} */
  const byRound = [];

  // --- Premier tour (round 0) ---
  /** @type {import('../types.js').Match[]} */
  const round0 = [];
  for (let i = 0; i < size / 2; i++) {
    const a = positions[i * 2];
    const b = positions[i * 2 + 1];
    const m = baseMatch(mkId, 0, i, totalRounds);
    m.homeId = a;
    m.awayId = b;
    round0.push(m);
    matches.push(m);
  }
  byRound.push(round0);

  // --- Tours suivants ---
  for (let r = 1; r < totalRounds; r++) {
    /** @type {import('../types.js').Match[]} */
    const roundMatches = [];
    const prev = byRound[r - 1];
    for (let i = 0; i < prev.length / 2; i++) {
      const m = baseMatch(mkId, r, i, totalRounds);
      m.homeSource = { matchId: prev[i * 2].id, outcome: 'winner' };
      m.awaySource = { matchId: prev[i * 2 + 1].id, outcome: 'winner' };
      roundMatches.push(m);
      matches.push(m);
    }
    byRound.push(roundMatches);
  }

  // Résoud immédiatement les byes du premier tour : si un côté est null, le
  // qualifié réel monte directement dans le match du tour suivant.
  resolveByes(byRound);

  // Match pour la 3e place (perdants des demi-finales).
  if (opts.thirdPlace && totalRounds >= 2) {
    const semis = byRound[totalRounds - 2];
    if (semis.length === 2) {
      const third = baseMatch(mkId, totalRounds - 1, 1, totalRounds);
      third.label = '3e place';
      third.homeSource = { matchId: semis[0].id, outcome: 'loser' };
      third.awaySource = { matchId: semis[1].id, outcome: 'loser' };
      matches.push(third);
    }
  }

  // Étiquette la finale.
  const finalMatch = byRound[totalRounds - 1][0];
  if (finalMatch) finalMatch.label = 'Finale';

  return { matches };
}

/**
 * @param {(p?:string)=>string} mkId
 * @param {number} round
 * @param {number} slot
 * @param {number} totalRounds
 * @returns {import('../types.js').Match}
 */
function baseMatch(mkId, round, slot, totalRounds) {
  const remaining = totalRounds - round;
  let label;
  if (remaining === 1) label = 'Finale';
  else if (remaining === 2) label = 'Demi-finale';
  else if (remaining === 3) label = 'Quart de finale';
  return {
    id: mkId('m'),
    phase: 'knockout',
    round,
    slotInRound: slot,
    homeId: null,
    awayId: null,
    label,
  };
}

/**
 * Propage les byes du premier tour : une position vide (bye) fait monter
 * automatiquement le qualifié réel au tour suivant, sans créer de match fictif.
 * @param {import('../types.js').Match[][]} byRound
 */
function resolveByes(byRound) {
  const round0 = byRound[0];
  if (byRound.length < 2) return;
  const round1 = byRound[1];
  for (let i = 0; i < round0.length; i++) {
    const m = round0[i];
    const hasHome = m.homeId !== null;
    const hasAway = m.awayId !== null;
    if (hasHome && hasAway) continue; // vrai match, rien à faire
    // Un seul côté réel : c'est un bye.
    const advancing = hasHome ? m.homeId : hasAway ? m.awayId : null;
    // On neutralise le match du premier tour (il ne se joue pas).
    m.result = advancing
      ? { homeGoals: hasHome ? 1 : 0, awayGoals: hasAway ? 1 : 0, finished: true, forfeit: null }
      : undefined;
    m.label = m.label ? m.label : 'Exempt';
    // On place le qualifié directement dans le match du tour suivant.
    const nextMatch = round1[Math.floor(i / 2)];
    if (!nextMatch) continue;
    const src = { matchId: m.id, outcome: /** @type {'winner'} */ ('winner') };
    if (i % 2 === 0) {
      nextMatch.homeSource = src;
      if (advancing) nextMatch.homeId = advancing;
    } else {
      nextMatch.awaySource = src;
      if (advancing) nextMatch.awayId = advancing;
    }
  }
}
