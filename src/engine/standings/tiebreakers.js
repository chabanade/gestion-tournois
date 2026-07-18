// @ts-check
import { shuffle } from '../ids.js';
import { buildHeadToHeadTable } from './headToHead.js';

/**
 * Sens de tri par défaut de chaque critère (desc = plus grand d'abord).
 * @type {Record<string, 'asc'|'desc'>}
 */
const DEFAULT_DIRECTION = {
  points: 'desc',
  goalDiff: 'desc',
  goalsFor: 'desc',
  goalsAgainst: 'asc', // encaisser moins est mieux
  wins: 'desc',
  disciplinary: 'asc', // moins de cartons est mieux
};

/**
 * Applique UN critère à un groupe d'équipes à égalité et renvoie une liste
 * ORDONNÉE de sous-groupes (le meilleur d'abord). Un sous-groupe de taille > 1
 * signifie que le critère n'a pas départagé ces équipes : elles seront
 * ré-attaquées avec le critère suivant.
 *
 * @param {import('../types.js').Standing[]} group
 * @param {import('../types.js').Tiebreaker} rule
 * @param {import('../types.js').Match[]} matches
 * @param {import('../types.js').Ruleset} ruleset
 * @param {() => number} rng
 * @returns {import('../types.js').Standing[][]}
 */
export function applyCriterion(group, rule, matches, ruleset, rng) {
  if (rule.id === 'drawLots') {
    // Tirage au sort DÉTERMINISTE : sépare toujours, chaque équipe seule.
    const drawn = shuffle(group, rng);
    return drawn.map((s) => [s]);
  }

  if (rule.id === 'headToHead') {
    const ids = group.map((s) => s.teamId);
    const table = buildHeadToHeadTable(ids, matches, ruleset);
    // Confrontation directe incomplète (toutes les équipes n'ont pas joué
    // entre elles le même nombre de fois) → on ne s'en sert pas : un seul
    // sous-groupe, le critère suivant tranchera.
    const playedCounts = ids.map((id) => table.get(id)?.played ?? 0);
    const allEqual = playedCounts.every((c) => c === playedCounts[0]);
    if (!allEqual || playedCounts[0] === 0) {
      return [group.slice()];
    }
    // Classement du mini-championnat : points, puis diff, puis buts marqués.
    const keyed = group.map((s) => {
      const t = table.get(s.teamId);
      return { s, k: [t?.points ?? 0, t?.goalDiff ?? 0, t?.goalsFor ?? 0] };
    });
    return bucketize(keyed, ['desc', 'desc', 'desc']);
  }

  // Critères scalaires classiques.
  const dir = rule.direction || DEFAULT_DIRECTION[rule.id] || 'desc';
  const keyed = group.map((s) => ({ s, k: [scalarValue(s, rule.id)] }));
  return bucketize(keyed, [dir]);
}

/**
 * @param {import('../types.js').Standing} s
 * @param {string} id
 * @returns {number}
 */
function scalarValue(s, id) {
  switch (id) {
    case 'points': return s.points;
    case 'goalDiff': return s.goalDiff;
    case 'goalsFor': return s.goalsFor;
    case 'goalsAgainst': return s.goalsAgainst;
    case 'wins': return s.won;
    case 'disciplinary': return s.disciplinary;
    default: return 0;
  }
}

/**
 * Regroupe des éléments {s, k:number[]} en sous-groupes ordonnés par clés
 * composites, chaque dimension triée selon la direction correspondante.
 * @param {{s: import('../types.js').Standing, k: number[]}[]} keyed
 * @param {('asc'|'desc')[]} directions
 * @returns {import('../types.js').Standing[][]}
 */
function bucketize(keyed, directions) {
  const sorted = keyed.slice().sort((a, b) => compareKeys(a.k, b.k, directions));
  /** @type {import('../types.js').Standing[][]} */
  const buckets = [];
  let currentKey = null;
  for (const item of sorted) {
    if (currentKey === null || compareKeys(item.k, currentKey, directions) !== 0) {
      buckets.push([item.s]);
      currentKey = item.k;
    } else {
      buckets[buckets.length - 1].push(item.s);
    }
  }
  return buckets;
}

/**
 * @param {number[]} a
 * @param {number[]} b
 * @param {('asc'|'desc')[]} directions
 * @returns {number}
 */
function compareKeys(a, b, directions) {
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    const dir = directions[i] || 'desc';
    return dir === 'desc' ? b[i] - a[i] : a[i] - b[i];
  }
  return 0;
}

/**
 * Ordonne récursivement un groupe d'équipes à égalité en appliquant les
 * critères de départage dans l'ordre. C'est LE point critique : lorsqu'un
 * critère ne sépare que partiellement (ex : à 3, la confrontation directe
 * n'isole qu'une équipe), les sous-groupes encore à égalité sont ré-attaqués
 * avec le critère SUIVANT (récursion).
 *
 * @param {import('../types.js').Standing[]} group
 * @param {import('../types.js').Tiebreaker[]} rules
 * @param {number} ruleIndex
 * @param {import('../types.js').Match[]} matches
 * @param {import('../types.js').Ruleset} ruleset
 * @param {() => number} rng
 * @returns {import('../types.js').Standing[]}
 */
export function breakTies(group, rules, ruleIndex, matches, ruleset, rng) {
  if (group.length <= 1) return group;
  if (ruleIndex >= rules.length) {
    // Tous les critères épuisés : ex aequo irréductible, on le signale.
    const ids = group.map((s) => s.teamId);
    for (const s of group) s.tiedWith = ids.filter((id) => id !== s.teamId);
    return group;
  }

  const rule = rules[ruleIndex];
  const buckets = applyCriterion(group, rule, matches, ruleset, rng);

  // Le critère n'a rien séparé : on passe au suivant sur le même groupe.
  if (buckets.length === 1 && buckets[0].length === group.length) {
    return breakTies(group, rules, ruleIndex + 1, matches, ruleset, rng);
  }

  /** @type {import('../types.js').Standing[]} */
  const result = [];
  for (const bucket of buckets) {
    if (bucket.length === 1) {
      if (!bucket[0].resolvedBy) bucket[0].resolvedBy = rule.id;
      result.push(bucket[0]);
    } else {
      // Sous-groupe encore à égalité : critère suivant.
      const ordered = breakTies(bucket, rules, ruleIndex + 1, matches, ruleset, rng);
      result.push(...ordered);
    }
  }
  return result;
}

/**
 * Trie et classe une liste de lignes de classement selon les critères ordonnés.
 * Assigne `rank` (1-indexé, rangs égaux pour ex aequo irréductibles).
 * @param {import('../types.js').Standing[]} rows
 * @param {import('../types.js').Tiebreaker[]} rules
 * @param {import('../types.js').Match[]} matches
 * @param {import('../types.js').Ruleset} ruleset
 * @param {() => number} rng
 * @returns {import('../types.js').Standing[]}
 */
export function rankTeams(rows, rules, matches, ruleset, rng) {
  const ordered = breakTies(rows.slice(), rules, 0, matches, ruleset, rng);
  let rank = 0;
  ordered.forEach((s, i) => {
    // Rang égal seulement si ex aequo irréductible avec le précédent.
    const prev = ordered[i - 1];
    const sameAsPrev = prev && prev.tiedWith && prev.tiedWith.includes(s.teamId);
    if (!sameAsPrev) rank = i + 1;
    s.rank = rank;
  });
  return ordered;
}
