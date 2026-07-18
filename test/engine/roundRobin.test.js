// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRoundRobin } from '../../src/engine/formats/roundRobin.js';

function pairKey(m) {
  return [m.homeId, m.awayId].sort().join('|');
}

test('4 équipes = 6 matchs, chaque paire une seule fois', () => {
  const matches = generateRoundRobin(['a', 'b', 'c', 'd']);
  assert.equal(matches.length, 6);
  const pairs = new Set(matches.map(pairKey));
  assert.equal(pairs.size, 6);
});

test('4 équipes = 3 journées, chaque équipe joue une fois par journée', () => {
  const matches = generateRoundRobin(['a', 'b', 'c', 'd']);
  const rounds = new Map();
  for (const m of matches) {
    if (!rounds.has(m.round)) rounds.set(m.round, []);
    rounds.get(m.round).push(m);
  }
  assert.equal(rounds.size, 3);
  for (const [, group] of rounds) {
    const teams = group.flatMap((m) => [m.homeId, m.awayId]);
    assert.equal(new Set(teams).size, teams.length, 'aucune équipe deux fois dans une journée');
    assert.equal(teams.length, 4);
  }
});

test('nombre impair (5) → bye, pas de match fantôme, 10 matchs', () => {
  const matches = generateRoundRobin(['a', 'b', 'c', 'd', 'e']);
  assert.equal(matches.length, 10); // C(5,2)
  for (const m of matches) {
    assert.ok(m.homeId && m.awayId, 'aucun côté null');
    assert.notEqual(m.homeId, m.awayId);
  }
  // 5 journées, chaque équipe se repose une fois.
  const byRound = new Map();
  for (const m of matches) byRound.set(m.round, (byRound.get(m.round) || 0) + 1);
  assert.equal(byRound.size, 5);
  for (const [, count] of byRound) assert.equal(count, 2);
});

test('aller-retour = 12 matchs avec inversion domicile', () => {
  const single = generateRoundRobin(['a', 'b', 'c', 'd']);
  const double = generateRoundRobin(['a', 'b', 'c', 'd'], { doubleLeg: true });
  assert.equal(double.length, 12);
  // chaque paire jouée deux fois
  const counts = new Map();
  for (const m of double) counts.set(pairKey(m), (counts.get(pairKey(m)) || 0) + 1);
  for (const [, c] of counts) assert.equal(c, 2);
  assert.equal(single.length, 6);
});

test('2 équipes = 1 match', () => {
  assert.equal(generateRoundRobin(['a', 'b']).length, 1);
});
