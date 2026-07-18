// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult, matchWinner, resolveSide } from '../../src/engine/scoring/score.js';
import { DEFAULT_RULESET } from '../../src/engine/types.js';

test('normalizeResult : forfait applique le score forfaitaire', () => {
  const r = normalizeResult({ homeGoals: 9, awayGoals: 9, forfeit: 'home', finished: true }, DEFAULT_RULESET);
  assert.equal(r.homeGoals, 0);
  assert.equal(r.awayGoals, 3);
  // ne modifie pas l'entrée
});

test('matchWinner : buts, puis tirs au but si nul', () => {
  assert.equal(matchWinner({ result: { homeGoals: 2, awayGoals: 1, finished: true } }), 'home');
  assert.equal(matchWinner({ result: { homeGoals: 0, awayGoals: 1, finished: true } }), 'away');
  assert.equal(matchWinner({ result: { homeGoals: 1, awayGoals: 1, finished: true } }), 'draw');
  assert.equal(matchWinner({ result: { homeGoals: 1, awayGoals: 1, penalties: { home: 5, away: 4 }, finished: true } }), 'home');
  assert.equal(matchWinner({ result: { homeGoals: 2, awayGoals: 2, forfeit: 'away', finished: true } }), 'home');
  assert.equal(matchWinner({ result: { finished: false, homeGoals: 0, awayGoals: 0 } }), null);
});

test('resolveSide : vainqueur/perdant d\'un match source', () => {
  const src = { id: 'm1', homeId: 'a', awayId: 'b', result: { homeGoals: 3, awayGoals: 1, finished: true } };
  const byId = new Map([['m1', src]]);
  assert.equal(resolveSide({ matchId: 'm1', outcome: 'winner' }, byId), 'a');
  assert.equal(resolveSide({ matchId: 'm1', outcome: 'loser' }, byId), 'b');
  // match non terminé → null
  const byId2 = new Map([['m1', { ...src, result: { homeGoals: 0, awayGoals: 0, finished: false } }]]);
  assert.equal(resolveSide({ matchId: 'm1', outcome: 'winner' }, byId2), null);
});
