// @ts-check
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { openDb } from './db.js';
import { authorize } from './permissions.js';
import { startBackups } from './backup.js';
import { applyCommand } from '../../src/engine/index.js';

/**
 * Serveur central "gestion-tournois".
 *
 * - sert l'application (fichiers statiques du build Vite) ;
 * - API REST : création, lecture, commandes, journal, jetons, export/import ;
 * - WebSocket : diffusion temps réel de l'état à tous les écrans connectés ;
 * - applique les commandes avec LE MÊME réducteur pur que l'écran.
 *
 * Source de vérité = la base SQLite. Les écrans ne font que proposer des
 * commandes ; le serveur les valide (rôle), les applique, les journalise,
 * puis diffuse le nouvel état. Un écran hors ligne rejoue sa file d'attente
 * au retour du réseau (les commandes sont sémantiques : "score du match X",
 * donc elles se fusionnent naturellement).
 */

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const DATA_DIR = resolve(process.env.DATA_DIR || join(__dirname, '..', 'data'));
const STATIC_DIR = resolve(process.env.STATIC_DIR || join(__dirname, '..', '..', 'dist'));
const DB_FILE = join(DATA_DIR, 'tournois.sqlite');
const MAX_BODY = 2 * 1024 * 1024; // 2 Mo (logos en base64 inclus)

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain',
};

export function createApp({ dbFile = DB_FILE, staticDir = STATIC_DIR, backups = true } = {}) {
  const db = openDb(dbFile);
  /** @type {Map<string, Set<import('ws').WebSocket>>} sockets par tournoi */
  const rooms = new Map();

  function broadcast(id, state) {
    const room = rooms.get(id);
    if (!room) return;
    const msg = JSON.stringify({ type: 'state', state });
    for (const ws of room) {
      if (ws.readyState === ws.OPEN) ws.send(msg);
    }
  }

  // ---------- Application d'une commande (cœur) ----------
  function handleCommand(id, command, token) {
    const row = db.getTournament(id);
    if (!row) return { status: 404, body: { error: 'Tournoi introuvable.' } };
    const auth = db.resolveRole(id, token);
    const check = authorize(auth, command, row.state);
    if (!check.ok) return { status: 403, body: { error: check.reason } };

    // Ancienne valeur (pour le journal et l'annulation).
    let previous;
    if (command.type === 'SET_RESULT' || command.type === 'CLEAR_RESULT') {
      const m = row.state.matches.find((x) => x.id === command.matchId);
      previous = m ? (m.result ?? null) : undefined;
    }

    const stamped = { ...command, ts: Date.now(), role: auth.role };
    const { state, events } = applyCommand(row.state, stamped);
    if (state === row.state) return { status: 400, body: { error: 'Commande inconnue.' } };

    db.commit(id, state, {
      type: command.type, command: stamped, previous,
      clientId: command.clientId, role: auth.role, ts: stamped.ts,
    });
    broadcast(id, state);
    return { status: 200, body: { seq: state.seq, events } };
  }

  // ---------- Routes REST ----------
  async function api(req, res, url) {
    const token = req.headers['x-token'] ? String(req.headers['x-token']) : url.searchParams.get('token');
    const parts = url.pathname.split('/').filter(Boolean); // ['api', 'tournaments', id, ...]

    if (parts[1] === 'health') return json(res, 200, { ok: true, ts: Date.now() });

    if (parts[1] !== 'tournaments') return json(res, 404, { error: 'Route inconnue.' });
    const id = parts[2];
    const sub = parts[3];

    // POST /api/tournaments  → création (renvoie le jeton organisateur UNE fois)
    if (!id && req.method === 'POST') {
      const body = await readJson(req);
      if (!body?.state?.id) return json(res, 400, { error: 'État de tournoi requis.' });
      if (db.getTournament(body.state.id)) return json(res, 409, { error: 'Ce tournoi existe déjà.' });
      const { adminToken } = db.createTournament(body.state);
      return json(res, 201, { id: body.state.id, adminToken });
    }
    if (!id) return json(res, 405, { error: 'Méthode non autorisée.' });

    const row = db.getTournament(id);
    if (!row) return json(res, 404, { error: 'Tournoi introuvable.' });
    const auth = db.resolveRole(id, token);

    // GET /api/tournaments/:id  → état (public)
    if (!sub && req.method === 'GET') return json(res, 200, { state: row.state, role: auth.role, courts: auth.courts });

    // POST .../commands
    if (sub === 'commands' && req.method === 'POST') {
      const body = await readJson(req);
      if (!body?.command?.type) return json(res, 400, { error: 'Commande requise.' });
      const r = handleCommand(id, body.command, token);
      return json(res, r.status, r.body);
    }

    // GET .../journal (organisateur)
    if (sub === 'journal' && req.method === 'GET') {
      if (auth.role !== 'admin') return json(res, 403, { error: 'Réservé à l\'organisateur.' });
      return json(res, 200, { entries: db.journal(id, Number(url.searchParams.get('limit') || 200)) });
    }

    // GET .../export → JSON téléchargeable (public : l'état l'est déjà)
    if (sub === 'export' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="tournoi-${id}.json"`,
      });
      return res.end(JSON.stringify(row.state, null, 2));
    }

    // PUT .../import → restauration complète (organisateur)
    if (sub === 'import' && req.method === 'PUT') {
      if (auth.role !== 'admin') return json(res, 403, { error: 'Réservé à l\'organisateur.' });
      const body = await readJson(req);
      if (!body?.state?.id || body.state.id !== id) return json(res, 400, { error: 'État invalide.' });
      const state = { ...body.state, seq: (row.state.seq || 0) + 1 };
      db.commit(id, state, { type: 'IMPORT', command: { type: 'IMPORT' }, previous: undefined, role: 'admin', ts: Date.now() });
      broadcast(id, state);
      return json(res, 200, { seq: state.seq });
    }

    // Jetons (organisateur)
    if (sub === 'tokens') {
      if (auth.role !== 'admin') return json(res, 403, { error: 'Réservé à l\'organisateur.' });
      const action = parts[4];
      if (req.method === 'GET') return json(res, 200, { tokens: db.listTokens(id) });
      if (action === 'table' && req.method === 'POST') {
        const body = await readJson(req);
        const courts = (body?.courts || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (!courts.length) return json(res, 400, { error: 'Terrains requis.' });
        return json(res, 201, { token: db.createTableToken(id, courts, body?.label) });
      }
      if (action === 'rotate-admin' && req.method === 'POST') {
        return json(res, 200, { adminToken: db.rotateAdminToken(id) });
      }
    }

    return json(res, 404, { error: 'Route inconnue.' });
  }

  // ---------- Fichiers statiques (l'appli) ----------
  async function serveStatic(res, pathname) {
    let file = join(staticDir, pathname === '/' ? 'index.html' : pathname);
    if (!file.startsWith(staticDir)) return notFound(res);
    try {
      const s = await stat(file);
      if (s.isDirectory()) file = join(file, 'index.html');
    } catch {
      file = join(staticDir, 'index.html'); // SPA : tout retombe sur index.html
    }
    try {
      const data = await readFile(file);
      const ext = extname(file);
      const cache = ext === '.html' || file.endsWith('sw.js') ? 'no-cache' : 'public, max-age=31536000, immutable';
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache });
      res.end(data);
    } catch {
      notFound(res);
    }
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) return await api(req, res, url);
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Méthode non autorisée.' });
      return await serveStatic(res, url.pathname);
    } catch (e) {
      const status = e?.status || 500;
      return json(res, status, { error: status === 413 ? 'Requête trop volumineuse.' : 'Erreur interne.' });
    }
  });

  // ---------- WebSocket temps réel ----------
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const id = url.searchParams.get('t');
    if (!id) return ws.close(1008, 'tournoi requis');
    const row = db.getTournament(id);
    if (!row) return ws.close(1008, 'tournoi introuvable');
    if (!rooms.has(id)) rooms.set(id, new Set());
    rooms.get(id)?.add(ws);
    ws.send(JSON.stringify({ type: 'state', state: row.state }));
    ws.on('message', (raw) => {
      // Les commandes passent par REST (réponse d'erreur claire) ; le WS ne sert
      // qu'à recevoir. On répond juste aux pings pour garder la connexion.
      if (String(raw) === 'ping') ws.send('pong');
    });
    ws.on('close', () => rooms.get(id)?.delete(ws));
  });

  let stopBackups = () => {};
  if (backups) stopBackups = startBackups(db, DATA_DIR);

  return {
    server, db, wss, handleCommand,
    listen: (port = PORT) => new Promise((ok) => server.listen(port, () => ok(server.address()))),
    close: async () => {
      stopBackups();
      for (const client of wss.clients) client.terminate();
      wss.close();
      // Coupe aussi les connexions HTTP keep-alive, sinon close() attend indéfiniment.
      server.closeAllConnections?.();
      await new Promise((ok) => server.close(ok));
      db.close();
    },
  };
}

// ---------- utilitaires ----------
function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function notFound(res) { res.writeHead(404); res.end('Not found'); }
function readJson(req) {
  return new Promise((ok, ko) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { ko(Object.assign(new Error('too large'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { ok(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : null); } catch { ko(Object.assign(new Error('bad json'), { status: 400 })); } });
    req.on('error', ko);
  });
}

// Lancement direct : `node src/index.js`
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApp();
  app.listen().then((addr) => {
    console.log(`gestion-tournois serveur : port ${typeof addr === 'object' && addr ? addr.port : PORT} | données ${DATA_DIR} | appli ${STATIC_DIR}`);
  });
  const shutdown = () => app.close().then(() => process.exit(0));
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
