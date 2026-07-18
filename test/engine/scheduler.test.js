// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateRoundRobin } from '../../src/engine/formats/roundRobin.js';
import { generateSchedule, slotStart } from '../../src/engine/scheduling/scheduler.js';
import { validateSchedule } from '../../src/engine/scheduling/constraints.js';

const CFG = { courts: 1, matchDurationMin: 15, breakMin: 5, startMin: 540, avoidBackToBack: true, minRestSlots: 1 };
const slotIndex = (m, cfg) => Math.round((m.slot.startMin - cfg.startMin) / (cfg.matchDurationMin + cfg.breakMin));

test('1 terrain : jamais deux matchs en même temps, horaires réguliers', () => {
  const matches = generateRoundRobin(['a', 'b', 'c', 'd']);
  const { scheduled } = generateSchedule(matches, CFG);
  assert.ok(validateSchedule(scheduled).ok);
  // 1 terrain → tous les créneaux sont distincts.
  const starts = scheduled.map((m) => m.slot.startMin);
  assert.equal(new Set(starts).size, scheduled.length);
  // horaires = début + k*(durée+pause)
  for (const m of scheduled) {
    const k = slotIndex(m, CFG);
    assert.equal(m.slot.startMin, slotStart(k, CFG));
    assert.equal(m.slot.endMin, m.slot.startMin + CFG.matchDurationMin);
  }
});

test('2 à 4 terrains : aucune équipe sur deux terrains au même créneau', () => {
  const matches = generateRoundRobin(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  for (const courts of [2, 3, 4]) {
    const cfg = { ...CFG, courts };
    const { scheduled } = generateSchedule(matches, cfg);
    const res = validateSchedule(scheduled);
    assert.ok(res.ok, `collision détectée avec ${courts} terrains: ${JSON.stringify(res.violations)}`);
    // au plus `courts` matchs par créneau
    const bySlot = new Map();
    for (const m of scheduled) bySlot.set(m.slot.startMin, (bySlot.get(m.slot.startMin) || 0) + 1);
    for (const [, c] of bySlot) assert.ok(c <= courts);
  }
});

test('avoidBackToBack : aucune équipe sur deux créneaux consécutifs', () => {
  const matches = generateRoundRobin(['a', 'b', 'c', 'd', 'e', 'f']);
  const cfg = { ...CFG, courts: 3 };
  const { scheduled, warnings } = generateSchedule(matches, cfg);
  const teamSlots = new Map();
  for (const m of scheduled) {
    for (const t of [m.homeId, m.awayId]) {
      if (!teamSlots.has(t)) teamSlots.set(t, []);
      teamSlots.get(t).push(slotIndex(m, cfg));
    }
  }
  for (const [team, slots] of teamSlots) {
    slots.sort((a, b) => a - b);
    for (let i = 1; i < slots.length; i++) {
      assert.ok(slots[i] - slots[i - 1] >= 2, `${team} enchaîne les créneaux ${slots[i - 1]} et ${slots[i]}`);
    }
  }
  assert.equal(warnings.filter((w) => w.type === 'backToBack').length, 0);
});

test('dépassement de l\'heure de fin → avertissement', () => {
  const matches = generateRoundRobin(['a', 'b', 'c', 'd']);
  const cfg = { ...CFG, courts: 1, endMin: 560 }; // très serré
  const { warnings } = generateSchedule(matches, cfg);
  assert.ok(warnings.some((w) => w.type === 'overflowEnd'));
});

test('édition manuelle incohérente → violation détectée', () => {
  const matches = generateRoundRobin(['a', 'b', 'c', 'd']);
  const { scheduled } = generateSchedule(matches, { ...CFG, courts: 2 });
  // Force deux matchs partageant une équipe sur le même créneau/terrain.
  const withA = scheduled.filter((m) => m.homeId === 'a' || m.awayId === 'a');
  withA[1].slot = { ...withA[0].slot };
  const res = validateSchedule(scheduled);
  assert.equal(res.ok, false);
});
