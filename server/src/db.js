// @ts-check
import Database from 'better-sqlite3';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Couche base de données (SQLite). Source de vérité du tournoi.
 *
 * - `tournaments` : l'état complet (JSON) + numéro de version `seq`.
 * - `journal`     : chaque commande appliquée (qui, quand, quoi, ancienne
 *                   valeur) → traçabilité et annulation.
 * - `tokens`      : jetons de rôle HASHÉS (jamais en clair).
 */

export function hashToken(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

export function newToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

export function openDb(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL'); // robuste aux coupures, lectures concurrentes
  db.pragma('synchronous = NORMAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS tournaments (
      id TEXT PRIMARY KEY,
      seq INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tournament_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      type TEXT NOT NULL,
      command TEXT NOT NULL,
      previous TEXT,
      client_id TEXT,
      role TEXT,
      ts INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS journal_tid ON journal(tournament_id, seq);
    CREATE TABLE IF NOT EXISTS tokens (
      tournament_id TEXT NOT NULL,
      token_hash TEXT NOT NULL,
      role TEXT NOT NULL,
      courts TEXT,
      label TEXT,
      created_at INTEGER NOT NULL,
      revoked_at INTEGER,
      PRIMARY KEY (tournament_id, token_hash)
    );
  `);
  return wrap(db);
}

function wrap(db) {
  const q = {
    insertT: db.prepare('INSERT INTO tournaments (id, seq, name, state, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'),
    getT: db.prepare('SELECT id, seq, name, state, created_at, updated_at FROM tournaments WHERE id = ?'),
    updT: db.prepare('UPDATE tournaments SET seq = ?, name = ?, state = ?, updated_at = ? WHERE id = ?'),
    listT: db.prepare('SELECT id, seq, name, created_at, updated_at FROM tournaments ORDER BY updated_at DESC'),
    delT: db.prepare('DELETE FROM tournaments WHERE id = ?'),
    insJ: db.prepare('INSERT INTO journal (tournament_id, seq, type, command, previous, client_id, role, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'),
    listJ: db.prepare('SELECT id, seq, type, command, previous, client_id, role, ts FROM journal WHERE tournament_id = ? ORDER BY seq DESC LIMIT ?'),
    insTok: db.prepare('INSERT INTO tokens (tournament_id, token_hash, role, courts, label, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    getTok: db.prepare('SELECT role, courts, revoked_at FROM tokens WHERE tournament_id = ? AND token_hash = ?'),
    revokeRole: db.prepare('UPDATE tokens SET revoked_at = ? WHERE tournament_id = ? AND role = ? AND revoked_at IS NULL'),
    listTok: db.prepare('SELECT role, courts, label, created_at, revoked_at FROM tokens WHERE tournament_id = ? ORDER BY created_at'),
  };

  return {
    raw: db,

    /** Crée un tournoi et son jeton organisateur. Renvoie le jeton EN CLAIR (une seule fois). */
    createTournament(state) {
      const now = Date.now();
      const adminToken = newToken();
      const tx = db.transaction(() => {
        q.insertT.run(state.id, state.seq || 0, state.name || '', JSON.stringify(state), now, now);
        q.insTok.run(state.id, hashToken(adminToken), 'admin', null, 'organisateur', now);
      });
      tx();
      return { id: state.id, adminToken };
    },

    getTournament(id) {
      const row = q.getT.get(id);
      if (!row) return null;
      return { ...row, state: JSON.parse(row.state) };
    },

    listTournaments() {
      return q.listT.all();
    },

    deleteTournament(id) {
      q.delT.run(id);
    },

    /** Sauvegarde le nouvel état + entrée de journal, atomiquement. */
    commit(id, state, entry) {
      const now = Date.now();
      const tx = db.transaction(() => {
        q.updT.run(state.seq, state.name || '', JSON.stringify(state), now, id);
        if (entry) {
          q.insJ.run(id, state.seq, entry.type, JSON.stringify(entry.command),
            entry.previous === undefined ? null : JSON.stringify(entry.previous),
            entry.clientId || null, entry.role || null, entry.ts || now);
        }
      });
      tx();
    },

    /** Remplace l'état sans journaliser (import/restauration). */
    replaceState(id, state) {
      q.updT.run(state.seq || 0, state.name || '', JSON.stringify(state), Date.now(), id);
    },

    journal(id, limit = 200) {
      return q.listJ.all(id, limit).map((r) => ({
        ...r,
        command: JSON.parse(r.command),
        previous: r.previous ? JSON.parse(r.previous) : null,
      }));
    },

    /** Crée un jeton table de marque limité à des terrains. */
    createTableToken(id, courts, label) {
      const token = newToken(18);
      q.insTok.run(id, hashToken(token), 'table', JSON.stringify(courts), label || null, Date.now());
      return token;
    },

    /** Régénère le jeton organisateur (révoque l'ancien) — si le lien a fuité. */
    rotateAdminToken(id) {
      const token = newToken();
      const tx = db.transaction(() => {
        q.revokeRole.run(Date.now(), id, 'admin');
        q.insTok.run(id, hashToken(token), 'admin', null, 'organisateur', Date.now());
      });
      tx();
      return token;
    },

    /**
     * Résout un jeton en rôle : {role:'admin'} | {role:'table', courts:[..]} | {role:'public'}.
     * Un jeton inconnu ou révoqué = public (lecture seule), jamais d'erreur.
     */
    resolveRole(id, token) {
      if (!token) return { role: 'public' };
      const row = q.getTok.get(id, hashToken(token));
      if (!row || row.revoked_at) return { role: 'public' };
      if (row.role === 'table') return { role: 'table', courts: JSON.parse(row.courts || '[]') };
      return { role: row.role };
    },

    listTokens(id) {
      return q.listTok.all(id).map((r) => ({ ...r, courts: r.courts ? JSON.parse(r.courts) : null }));
    },

    /** Copie de sauvegarde cohérente (API native SQLite, sans arrêter le service). */
    backup(destFile) {
      mkdirSync(dirname(destFile), { recursive: true });
      return db.backup(destFile);
    },

    close() { db.close(); },
  };
}
