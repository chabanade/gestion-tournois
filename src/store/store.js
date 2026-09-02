// @ts-check
import { signal } from '@preact/signals';
import { applyCommand, createTournament } from '../engine/index.js';
import { saveTournament, loadTournament, listTournaments, prefs } from './local.js';
import { detectServer, remote, enqueue, flush, queueLength, loadQueue, pendingSync, subscribe } from './remote.js';

/**
 * État applicatif central — UNE seule porte d'entrée pour toute mutation :
 * `dispatch(command)`. Deux modes, transparents pour l'interface :
 *
 * - LOCAL (GitHub Pages, fichier, pas de serveur) : le réducteur pur du moteur
 *   s'applique dans le navigateur, sauvegarde IndexedDB. Mono-appareil.
 * - SERVEUR (appli servie par le VPS) : application immédiate en local
 *   (réactivité), mise en FILE D'ATTENTE, envoi au serveur ; l'état officiel
 *   revient par WebSocket à tous les écrans. Hors ligne → la file attend, puis
 *   se rejoue au retour du réseau. Le serveur reste la source de vérité.
 */

/** @type {import('@preact/signals').Signal<import('../engine/index.js').Tournament|null>} */
export const tournament = signal(null);
/** @type {import('@preact/signals').Signal<{type:string,[k:string]:any}[]>} */
export const lastEvents = signal([]);
/** Session : mode, rôle résolu par le serveur, connexion, file d'attente. */
export const session = signal({
  mode: /** @type {'detecting'|'local'|'server'} */ ('detecting'),
  role: 'public',
  /** @type {number[]|undefined} */ courts: undefined,
  /** @type {string|null} */ token: null,
  online: typeof navigator !== 'undefined' ? navigator.onLine : true,
  connected: false,
  pending: 0,
  /** @type {string|null} */ lastError: null,
});
export const clientId = getClientId();

let saveTimer = null;
let unsubscribe = () => {};

// ---------- Détection du mode (une fois) ----------
const ready = (async () => {
  const hasServer = await detectServer();
  session.value = { ...session.value, mode: hasServer ? 'server' : 'local' };
  return hasServer;
})();
export const whenReady = () => ready;

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => { session.value = { ...session.value, online: true }; syncNow(); });
  window.addEventListener('offline', () => { session.value = { ...session.value, online: false }; });
}

// ---------- Commandes ----------
/**
 * Applique une commande. En mode serveur : optimiste + file + envoi.
 * @param {{type:string,[k:string]:any}} command
 */
export function dispatch(command) {
  const current = tournament.value;
  if (!current) return;
  const stamped = { ...command, clientId, ts: Date.now() };
  const { state, events } = applyCommand(current, stamped);
  tournament.value = state;
  lastEvents.value = events;
  scheduleSave(state); // cache local dans les deux modes (lecture hors ligne)

  if (session.value.mode === 'server') {
    enqueue(current.id, stamped).then((n) => {
      session.value = { ...session.value, pending: n };
      syncNow();
    });
  }
  return events;
}

/** Envoie la file d'attente au serveur (si possible). */
export async function syncNow() {
  const s = session.value;
  const t = tournament.value;
  if (s.mode !== 'server' || !t || !s.online) return;
  const { pending } = await flush(t.id, s.token, (cmd, reason) => {
    session.value = { ...session.value, lastError: `Refusé par le serveur : ${reason}` };
  });
  session.value = { ...session.value, pending };
  if (pending === 0) {
    // Resynchronise l'état officiel (annule une éventuelle application optimiste refusée).
    try {
      const r = await remote.fetch(t.id, s.token);
      tournament.value = r.state;
      session.value = { ...session.value, role: r.role, courts: r.courts };
      scheduleSave(r.state);
    } catch { /* hors ligne : on garde le cache */ }
  }
}

function scheduleSave(t) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveTournament(t), 400);
}

/** Sauvegarde immédiate (avant navigation/export). */
export async function saveNow() {
  if (tournament.value) await saveTournament(tournament.value);
}

/**
 * Abonne l'écran au direct (WebSocket) pour un tournoi. Utilisé à l'ouverture
 * ET à la création : l'organisateur qui vient de créer le tournoi doit voir
 * arriver les scores des arbitres sans recharger.
 * @param {string} id
 */
async function attachLive(id) {
  unsubscribe();
  await loadQueue(id); // file en mémoire avant toute saisie
  unsubscribe = subscribe(id, {
    onState: (state) => {
      // L'état du serveur fait foi, SAUF si des commandes locales attendent
      // encore d'être envoyées (lecture synchrone : pas de fenêtre de course).
      if (pendingSync(id) === 0) { tournament.value = state; scheduleSave(state); }
    },
    onOpen: () => { session.value = { ...session.value, connected: true }; syncNow(); },
    onClose: () => { session.value = { ...session.value, connected: false }; },
  });
}

// ---------- Ouverture ----------
/**
 * Charge un tournoi. Mode serveur : depuis le serveur (+ abonnement temps réel),
 * avec repli sur le cache local si le réseau est absent.
 * @param {string} id
 * @param {string|null} [token] jeton de rôle (dans l'URL `?k=`)
 */
export async function open(id, token = null) {
  await ready;
  unsubscribe();
  const tok = token || prefs.get().tokens?.[id] || null;
  if (tok) rememberToken(id, tok);
  session.value = { ...session.value, token: tok, lastError: null };

  if (session.value.mode === 'server') {
    try {
      const r = await remote.fetch(id, tok);
      tournament.value = r.state;
      session.value = { ...session.value, role: r.role, courts: r.courts };
      scheduleSave(r.state);
    } catch (e) {
      // Serveur injoignable → cache local (mode dégradé).
      const cached = await loadTournament(id);
      if (cached) tournament.value = cached;
      // @ts-ignore
      if (e?.status === 404) session.value = { ...session.value, lastError: 'Tournoi introuvable sur le serveur.' };
    }
    session.value = { ...session.value, pending: await queueLength(id) };
    await attachLive(id);
    prefs.set({ lastId: id });
    return tournament.value;
  }

  // Mode local : le porteur de l'appareil est l'organisateur.
  const t = await loadTournament(id);
  if (t) {
    tournament.value = t;
    session.value = { ...session.value, role: token === 'public' ? 'public' : 'admin' };
    prefs.set({ lastId: id });
  }
  return t;
}

/**
 * Crée un tournoi. Mode serveur : créé sur le serveur, renvoie le jeton
 * organisateur (à mettre dans l'URL). Mode local : IndexedDB.
 * @param {{name?:string, format?:import('../engine/index.js').Format}} [init]
 * @returns {Promise<{tournament: import('../engine/index.js').Tournament, adminToken: string|null}>}
 */
export async function createNew(init = {}) {
  await ready;
  const t = createTournament(init);
  tournament.value = t;
  prefs.set({ lastId: t.id });
  saveTournament(t);
  if (session.value.mode === 'server') {
    const { adminToken } = await remote.create(t);
    rememberToken(t.id, adminToken);
    session.value = { ...session.value, token: adminToken, role: 'admin', courts: undefined };
    await attachLive(t.id); // file prête + direct actif avant les premières commandes
    return { tournament: t, adminToken };
  }
  session.value = { ...session.value, role: 'admin' };
  return { tournament: t, adminToken: null };
}

/** Remplace l'état courant (import JSON) — sur le serveur si mode serveur. */
export async function replaceState(t) {
  tournament.value = t;
  prefs.set({ lastId: t.id });
  saveTournament(t);
  if (session.value.mode === 'server') {
    const tok = session.value.token || prefs.get().tokens?.[t.id] || null;
    try {
      await remote.import(t.id, t, tok);
    } catch (e) {
      // Tournoi absent du serveur (import d'un fichier venu d'ailleurs) → on le crée.
      // @ts-ignore
      if (e?.status === 404) {
        const { adminToken } = await remote.create(t);
        rememberToken(t.id, adminToken);
        session.value = { ...session.value, token: adminToken, role: 'admin' };
      } else throw e;
    }
  }
}

/** Droits de l'écran courant (utilisé par l'interface). */
export function can(action, court) {
  const s = session.value;
  if (s.role === 'admin') return true;
  if (s.role === 'table') return action === 'score' && (court == null || (s.courts || []).includes(court));
  return false;
}

export function rememberToken(id, token) {
  const tokens = { ...(prefs.get().tokens || {}), [id]: token };
  prefs.set({ tokens });
}

export { listTournaments, prefs, remote };

function getClientId() {
  let id = prefs.get().clientId;
  if (!id) {
    id = 'c_' + Math.random().toString(36).slice(2, 10);
    prefs.set({ clientId: id });
  }
  return id;
}
