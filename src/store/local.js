// @ts-check
import { get, set, del, keys } from 'idb-keyval';

/**
 * Couche de persistance locale (IndexedDB). Volontairement minimale et
 * SWAPPABLE : une future implémentation `RemoteStore` (WebSocket/SSE vers le
 * VPS) exposera la même interface pour brancher le temps réel sans toucher
 * au reste de l'application.
 */

const PREFIX = 'tournament:';
const PREFS_KEY = 'prefs';

/** @param {string} id */
const keyOf = (id) => `${PREFIX}${id}`;

/**
 * @param {import('../engine/index.js').Tournament} t
 * @returns {Promise<void>}
 */
export async function saveTournament(t) {
  try {
    await set(keyOf(t.id), t);
  } catch (e) {
    // Navigation privée / quota : on n'empêche jamais l'usage, l'export JSON
    // reste la porte de sortie. On se contente de tracer.
    console.warn('Sauvegarde locale impossible :', e);
  }
}

/**
 * @param {string} id
 * @returns {Promise<import('../engine/index.js').Tournament|undefined>}
 */
export async function loadTournament(id) {
  try {
    return await get(keyOf(id));
  } catch {
    return undefined;
  }
}

/** @param {string} id */
export async function deleteTournament(id) {
  try { await del(keyOf(id)); } catch { /* ignore */ }
}

/** @returns {Promise<import('../engine/index.js').Tournament[]>} */
export async function listTournaments() {
  try {
    const allKeys = await keys();
    const ids = allKeys.filter((k) => typeof k === 'string' && k.startsWith(PREFIX));
    const items = await Promise.all(ids.map((k) => get(k)));
    return items.filter(Boolean).sort((a, b) => (b?.seq || 0) - (a?.seq || 0));
  } catch {
    return [];
  }
}

/** Préférences légères (dernier tournoi, thème) → localStorage. */
export const prefs = {
  get() {
    try { return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { return {}; }
  },
  set(patch) {
    try {
      const next = { ...this.get(), ...patch };
      localStorage.setItem(PREFS_KEY, JSON.stringify(next));
    } catch { /* ignore */ }
  },
};
