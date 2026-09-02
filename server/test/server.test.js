// @ts-check
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket from 'ws';
import { createApp } from '../src/index.js';
import { backupNow } from '../src/backup.js';
import { createTournament, applyCommand, commands } from '../../src/engine/index.js';

/** Tournoi de test : 4 équipes, 2 poules, planning sur 2 terrains. */
function fixture() {
  let t = createTournament({ id: 'T-test', name: 'Test', format: 'groupsKnockout', rngSeed: 's' });
  const teams = ['A', 'B', 'C', 'D'].map((n, i) => ({ id: n, name: n, seed: i + 1 }));
  t = applyCommand(t, commands.setTeams(teams)).state;
  t = applyCommand(t, commands.generateStructure({ groupCount: 2, qualifiersPerGroup: 1 })).state;
  t = applyCommand(t, commands.setSchedule({ courts: 2 })).state;
  t = applyCommand(t, commands.generateScheduleCmd()).state;
  return t;
}

async function boot() {
  const app = createApp({ dbFile: ':memory:', staticDir: tmpdir(), backups: false });
  const addr = await app.listen(0);
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  const base = `http://127.0.0.1:${port}`;
  const call = async (method, path, body, token) => {
    const r = await fetch(base + path, {
      method, headers: { 'Content-Type': 'application/json', ...(token ? { 'X-Token': token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  };
  return { app, base, port, call };
}

test('création → jeton organisateur, lecture publique', async () => {
  const { app, call } = await boot();
  const r = await call('POST', '/api/tournaments', { state: fixture() });
  assert.equal(r.status, 201);
  assert.ok(r.body.adminToken.length > 20);
  const g = await call('GET', '/api/tournaments/T-test');
  assert.equal(g.status, 200);
  assert.equal(g.body.role, 'public');
  assert.equal(g.body.state.teams.length, 4);
  await app.close();
});

test('rôles : public refusé, organisateur accepté, table limitée à ses terrains', async () => {
  const { app, call } = await boot();
  const { body: { adminToken } } = await call('POST', '/api/tournaments', { state: fixture() });
  const { body: { state } } = await call('GET', '/api/tournaments/T-test');
  const onCourt1 = state.matches.find((m) => m.slot?.court === 1);
  const onCourt2 = state.matches.find((m) => m.slot?.court === 2);

  // public → 403
  let r = await call('POST', '/api/tournaments/T-test/commands', { command: commands.setResult(onCourt1.id, { homeGoals: 1, awayGoals: 0 }) });
  assert.equal(r.status, 403);

  // jeton table terrain 1
  const tk = await call('POST', '/api/tournaments/T-test/tokens/table', { courts: [1], label: 'Arbitre T1' }, adminToken);
  assert.equal(tk.status, 201);
  const tableToken = tk.body.token;

  // table : OK sur terrain 1
  r = await call('POST', '/api/tournaments/T-test/commands', { command: commands.setResult(onCourt1.id, { homeGoals: 2, awayGoals: 1 }) }, tableToken);
  assert.equal(r.status, 200);
  // table : REFUSÉ sur terrain 2
  r = await call('POST', '/api/tournaments/T-test/commands', { command: commands.setResult(onCourt2.id, { homeGoals: 0, awayGoals: 0 }) }, tableToken);
  assert.equal(r.status, 403);
  // table : REFUSÉ pour une commande d'organisation
  r = await call('POST', '/api/tournaments/T-test/commands', { command: commands.setName('Piraté') }, tableToken);
  assert.equal(r.status, 403);

  // organisateur : tout passe
  r = await call('POST', '/api/tournaments/T-test/commands', { command: commands.setName('Coupe') }, adminToken);
  assert.equal(r.status, 200);
  const g = await call('GET', '/api/tournaments/T-test');
  assert.equal(g.body.state.name, 'Coupe');
  await app.close();
});

test('journal : trace qui, quand, et l\'ancienne valeur (annulation possible)', async () => {
  const { app, call } = await boot();
  const { body: { adminToken } } = await call('POST', '/api/tournaments', { state: fixture() });
  const { body: { state } } = await call('GET', '/api/tournaments/T-test');
  const m = state.matches.find((x) => x.slot);
  await call('POST', '/api/tournaments/T-test/commands', { command: { ...commands.setResult(m.id, { homeGoals: 1, awayGoals: 0 }), clientId: 'tel-arbitre' } }, adminToken);
  await call('POST', '/api/tournaments/T-test/commands', { command: commands.setResult(m.id, { homeGoals: 3, awayGoals: 0 }) }, adminToken);
  // journal réservé à l'organisateur
  assert.equal((await call('GET', '/api/tournaments/T-test/journal')).status, 403);
  const j = await call('GET', '/api/tournaments/T-test/journal', null, adminToken);
  assert.equal(j.status, 200);
  const [last, first] = j.body.entries;
  assert.equal(first.previous, null, 'première saisie : pas d\'ancienne valeur');
  assert.equal(first.client_id, 'tel-arbitre');
  assert.equal(last.previous.homeGoals, 1, 'la correction garde l\'ancien score 1-0');
  assert.ok(last.ts >= first.ts);
  await app.close();
});

test('temps réel : un score saisi est diffusé à tous les écrans connectés', async () => {
  const { app, call, port } = await boot();
  const { body: { adminToken } } = await call('POST', '/api/tournaments', { state: fixture() });
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?t=T-test`);
  const messages = [];
  // Écouteur branché AVANT l'ouverture : l'état initial arrive immédiatement.
  ws.on('message', (d) => messages.push(JSON.parse(String(d))));
  await new Promise((ok) => ws.on('open', ok));
  await new Promise((ok) => setTimeout(ok, 50));
  assert.equal(messages[0].type, 'state', 'état initial reçu à la connexion');

  const m = messages[0].state.matches.find((x) => x.slot);
  await call('POST', '/api/tournaments/T-test/commands', { command: commands.setResult(m.id, { homeGoals: 4, awayGoals: 2 }) }, adminToken);
  await new Promise((ok) => setTimeout(ok, 50));
  const last = messages[messages.length - 1];
  assert.equal(last.state.matches.find((x) => x.id === m.id).result.homeGoals, 4, 'nouvel état poussé en direct');
  ws.close();
  await app.close();
});

test('export / import : un tournoi se restaure entièrement', async () => {
  const { app, call, base } = await boot();
  const { body: { adminToken } } = await call('POST', '/api/tournaments', { state: fixture() });
  const exp = await fetch(`${base}/api/tournaments/T-test/export`);
  assert.equal(exp.status, 200);
  const snapshot = await exp.json();
  // on modifie, puis on restaure le snapshot
  await call('POST', '/api/tournaments/T-test/commands', { command: commands.setName('Modifié') }, adminToken);
  const imp = await call('PUT', '/api/tournaments/T-test/import', { state: snapshot }, adminToken);
  assert.equal(imp.status, 200);
  const g = await call('GET', '/api/tournaments/T-test');
  assert.equal(g.body.state.name, 'Test');
  await app.close();
});

test('régénérer le lien organisateur révoque l\'ancien (lien qui a fuité)', async () => {
  const { app, call } = await boot();
  const { body: { adminToken } } = await call('POST', '/api/tournaments', { state: fixture() });
  const rot = await call('POST', '/api/tournaments/T-test/tokens/rotate-admin', null, adminToken);
  assert.equal(rot.status, 200);
  const old = await call('POST', '/api/tournaments/T-test/commands', { command: commands.setName('X') }, adminToken);
  assert.equal(old.status, 403, 'ancien jeton refusé');
  const neu = await call('POST', '/api/tournaments/T-test/commands', { command: commands.setName('Y') }, rot.body.adminToken);
  assert.equal(neu.status, 200);
  await app.close();
});

test('sauvegarde à chaud : un fichier SQLite cohérent est produit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gt-'));
  const app = createApp({ dbFile: join(dir, 'db.sqlite'), staticDir: tmpdir(), backups: false });
  app.db.createTournament(fixture());
  const file = await backupNow(app.db, dir);
  assert.ok(existsSync(file));
  assert.ok(readdirSync(join(dir, 'backups')).length >= 1);
  await app.close();
});
