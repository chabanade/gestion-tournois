// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankTeams } from '../../src/engine/standings/tiebreakers.js';
import { computeStandings } from '../../src/engine/standings/standings.js';
import { buildHeadToHeadTable } from '../../src/engine/standings/headToHead.js';
import { makeRng } from '../../src/engine/ids.js';
import { DEFAULT_RULESET } from '../../src/engine/types.js';
import { order, groupMatch } from '../helpers.js';

/** Fabrique une ligne de classement complète. */
function row(teamId, p = {}) {
  return {
    teamId, rank: 0, played: p.played ?? 0, won: p.won ?? 0, drawn: p.drawn ?? 0, lost: p.lost ?? 0,
    goalsFor: p.goalsFor ?? 0, goalsAgainst: p.goalsAgainst ?? 0,
    goalDiff: p.goalDiff ?? 0, points: p.points ?? 0, disciplinary: p.disciplinary ?? 0,
  };
}

const rules = (...ids) => ids.map((id) => ({ id }));
const rng = () => makeRng('test');

test('cascade : points, puis différence, puis buts marqués', () => {
  const rows = [
    row('a', { points: 5, goalDiff: 5, goalsFor: 10 }),
    row('b', { points: 5, goalDiff: 2, goalsFor: 8 }),
    row('c', { points: 5, goalDiff: 2, goalsFor: 6 }),
    row('d', { points: 5, goalDiff: 0, goalsFor: 4 }),
  ];
  const ranked = rankTeams(rows, rules('points', 'goalDiff', 'goalsFor', 'drawLots'), [], DEFAULT_RULESET, rng());
  assert.deepEqual(order(ranked), ['a', 'b', 'c', 'd']);
});

test('SÉPARATION PARTIELLE à 3 → récursion au critère suivant (le bug classique)', () => {
  // Tous à égalité de points ET de différence pour {b,c} : goalDiff isole a et d,
  // b et c restent à égalité et doivent être départagés par le critère SUIVANT.
  const rows = [
    row('a', { points: 5, goalDiff: 5, goalsFor: 9 }),
    row('b', { points: 5, goalDiff: 2, goalsFor: 8 }),
    row('c', { points: 5, goalDiff: 2, goalsFor: 6 }),
    row('d', { points: 5, goalDiff: 0, goalsFor: 4 }),
  ];
  const ranked = rankTeams(rows, rules('points', 'goalDiff', 'goalsFor', 'drawLots'), [], DEFAULT_RULESET, rng());
  assert.deepEqual(order(ranked), ['a', 'b', 'c', 'd']);
  const byId = Object.fromEntries(ranked.map((s) => [s.teamId, s]));
  assert.equal(byId.a.resolvedBy, 'goalDiff'); // a isolé par la différence
  assert.equal(byId.b.resolvedBy, 'goalsFor'); // b/c départagés par les buts marqués
  assert.equal(byId.c.resolvedBy, 'goalsFor');
});

test('réordonner les critères change le classement sur les MÊMES données', () => {
  // a a battu b en direct, mais b a une meilleure différence générale.
  const rows = [
    row('a', { points: 4, goalDiff: 0, goalsFor: 1 }),
    row('b', { points: 4, goalDiff: 4, goalsFor: 5 }),
  ];
  const matches = [groupMatch('P', 'a', 'b', 1, 0)];
  const r1 = rankTeams(rows.map((s) => ({ ...s })), rules('points', 'headToHead', 'goalDiff', 'drawLots'), matches, DEFAULT_RULESET, rng());
  const r2 = rankTeams(rows.map((s) => ({ ...s })), rules('points', 'goalDiff', 'headToHead', 'drawLots'), matches, DEFAULT_RULESET, rng());
  assert.deepEqual(order(r1), ['a', 'b'], 'confrontation directe prioritaire → a devant');
  assert.deepEqual(order(r2), ['b', 'a'], 'différence prioritaire → b devant');
});

test('confrontation directe incomplète → on passe au critère suivant sans planter', () => {
  // c n'a joué contre personne du trio : H2H inexploitable, goalDiff tranche.
  const rows = [
    row('a', { points: 3, goalDiff: 1, goalsFor: 2 }),
    row('b', { points: 3, goalDiff: 0, goalsFor: 2 }),
    row('c', { points: 3, goalDiff: 5, goalsFor: 6 }),
  ];
  const matches = [groupMatch('P', 'a', 'b', 1, 0)]; // seuls a et b se sont rencontrés
  const ranked = rankTeams(rows, rules('points', 'headToHead', 'goalDiff', 'drawLots'), matches, DEFAULT_RULESET, rng());
  assert.deepEqual(order(ranked), ['c', 'a', 'b']); // suit la différence générale
});

test('confrontation directe à 3 (cycle) : H2H départage par diff/buts internes', () => {
  const div = { id: 'P', name: 'P', teamIds: ['a', 'b', 'c'] };
  const matches = [
    groupMatch('P', 'a', 'b', 3, 0),
    groupMatch('P', 'b', 'c', 2, 0),
    groupMatch('P', 'c', 'a', 1, 0),
  ];
  const ruleset = { ...DEFAULT_RULESET };
  const st = computeStandings(div, matches, ruleset, 'seed');
  // Tous à 3 pts ; H2H diff : a +2, b -1, c -1 ; buts internes : b 2 > c 1.
  assert.deepEqual(order(st), ['a', 'b', 'c']);
  assert.equal(st[0].resolvedBy, 'headToHead');
});

test('aller-retour : la confrontation directe agrège les deux manches', () => {
  const table = buildHeadToHeadTable(['a', 'b'], [
    groupMatch('P', 'a', 'b', 0, 1), // manche 1 : b gagne
    groupMatch('P', 'b', 'a', 0, 2), // manche 2 : a gagne largement
  ], DEFAULT_RULESET);
  const a = table.get('a');
  const b = table.get('b');
  assert.equal(a.played, 2);
  assert.equal(a.points, 3); // 1 victoire + 1 défaite
  assert.equal(b.points, 3);
  assert.equal(a.goalDiff, 1); // -1 puis +2
  assert.equal(b.goalDiff, -1);
});

test('forfait : score forfaitaire [0,3] et pénalité -1 point', () => {
  const div = { id: 'P', name: 'P', teamIds: ['a', 'b'] };
  const ruleset = { ...DEFAULT_RULESET, forfeitScore: [0, 3], forfeitLosePoints: -1 };
  const matches = [groupMatch('P', 'a', 'b', 9, 9, { forfeit: 'home' })];
  const st = computeStandings(div, matches, ruleset, 'seed');
  const byId = Object.fromEntries(st.map((s) => [s.teamId, s]));
  assert.equal(byId.b.goalsFor, 3, 'adversaire gagne 3-0');
  assert.equal(byId.a.goalsFor, 0);
  assert.equal(byId.b.points, 3);
  assert.equal(byId.a.points, -1, 'équipe forfait : 0 + pénalité -1');
});

test('fair-play : en départage vs intégré aux points', () => {
  const div = { id: 'P', name: 'P', teamIds: ['a', 'b'] };
  const matches = [groupMatch('P', 'a', 'b', 1, 1, { fairPlay: { home: 2, away: 0 } })];
  // Intégré aux points : a perd 2 points → b devant.
  const r1 = computeStandings(div, matches, { ...DEFAULT_RULESET, fairPlayAffectsPoints: true }, 'seed');
  assert.equal(order(r1)[0], 'b');
  // En départage seulement (critère disciplinary) : points égaux, moins de cartons gagne.
  const r2 = computeStandings(div, matches, {
    ...DEFAULT_RULESET, fairPlayAffectsPoints: false,
    tiebreakers: [{ id: 'points' }, { id: 'disciplinary' }, { id: 'drawLots' }],
  }, 'seed');
  assert.equal(order(r2)[0], 'b', 'moins de points disciplinaires devant');
  assert.equal(r2[0].resolvedBy, 'disciplinary');
});

test('tous les critères épuisés → ex aequo signalé (tiedWith), rangs égaux', () => {
  const rows = [
    row('a', { points: 3, goalDiff: 0, goalsFor: 1 }),
    row('b', { points: 3, goalDiff: 0, goalsFor: 1 }),
  ];
  const ranked = rankTeams(rows, rules('points', 'goalDiff', 'goalsFor'), [], DEFAULT_RULESET, rng());
  assert.ok(ranked[0].tiedWith?.length === 1);
  assert.equal(ranked[0].rank, ranked[1].rank, 'même rang pour ex aequo irréductible');
});

test('tirage au sort DÉTERMINISTE : même seed → même ordre après export/réimport', () => {
  const div = { id: 'P', name: 'P', teamIds: ['a', 'b', 'c'] };
  // Trois équipes strictement identiques → seul le tirage au sort tranche.
  const matches = [
    groupMatch('P', 'a', 'b', 1, 1),
    groupMatch('P', 'b', 'c', 1, 1),
    groupMatch('P', 'c', 'a', 1, 1),
  ];
  const st1 = computeStandings(div, matches, DEFAULT_RULESET, 'graine-42');
  // Simule un export/réimport JSON.
  const st2 = computeStandings(
    JSON.parse(JSON.stringify(div)),
    JSON.parse(JSON.stringify(matches)),
    JSON.parse(JSON.stringify(DEFAULT_RULESET)),
    'graine-42',
  );
  assert.deepEqual(order(st1), order(st2), 'ordre reproductible');
  assert.equal(st1[0].resolvedBy, 'drawLots');
  // Une graine différente peut donner un autre ordre (mais reste déterministe).
  const st3 = computeStandings(div, matches, DEFAULT_RULESET, 'autre-graine');
  assert.equal(order(st3).length, 3);
});
