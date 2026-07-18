// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoGroups, generateGroupMatches } from '../../src/engine/formats/groups.js';
import { makeTeams } from '../helpers.js';

test('répartition serpent équilibrée par têtes de série', () => {
  const teams = makeTeams(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']); // seeds 1..8
  const divisions = splitIntoGroups(teams, 2);
  assert.equal(divisions.length, 2);
  // Serpent : A = seeds 1,4,5,8 ; B = seeds 2,3,6,7 → forces équilibrées.
  assert.equal(divisions[0].teamIds.length, 4);
  assert.equal(divisions[1].teamIds.length, 4);
  assert.ok(divisions[0].teamIds.includes('a')); // seed 1 en A
  assert.ok(divisions[1].teamIds.includes('b')); // seed 2 en B
  assert.ok(divisions[0].teamIds.includes('d')); // seed 4 en A (serpent)
});

test('nombre d\'équipes impair réparti au mieux', () => {
  const teams = makeTeams(['a', 'b', 'c', 'd', 'e']);
  const divisions = splitIntoGroups(teams, 2);
  const sizes = divisions.map((d) => d.teamIds.length).sort();
  assert.deepEqual(sizes, [2, 3]);
});

test('matchs de poule = round-robin dans chaque division', () => {
  const teams = makeTeams(['a', 'b', 'c', 'd', 'e', 'f']);
  const divisions = splitIntoGroups(teams, 2); // 2 poules de 3
  const matches = generateGroupMatches(divisions);
  // 3 matchs par poule × 2 = 6
  assert.equal(matches.length, 6);
  assert.ok(matches.every((m) => m.phase === 'group' && m.divisionId));
});
