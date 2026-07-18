// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCommand, createTournament } from '../../src/engine/commands/reducer.js';
import * as cmd from '../../src/engine/commands/commands.js';
import { computeStandings } from '../../src/engine/standings/standings.js';

function build() {
  let t = createTournament({ name: 'Test', format: 'groupsKnockout', id: 'T1', rngSeed: 'seed' });
  const teams = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((n, i) => ({ id: n, name: n, seed: i + 1 }));
  t = applyCommand(t, cmd.setTeams(teams)).state;
  t = applyCommand(t, cmd.generateStructure({ groupCount: 2, qualifiersPerGroup: 2, thirdPlace: true })).state;
  return t;
}

test('le réducteur est pur : n\'altère pas l\'état d\'entrée, incrémente seq', () => {
  const t = createTournament({ id: 'T', rngSeed: 's' });
  const before = JSON.parse(JSON.stringify(t));
  const { state } = applyCommand(t, cmd.setName('Coupe'));
  assert.deepEqual(t, before, 'état initial inchangé');
  assert.equal(state.name, 'Coupe');
  assert.equal(state.seq, t.seq + 1);
});

test('generateStructure : poules + arbre + rattachement des équipes', () => {
  const t = build();
  assert.equal(t.divisions.length, 2);
  assert.equal(t.teams.every((team) => team.divisionId), true, 'chaque équipe a une poule');
  const groupMatches = t.matches.filter((m) => m.phase === 'group');
  const knockout = t.matches.filter((m) => m.phase === 'knockout');
  // 2 poules de 4 → 6 matchs chacune = 12 ; arbre de 4 qualifiés + 3e place.
  assert.equal(groupMatches.length, 12);
  assert.ok(knockout.length >= 3);
});

test('SET_RESULT recalcule et remonte les qualifiés dans l\'arbre', () => {
  let t = build();
  // Termine toute la poule A avec un ordre clair.
  const divA = t.divisions[0];
  const teamsA = divA.teamIds;
  // Fait gagner systématiquement la première équipe listée de chaque match.
  for (const m of t.matches.filter((mm) => mm.phase === 'group' && mm.divisionId === divA.id)) {
    t = applyCommand(t, cmd.setResult(m.id, { homeGoals: 2, awayGoals: 0 })).state;
  }
  for (const m of t.matches.filter((mm) => mm.phase === 'group' && mm.divisionId === t.divisions[1].id)) {
    t = applyCommand(t, cmd.setResult(m.id, { homeGoals: 1, awayGoals: 0 })).state;
  }
  // Les deux poules terminées → l'arbre doit être peuplé de vraies équipes.
  const knockout = t.matches.filter((m) => m.phase === 'knockout' && m.round === 0);
  const filled = knockout.every((m) => typeof m.homeId === 'string' && typeof m.awayId === 'string' && !m.homeId.startsWith('Q:') && !m.awayId.startsWith('Q:'));
  assert.ok(filled, 'les jetons de qualification sont résolus');
  // Le premier de la poule A est bien un des qualifiés de l'arbre.
  const stA = computeStandings(t.divisions[0], t.matches, t.ruleset, t.rngSeed);
  const bracketTeams = new Set(knockout.flatMap((m) => [m.homeId, m.awayId]));
  assert.ok(bracketTeams.has(stA[0].teamId));
});

test('CLEAR_RESULT annule un résultat', () => {
  let t = build();
  const m = t.matches.find((mm) => mm.phase === 'group');
  t = applyCommand(t, cmd.setResult(m.id, { homeGoals: 3, awayGoals: 1 })).state;
  assert.ok(t.matches.find((mm) => mm.id === m.id).result);
  t = applyCommand(t, cmd.clearResult(m.id)).state;
  assert.equal(t.matches.find((mm) => mm.id === m.id).result, undefined);
});

test('GENERATE_SCHEDULE affecte des créneaux', () => {
  let t = build();
  t = applyCommand(t, cmd.setSchedule({ courts: 2 })).state;
  const res = applyCommand(t, cmd.generateScheduleCmd());
  t = res.state;
  assert.ok(t.matches.filter((m) => m.phase === 'group').every((m) => m.slot));
});
