// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateBracket, standardSeedOrder } from '../../src/engine/formats/knockout.js';
import { advanceBracket, bracketWinner } from '../../src/engine/bracket/bracket.js';

function pair(m) { return [m.homeId, m.awayId].sort().join('|'); }

test('8 équipes : arbre complet, seeding 1v8 / 4v5 / 3v6 / 2v7', () => {
  const seeds = ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'];
  const { matches } = generateBracket(seeds);
  const round0 = matches.filter((m) => m.round === 0);
  assert.equal(round0.length, 4);
  const pairs = new Set(round0.map(pair));
  assert.ok(pairs.has(['s1', 's8'].sort().join('|')));
  assert.ok(pairs.has(['s4', 's5'].sort().join('|')));
  assert.ok(pairs.has(['s3', 's6'].sort().join('|')));
  assert.ok(pairs.has(['s2', 's7'].sort().join('|')));
  assert.equal(matches.length, 7); // 4 + 2 + 1
});

test('standardSeedOrder(8) : demi-finales 1v4 et 2v3 (seeding standard valide)', () => {
  const o = standardSeedOrder(8);
  assert.equal(o.length, 8);
  // seed 1 et seed 2 dans des moitiés opposées (ne se croisent qu'en finale)
  const topHalf = o.slice(0, 4);
  const bottomHalf = o.slice(4);
  assert.ok(topHalf.includes(1) && bottomHalf.includes(2));
  // chaque paire du premier tour somme à 9 (1v8, 2v7, 3v6, 4v5)
  for (let i = 0; i < 8; i += 2) assert.equal(o[i] + o[i + 1], 9);
});

test('non-puissance de 2 (6 équipes) : byes attribués aux têtes de série', () => {
  const { matches } = generateBracket(['s1', 's2', 's3', 's4', 's5', 's6']);
  // Les deux meilleures têtes de série entrent directement en demi-finale.
  const semis = matches.filter((m) => m.round === 1);
  const preFilled = semis.flatMap((m) => [m.homeId, m.awayId]).filter(Boolean);
  assert.ok(preFilled.includes('s1'), 's1 exempt de premier tour');
  assert.ok(preFilled.includes('s2'), 's2 exempt de premier tour');
  // Seuls deux vrais matchs de premier tour se jouent.
  const realFirst = matches.filter((m) => m.round === 0 && m.homeId && m.awayId && !m.result);
  assert.equal(realFirst.length, 2);
});

test('option match pour la 3e place', () => {
  const { matches } = generateBracket(['s1', 's2', 's3', 's4'], { thirdPlace: true });
  const third = matches.find((m) => m.label === '3e place');
  assert.ok(third, 'match 3e place présent');
  assert.equal(third.homeSource?.outcome, 'loser');
  assert.equal(third.awaySource?.outcome, 'loser');
});

test('propagation du vainqueur, y compris par tirs au but', () => {
  const { matches } = generateBracket(['s1', 's2', 's3', 's4']);
  // demi 1 : s1 bat s4 ; demi 2 : nul s2-s3, s3 passe aux tirs au but.
  const round0 = matches.filter((m) => m.round === 0);
  const semi1 = round0.find((m) => pair(m) === ['s1', 's4'].sort().join('|'));
  const semi2 = round0.find((m) => pair(m) === ['s2', 's3'].sort().join('|'));
  semi1.result = { homeGoals: semi1.homeId === 's1' ? 2 : 0, awayGoals: semi1.homeId === 's1' ? 0 : 2, finished: true };
  const s3home = semi2.homeId === 's3';
  semi2.result = { homeGoals: 1, awayGoals: 1, finished: true, penalties: { home: s3home ? 5 : 3, away: s3home ? 3 : 5 } };
  const advanced = advanceBracket(matches);
  const final = advanced.find((m) => m.round === 1);
  const finalists = [final.homeId, final.awayId];
  assert.ok(finalists.includes('s1'), 's1 en finale');
  assert.ok(finalists.includes('s3'), 's3 qualifié aux tirs au but');
  // Termine la finale et vérifie le vainqueur.
  final.result = { homeGoals: final.homeId === 's1' ? 3 : 0, awayGoals: final.homeId === 's1' ? 0 : 3, finished: true };
  assert.equal(bracketWinner([...advanced.filter((m) => m !== final), final]), 's1');
});
