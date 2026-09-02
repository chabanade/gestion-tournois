// @ts-check
import { get, set } from 'idb-keyval';

/**
 * Accès au serveur central (mode « live »).
 *
 * - Détection automatique : si l'appli est servie par le serveur, /api/health
 *   répond → mode serveur ; sinon (GitHub Pages, fichier local) → mode local.
 * - Les commandes partent via REST (réponse d'erreur claire) ; l'état officiel
 *   revient par WebSocket à tous les écrans.
 * - FILE D'ATTENTE HORS LIGNE : chaque commande est d'abord mise en file dans
 *   IndexedDB, puis envoyée. Sans réseau, elle attend ; au retour du réseau
 *   (événement `online` ou reconnexion WebSocket), la file est rejouée dans
 *   l'ordre. Les commandes sont sémantiques (« score du match X ») : elles se
 *   fusionnent naturellement côté serveur.
 */

const base = location.pathname.replace(/[^/]*$/, ''); // ex "/" ou "/gestion-tournois/"
const API = `${base}api`;
const WS_URL = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${base}ws`;

/** Détecte la présence du serveur (une seule fois). */
export async function detectServer() {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 2500);
    const r = await fetch(`${API}/health`, { signal: ctrl.signal, cache: 'no-store' });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

async function call(method, path, body, token) {
  const r = await fetch(`${API}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Token': token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await r.json().catch(() => null);
  if (!r.ok) {
    const err = new Error(data?.error || `Erreur ${r.status}`);
    // @ts-ignore
    err.status = r.status;
    throw err;
  }
  return data;
}

export const remote = {
  create: (state) => call('POST', '/tournaments', { state }),
  fetch: (id, token) => call('GET', `/tournaments/${encodeURIComponent(id)}`, undefined, token),
  command: (id, command, token) => call('POST', `/tournaments/${encodeURIComponent(id)}/commands`, { command }, token),
  journal: (id, token, limit = 200) => call('GET', `/tournaments/${encodeURIComponent(id)}/journal?limit=${limit}`, undefined, token),
  createTableToken: (id, courts, label, token) => call('POST', `/tournaments/${encodeURIComponent(id)}/tokens/table`, { courts, label }, token),
  rotateAdmin: (id, token) => call('POST', `/tournaments/${encodeURIComponent(id)}/tokens/rotate-admin`, undefined, token),
  import: (id, state, token) => call('PUT', `/tournaments/${encodeURIComponent(id)}/import`, { state }, token),
  exportUrl: (id) => `${API}/tournaments/${encodeURIComponent(id)}/export`,
};

// ---------- File d'attente hors ligne ----------
/**
 * La SOURCE DE VÉRITÉ de la file est EN MÉMOIRE (un tableau par tournoi) :
 * les ajouts/retraits sont donc atomiques (JavaScript est mono-thread).
 * IndexedDB n'en est qu'un miroir, écrit par une chaîne SÉRIALISÉE, pour
 * survivre à une fermeture de l'onglet. Cela évite la course classique
 * « lire → modifier → écrire » où deux saisies rapprochées s'écrasent.
 */
const qKey = (id) => `queue:${id}`;
/** @type {Map<string, any[]>} */
const queues = new Map();
let persistChain = Promise.resolve();

function persist(id) {
  const snapshot = (queues.get(id) || []).slice();
  persistChain = persistChain.then(() => set(qKey(id), snapshot)).catch(() => {});
  return persistChain;
}

/** Charge la file depuis IndexedDB (une fois) et la garde en mémoire. */
export async function loadQueue(id) {
  if (!queues.has(id)) {
    const stored = (await get(qKey(id))) || [];
    if (!queues.has(id)) queues.set(id, stored);
  }
  return /** @type {any[]} */ (queues.get(id));
}

/** Longueur de la file, lecture synchrone (0 si pas encore chargée). */
export function pendingSync(id) {
  return (queues.get(id) || []).length;
}

/** Ajoute une commande. Synchrone si la file est déjà chargée. */
export async function enqueue(id, command) {
  const q = queues.has(id) ? /** @type {any[]} */ (queues.get(id)) : await loadQueue(id);
  q.push(command);
  persist(id);
  return q.length;
}

export async function queueLength(id) {
  return (await loadQueue(id)).length;
}

let flushing = false;
/**
 * Rejoue la file dans l'ordre. S'arrête au premier échec RÉSEAU (on réessaiera),
 * mais JETTE les commandes refusées par le serveur (403/400 : droits, match
 * inconnu) en les signalant via `onRejected`.
 */
export async function flush(id, token, onRejected) {
  const q = await loadQueue(id);
  if (flushing) return { sent: 0, pending: q.length };
  flushing = true;
  let sent = 0;
  try {
    while (q.length) {
      const cmd = q[0];
      try {
        await remote.command(id, cmd, token);
        sent += 1;
      } catch (e) {
        // @ts-ignore
        const status = e?.status;
        if (status && status >= 400 && status < 500) {
          onRejected?.(cmd, e.message);
        } else {
          break; // réseau/serveur indisponible : on garde la file
        }
      }
      q.shift(); // retire EXACTEMENT la commande traitée (pas une copie périmée)
      persist(id);
    }
    await persistChain;
    return { sent, pending: q.length };
  } finally {
    flushing = false;
  }
}

// ---------- WebSocket avec reconnexion ----------
/**
 * @param {string} id
 * @param {{onState:(s:any)=>void, onOpen?:()=>void, onClose?:()=>void}} handlers
 * @returns {() => void} fonction d'arrêt
 */
export function subscribe(id, handlers) {
  let ws = null;
  let stopped = false;
  let delay = 1000;
  let pingTimer = null;

  const connect = () => {
    if (stopped) return;
    try {
      ws = new WebSocket(`${WS_URL}?t=${encodeURIComponent(id)}`);
    } catch {
      return retry();
    }
    ws.onopen = () => {
      delay = 1000;
      handlers.onOpen?.();
      pingTimer = setInterval(() => { try { ws?.send('ping'); } catch { /* ignore */ } }, 25000);
    };
    ws.onmessage = (ev) => {
      if (ev.data === 'pong') return;
      try {
        const msg = JSON.parse(ev.data);
        if (msg.type === 'state') handlers.onState(msg.state);
      } catch { /* ignore */ }
    };
    ws.onclose = () => {
      if (pingTimer) clearInterval(pingTimer);
      handlers.onClose?.();
      retry();
    };
    ws.onerror = () => { try { ws?.close(); } catch { /* ignore */ } };
  };
  const retry = () => {
    if (stopped) return;
    setTimeout(connect, delay);
    delay = Math.min(delay * 2, 15000); // recul progressif, plafonné à 15 s
  };
  connect();
  return () => { stopped = true; if (pingTimer) clearInterval(pingTimer); try { ws?.close(); } catch { /* ignore */ } };
}
