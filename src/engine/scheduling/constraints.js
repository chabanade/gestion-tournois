// @ts-check

/**
 * Vérifie les invariants d'un planning. Utilisé après génération ET après
 * chaque édition manuelle (drag & drop) : on ne fait jamais confiance au DOM.
 *
 * @param {import('../types.js').Match[]} matches matchs avec un `slot` affecté
 * @returns {{ok: boolean, violations: {type:string, message:string, matchId?:string}[]}}
 */
export function validateSchedule(matches) {
  /** @type {{type:string, message:string, matchId?:string}[]} */
  const violations = [];
  const scheduled = matches.filter((m) => m.slot);

  // Regroupe par créneau (startMin).
  /** @type {Map<number, import('../types.js').Match[]>} */
  const bySlot = new Map();
  for (const m of scheduled) {
    const key = /** @type {number} */ (m.slot?.startMin);
    if (!bySlot.has(key)) bySlot.set(key, []);
    bySlot.get(key)?.push(m);
  }

  for (const [start, group] of bySlot) {
    // Deux matchs sur le même terrain au même créneau ?
    const courts = new Set();
    const teams = new Set();
    for (const m of group) {
      const c = m.slot?.court;
      if (c !== undefined) {
        if (courts.has(c)) violations.push({ type: 'courtClash', matchId: m.id, message: `Terrain ${c} occupé deux fois à ${fmt(start)}.` });
        courts.add(c);
      }
      for (const t of [m.homeId, m.awayId]) {
        if (t === null) continue;
        if (teams.has(t)) violations.push({ type: 'teamClash', matchId: m.id, message: `Une équipe joue deux fois à ${fmt(start)}.` });
        teams.add(t);
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

/** @param {number} min */
function fmt(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
