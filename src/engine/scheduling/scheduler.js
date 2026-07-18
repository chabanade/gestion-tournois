// @ts-check

/**
 * @typedef {Object} ScheduleWarning
 * @property {'backToBack'|'overflowEnd'|'unplaced'} type
 * @property {string} message
 * @property {string} [matchId]
 */

/**
 * Heure de début (minutes depuis minuit) d'un créneau.
 * @param {number} slotIndex
 * @param {import('../types.js').ScheduleConfig} cfg
 * @returns {number}
 */
export function slotStart(slotIndex, cfg) {
  return cfg.startMin + slotIndex * (cfg.matchDurationMin + cfg.breakMin);
}

/**
 * Génère le planning : affecte à chaque match un terrain et un créneau horaire.
 *
 * Contraintes respectées au mieux :
 * - un terrain ne reçoit qu'un match à la fois ;
 * - une équipe ne joue jamais deux matchs sur le même créneau ;
 * - `avoidBackToBack` : on évite qu'une équipe enchaîne des créneaux
 *   consécutifs (repos d'au moins `minRestSlots`) tant que c'est possible.
 * Ne jette jamais : renvoie des avertissements exploitables par l'UI.
 *
 * @param {import('../types.js').Match[]} matches
 * @param {import('../types.js').ScheduleConfig} cfg
 * @returns {{scheduled: import('../types.js').Match[], warnings: ScheduleWarning[]}}
 */
export function generateSchedule(matches, cfg) {
  const courts = Math.max(1, cfg.courts | 0);
  const gap = cfg.avoidBackToBack ? Math.max(1, cfg.minRestSlots ?? 1) : 0;
  /** @type {ScheduleWarning[]} */
  const warnings = [];

  // On planifie d'abord les poules (par journée), puis les phases finales
  // (par tour), pour respecter les dépendances de l'arbre.
  const ordered = matches.slice().sort((a, b) => {
    const pa = a.phase === 'group' ? 0 : 1;
    const pb = b.phase === 'group' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return a.round - b.round;
  });

  /** @type {{count:number, teams:Set<string>}[]} */
  const slots = [];
  /** @type {Map<string, Set<number>>} */
  const teamSlots = new Map();
  const ensureSlot = (i) => {
    while (slots.length <= i) slots.push({ count: 0, teams: new Set() });
    return slots[i];
  };
  const teamSet = (id) => {
    let s = teamSlots.get(id);
    if (!s) { s = new Set(); teamSlots.set(id, s); }
    return s;
  };

  const maxSlots = ordered.length * 2 + courts + 10;
  const scheduled = ordered.map((m) => ({ ...m }));

  for (const m of scheduled) {
    const teams = [m.homeId, m.awayId].filter((t) => t !== null);
    let placed = -1;

    // Passe 1 : respect complet des contraintes (dont anti-back-to-back).
    for (let i = 0; i < maxSlots; i++) {
      if (canPlace(i, teams, ensureSlot(i), teamSlots, courts, gap)) { placed = i; break; }
    }
    // Passe 2 : on relâche l'anti-back-to-back si nécessaire.
    if (placed === -1 && gap > 0) {
      for (let i = 0; i < maxSlots; i++) {
        if (canPlace(i, teams, ensureSlot(i), teamSlots, courts, 0)) { placed = i; break; }
      }
      if (placed !== -1) {
        warnings.push({ type: 'backToBack', matchId: m.id, message: `Match ${m.id} : repos insuffisant, planifié quand même.` });
      }
    }
    if (placed === -1) {
      placed = slots.length; // nouveau créneau en fin de journée
      warnings.push({ type: 'unplaced', matchId: m.id, message: `Match ${m.id} : placé en fin de planning (contraintes serrées).` });
    }

    const slot = ensureSlot(placed);
    const court = slot.count + 1;
    slot.count += 1;
    for (const t of teams) { slot.teams.add(/** @type {string} */ (t)); teamSet(/** @type {string} */ (t)).add(placed); }

    const start = slotStart(placed, cfg);
    const end = start + cfg.matchDurationMin;
    m.slot = { court, startMin: start, endMin: end };
    if (typeof cfg.endMin === 'number' && end > cfg.endMin) {
      warnings.push({ type: 'overflowEnd', matchId: m.id, message: `Match ${m.id} : dépasse l'heure de fin prévue.` });
    }
  }

  return { scheduled, warnings };
}

/**
 * @param {number} slotIndex
 * @param {(string|null)[]} teams
 * @param {{count:number, teams:Set<string>}} slot
 * @param {Map<string, Set<number>>} teamSlots
 * @param {number} courts
 * @param {number} gap
 * @returns {boolean}
 */
function canPlace(slotIndex, teams, slot, teamSlots, courts, gap) {
  if (slot.count >= courts) return false;
  for (const t of teams) {
    if (t === null) continue;
    if (slot.teams.has(t)) return false;
    if (gap > 0) {
      const used = teamSlots.get(t);
      if (used) {
        for (let d = 1; d <= gap; d++) {
          if (used.has(slotIndex - d) || used.has(slotIndex + d)) return false;
        }
      }
    }
  }
  return true;
}
