// @ts-check
import { createStructure, resolveQualifiers } from '../formats/index.js';
import { advanceBracket } from '../bracket/bracket.js';
import { generateSchedule } from '../scheduling/scheduler.js';
import { DEFAULT_RULESET, DEFAULT_SCHEDULE } from '../types.js';
import { makeId } from '../ids.js';

/**
 * Crée un tournoi vierge.
 * @param {{name?:string, format?:import('../types.js').Format, rngSeed?:string, id?:string}} [init]
 * @returns {import('../types.js').Tournament}
 */
export function createTournament(init = {}) {
  return {
    id: init.id || makeId('t'),
    name: init.name || 'Nouveau tournoi',
    format: init.format || 'groupsKnockout',
    seq: 0,
    rngSeed: init.rngSeed || init.id || makeId('seed'),
    divisions: [],
    teams: [],
    matches: [],
    schedule: { ...DEFAULT_SCHEDULE },
    ruleset: { ...DEFAULT_RULESET, tiebreakers: DEFAULT_RULESET.tiebreakers.map((r) => ({ ...r })) },
    branding: {},
    options: {},
  };
}

/**
 * RÉDUCTEUR PUR : applique une commande et renvoie le nouvel état + les
 * événements. Ne modifie jamais l'entrée. C'est la frontière avec la future
 * couche temps réel : même signature côté serveur.
 *
 * @param {import('../types.js').Tournament} state
 * @param {{type:string, [k:string]:any}} command
 * @returns {{state: import('../types.js').Tournament, events: {type:string, [k:string]:any}[]}}
 */
export function applyCommand(state, command) {
  /** @type {import('../types.js').Tournament} */
  let next = { ...state, seq: state.seq + 1 };
  /** @type {{type:string, [k:string]:any}[]} */
  const events = [];

  switch (command.type) {
    case 'SET_NAME':
      next.name = command.name;
      break;

    case 'SET_TEAMS':
      next.teams = command.teams.map((/** @type {any} */ t) => ({ ...t }));
      break;

    case 'SET_BRANDING':
      next.branding = { ...next.branding, ...command.branding };
      break;

    case 'SET_RULESET':
      next.ruleset = { ...command.ruleset, tiebreakers: command.ruleset.tiebreakers.map((/** @type {any} */ r) => ({ ...r })) };
      next = reconcile(next);
      break;

    case 'SET_SCHEDULE':
      next.schedule = { ...next.schedule, ...command.schedule };
      break;

    case 'GENERATE_STRUCTURE': {
      const options = { ...next.options, ...command.options, rngSeed: next.rngSeed };
      const { divisions, matches } = createStructure(next.format, next.teams, options);
      next.divisions = divisions;
      // Rattache chaque équipe à sa poule.
      const divOf = new Map();
      for (const d of divisions) for (const id of d.teamIds) divOf.set(id, d.id);
      next.teams = next.teams.map((t) => ({ ...t, divisionId: divOf.get(t.id) }));
      next.matches = matches;
      next.options = { ...command.options };
      next = reconcile(next);
      events.push({ type: 'STRUCTURE_GENERATED' });
      break;
    }

    case 'GENERATE_SCHEDULE': {
      const { scheduled, warnings } = generateSchedule(next.matches, next.schedule);
      next.matches = scheduled;
      events.push({ type: 'SCHEDULE_GENERATED', warnings });
      break;
    }

    case 'SET_RESULT': {
      next.matches = next.matches.map((m) => (m.id === command.matchId ? { ...m, result: { ...command.result, finished: true } } : m));
      next = reconcile(next);
      events.push({ type: 'RESULT_SET', matchId: command.matchId });
      break;
    }

    case 'CLEAR_RESULT': {
      next.matches = next.matches.map((m) => (m.id === command.matchId ? { ...m, result: undefined } : m));
      next = reconcile(next);
      events.push({ type: 'RESULT_CLEARED', matchId: command.matchId });
      break;
    }

    case 'MOVE_MATCH':
      next.matches = next.matches.map((m) => (m.id === command.matchId ? { ...m, slot: { ...command.slot } } : m));
      break;

    case 'SWAP_MATCHES': {
      const a = next.matches.find((m) => m.id === command.aId);
      const b = next.matches.find((m) => m.id === command.bId);
      if (a && b) {
        const slotA = a.slot; const slotB = b.slot;
        next.matches = next.matches.map((m) => {
          if (m.id === a.id) return { ...m, slot: slotB ? { ...slotB } : undefined };
          if (m.id === b.id) return { ...m, slot: slotA ? { ...slotA } : undefined };
          return m;
        });
      }
      break;
    }

    default:
      // Commande inconnue : état inchangé (mais seq incrémenté reste inoffensif).
      return { state, events: [] };
  }

  return { state: next, events };
}

/**
 * Recalcule les côtés dérivés : résout les qualifiés de poule dans l'arbre,
 * puis propage les vainqueurs. Garde l'état cohérent après chaque résultat.
 * @param {import('../types.js').Tournament} t
 * @returns {import('../types.js').Tournament}
 */
function reconcile(t) {
  let matches = resolveQualifiers(t);
  matches = advanceBracket(matches);
  return { ...t, matches };
}
