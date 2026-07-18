// @ts-check
import { signal } from '@preact/signals';
import { applyCommand, createTournament } from '../engine/index.js';
import { saveTournament, loadTournament, listTournaments, prefs } from './local.js';

/**
 * État applicatif central. L'UI lit `state.tournament` (signal réactif) et ne
 * mute JAMAIS l'état : elle appelle `dispatch(command)`. Le réducteur pur du
 * moteur produit le nouvel état, qu'on persiste (sauvegarde auto) et diffuse.
 * C'est la frontière exacte où se branchera le temps réel : `dispatch` enverra
 * aussi la commande au serveur, et les events entrants rejoueront `applyCommand`.
 */

/** @type {import('@preact/signals').Signal<import('../engine/index.js').Tournament|null>} */
export const tournament = signal(null);
/** @type {import('@preact/signals').Signal<{type:string,[k:string]:any}[]>} */
export const lastEvents = signal([]);
export const clientId = getClientId();

let saveTimer = null;

/**
 * Applique une commande, met à jour l'état, planifie une sauvegarde auto.
 * @param {{type:string,[k:string]:any}} command
 */
export function dispatch(command) {
  const current = tournament.value;
  if (!current) return;
  const stamped = { ...command, clientId, ts: Date.now() };
  const { state, events } = applyCommand(current, stamped);
  tournament.value = state;
  lastEvents.value = events;
  scheduleSave(state);
  return events;
}

/** @param {import('../engine/index.js').Tournament} t */
function scheduleSave(t) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveTournament(t), 400);
}

/** Sauvegarde immédiate (avant navigation/export). */
export async function saveNow() {
  if (tournament.value) await saveTournament(tournament.value);
}

/**
 * Charge un tournoi existant depuis IndexedDB.
 * @param {string} id
 */
export async function open(id) {
  const t = await loadTournament(id);
  if (t) {
    tournament.value = t;
    prefs.set({ lastId: id });
  }
  return t;
}

/**
 * Crée un nouveau tournoi et le met dans l'état courant.
 * @param {{name?:string, format?:import('../engine/index.js').Format}} [init]
 */
export function createNew(init = {}) {
  const t = createTournament(init);
  tournament.value = t;
  prefs.set({ lastId: t.id });
  saveTournament(t);
  return t;
}

/** Remplace l'état courant (import JSON). */
export function replaceState(t) {
  tournament.value = t;
  prefs.set({ lastId: t.id });
  saveTournament(t);
}

export { listTournaments, prefs };

function getClientId() {
  let id = prefs.get().clientId;
  if (!id) {
    id = 'c_' + Math.random().toString(36).slice(2, 10);
    prefs.set({ clientId: id });
  }
  return id;
}
