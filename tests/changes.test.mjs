import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database, SYNCED, SCHEMA } from '../supervisor/database.mjs';
import { createSupervisor } from '../supervisor/index.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const stamp = (n = 0) => new Date(Date.UTC(2026, 10, 1, 12, 0, n)).toISOString();
async function open(t) { const directory = await mkdtemp(join(tmpdir(), 'mybots-changes-')); const db = new Database(directory); t.after(async () => { try { db.close(); } catch {} await rm(directory, { recursive: true, force: true }); }); return { db, directory }; }
const log = db => Object.fromEntries(db.all('SELECT tbl,key,seq,deleted,origin FROM changes').map(row => [`${row.tbl}/${row.key}`, row]));

test('a new database has a device id and an empty log; the counter only grows', async t => {
  const { db } = await open(t);
  const first = db.syncState(); assert.match(first.device, /^[0-9a-f-]{36}$/); assert.equal(first.counter, 0);
  const bot = db.create({ name: 'A' }, selection);
  const after = db.syncState(); assert.equal(after.device, first.device); assert.ok(after.counter > first.counter);
  db.appendMessage(bot.id, { id: randomUUID(), role: 'user', text: 'oi', status: 'complete', createdAt: stamp(1) });
  assert.ok(db.syncState().counter > after.counter);
  assert.equal(db.get('PRAGMA user_version').user_version, SCHEMA);
});

test('every write to a synced table is logged, one line per row, and a newer write replaces the older line', async t => {
  const { db } = await open(t);
  const bot = db.create({ name: 'A' }, selection); const message = { id: randomUUID(), role: 'user', text: 'oi', status: 'complete', createdAt: stamp(1) };
  db.appendMessage(bot.id, message);
  let entries = log(db);
  assert.ok(entries[`bots/${bot.id}`]); assert.ok(entries[`messages/${message.id}`]);
  const before = entries[`messages/${message.id}`].seq;
  db.run('UPDATE messages SET body=? WHERE id=?', JSON.stringify({ ...message, text: 'oi de novo' }), message.id);
  entries = log(db); assert.ok(entries[`messages/${message.id}`].seq > before);
  assert.equal(db.all("SELECT * FROM changes WHERE tbl='messages'").length, 1);
  // Deleting leaves a mark, not a hole.
  db.run('DELETE FROM messages WHERE id=?', message.id);
  entries = log(db); assert.equal(entries[`messages/${message.id}`].deleted, 1);
  // Memory, grants, rooms and routines too.
  const memory = randomUUID(); db.run('INSERT INTO memory(id,bot_id,body,updated_at) VALUES(?,?,?,?)', memory, bot.id, '{"text":"x"}', stamp(2));
  const grant = randomUUID(); db.run('INSERT INTO grants(id,bot_id,tool,body) VALUES(?,?,?,?)', grant, bot.id, 'browser', '{"state":"allow"}');
  const room = randomUUID(); db.run('INSERT INTO rooms(id,body,updated_at) VALUES(?,?,?)', room, JSON.stringify({ id: room, name: 'S', botIds: [bot.id] }), stamp(3));
  entries = log(db); for (const key of [`memory/${memory}`, `grants/${grant}`, `rooms/${room}`]) assert.ok(entries[key], key);
});

test('what stays on its device is never logged: tasks, sessions, approvals, activity, heartbeats, notifications, link data', async t => {
  const { db } = await open(t);
  const bot = db.create({ name: 'A' }, selection); const base = db.syncState().counter;
  db.enqueue(bot.id, randomUUID(), 'trabalho', selection);
  db.record('teste', 'algo'); db.run("INSERT INTO heartbeats(instance_id,created_at) VALUES('x','y')");
  db.run("INSERT INTO metadata VALUES('link.computer','{}') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  db.run("INSERT INTO metadata VALUES('limits.codex','{}') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  db.run("INSERT INTO metadata VALUES('queue.paused.x','1') ON CONFLICT(key) DO UPDATE SET value=excluded.value");
  db.run('INSERT INTO codex_sessions VALUES(?,?,?)', bot.id, 'sessao', stamp());
  const tables = new Set(db.all('SELECT DISTINCT tbl FROM changes').map(row => row.tbl));
  for (const table of ['tasks', 'task_events', 'codex_sessions', 'activity', 'heartbeats', 'approvals', 'events', 'usage']) assert.ok(!tables.has(table), table);
  assert.equal(db.all("SELECT * FROM changes WHERE tbl='metadata'").length, 0);
  assert.ok(db.syncState().counter >= base);
});

test('the person\'s own settings are logged; the rest of the metadata is not', async t => {
  const { db } = await open(t);
  db.setPerson({ name: 'Ana', theme: 'dark' });
  const keys = db.all("SELECT key,deleted FROM changes WHERE tbl='metadata' ORDER BY key").map(row => [row.key, row.deleted]);
  assert.deepEqual(keys, [['person.name', 0], ['person.theme', 0]]);
  db.setPerson({ name: '' });
  assert.deepEqual(db.all("SELECT key,deleted FROM changes WHERE tbl='metadata' AND key='person.name'").map(row => row.deleted), [1]);
});

test('changesSince pages through the log with each row\'s current content, and marks deleted rows', async t => {
  const { db } = await open(t);
  const bot = db.create({ name: 'A' }, selection); const ids = [];
  for (let n = 0; n < 5; n++) { const id = randomUUID(); ids.push(id); db.appendMessage(bot.id, { id, role: 'user', text: `m${n}`, status: 'complete', createdAt: stamp(n) }); }
  db.run('DELETE FROM messages WHERE id=?', ids[0]);
  const seen = []; let after = 0, more = true, pages = 0;
  while (more) { const page = db.changesSince(after, 2); pages++; seen.push(...page.changes); after = page.next; more = page.more; assert.equal(page.device, db.syncState().device); }
  assert.ok(pages >= 3); assert.deepEqual(seen.map(change => change.seq), [...seen.map(change => change.seq)].sort((a, b) => a - b));
  const byKey = Object.fromEntries(seen.map(change => [`${change.table}/${change.key}`, change]));
  assert.equal(byKey[`messages/${ids[0]}`].deleted, true); assert.equal(byKey[`messages/${ids[0]}`].data, undefined);
  assert.equal(JSON.parse(byKey[`messages/${ids[1]}`].data.body).text, 'm1'); assert.equal(byKey[`bots/${bot.id}`].data.id, bot.id);
  assert.equal(db.changesSince(db.syncState().counter).changes.length, 0);
  // Garbage cursors and sizes are harmless.
  assert.ok(db.changesSince('x', 'y').changes.length > 0); assert.equal(db.changesSince(-5, 0).changes.length >= 1, true);
});

test('writes made while "withoutLogging" (changes from the other device) do not enter the log, and logging comes back', async t => {
  const { db } = await open(t);
  const bot = db.create({ name: 'A' }, selection); const before = db.syncState().counter;
  const remote = randomUUID();
  db.withoutLogging(() => db.run('INSERT INTO messages(id,bot_id,body) VALUES(?,?,?)', remote, bot.id, JSON.stringify({ id: remote, role: 'user', text: 'veio de fora', createdAt: stamp() })));
  assert.equal(db.syncState().counter, before); assert.equal(log(db)[`messages/${remote}`], undefined);
  assert.throws(() => db.withoutLogging(() => { throw new Error('falha'); }), /falha/);
  const local = randomUUID(); db.appendMessage(bot.id, { id: local, role: 'user', text: 'local', status: 'complete', createdAt: stamp(1) });
  assert.ok(log(db)[`messages/${local}`]);
});

test('an existing database enters the log on upgrade, with each row\'s own time, and nothing is logged twice', async t => {
  const { db, directory } = await open(t);
  const bot = db.create({ name: 'Antigo' }, selection); const message = { id: randomUUID(), role: 'user', text: 'velha', status: 'complete', createdAt: stamp(5) };
  db.appendMessage(bot.id, message);
  const memory = randomUUID(); db.run('INSERT INTO memory(id,bot_id,body,updated_at) VALUES(?,?,?,?)', memory, bot.id, '{}', stamp(9));
  const grant = randomUUID(); db.run('INSERT INTO grants(id,bot_id,tool,body) VALUES(?,?,?,?)', grant, bot.id, 'browser', '{}');
  db.setPerson({ name: 'Ana' });
  // The database as the previous version left it: no log, no triggers, version 12.
  db.db.exec(`DROP TABLE changes; DROP TABLE sync_state; PRAGMA user_version=12;`);
  for (const table of Object.keys(SYNCED)) db.db.exec(`DROP TRIGGER IF EXISTS ${table}_log_insert; DROP TRIGGER IF EXISTS ${table}_log_update; DROP TRIGGER IF EXISTS ${table}_log_delete;`);
  db.close();
  const again = new Database(directory); t.after(() => { try { again.close(); } catch {} });
  assert.equal(again.get('PRAGMA user_version').user_version, SCHEMA);
  const entries = Object.fromEntries(again.all('SELECT * FROM changes').map(row => [`${row.tbl}/${row.key}`, row]));
  assert.equal(entries[`messages/${message.id}`].at, stamp(5)); assert.equal(entries[`memory/${memory}`].at, stamp(9));
  assert.equal(entries[`grants/${grant}`].at, '1970-01-01T00:00:00.000Z'); assert.ok(entries[`bots/${bot.id}`]); assert.ok(entries['metadata/person.name']);
  assert.equal(again.syncState().counter, Math.max(...Object.values(entries).map(row => row.seq)));
  const total = again.all('SELECT * FROM changes').length; const device = again.syncState().device; again.close();
  // Opening again (or running the step again) changes nothing.
  const third = new Database(directory); t.after(() => { try { third.close(); } catch {} });
  assert.equal(third.all('SELECT * FROM changes').length, total); assert.equal(third.syncState().device, device);
  third.db.exec('PRAGMA user_version=12'); third.close();
  const fourth = new Database(directory); t.after(() => { try { fourth.close(); } catch {} });
  assert.equal(fourth.all('SELECT * FROM changes').length, total); assert.equal(fourth.syncState().device, device);
});

test('the supervisor answers sync.status and sync.changes, and chat writes show up as changes', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-sync-rpc-')); const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'T', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
  const app = await createSupervisor({ directory, port: 0, codex, execute: async bot => ({ text: 'ok', ...selection, codexSessionId: randomUUID() }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Rpc', ...selection });
  const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'oi' });
  for (let i = 0; i < 200 && app.db.task(sent.taskId).state !== 'done'; i++) await new Promise(r => setTimeout(r, 25));
  const status = await app.rpc('sync.status');
  assert.equal(status.device, app.db.syncState().device); assert.ok(status.tables.bots >= 1); assert.ok(status.tables.messages >= 2);
  const page = await app.rpc('sync.changes', { after: 0, limit: 1000 });
  assert.ok(page.changes.some(change => change.table === 'bots' && change.key === bot.id));
  assert.equal(page.changes.filter(change => change.table === 'messages').length, status.tables.messages);
  assert.ok(!page.changes.some(change => change.table === 'tasks'));
});

test('upgrading from the first log version (13) adds attachments and stops logging a routine\'s schedule changes', async t => {
  const { db, directory } = await open(t);
  const bot = db.create({ name: 'V13' }, selection); const file = randomUUID();
  db.run('INSERT INTO attachments(id,bot_id,name,mime,size,created_at) VALUES(?,?,?,?,?,?)', file, bot.id, 'a.txt', 'text/plain', 3, stamp(4));
  const routine = randomUUID(); db.run('INSERT INTO routines(id,bot_id,body,enabled,next_run_at,created_at,updated_at) VALUES(?,?,?,1,?,?,?)', routine, bot.id, '{}', stamp(1), stamp(2), stamp(2));
  // The database as version 13 left it: no log of attachments, a routines trigger that fires on any column.
  db.db.exec(`DELETE FROM changes WHERE tbl='attachments'; DROP TRIGGER attachments_log_insert; DROP TRIGGER attachments_log_update; DROP TRIGGER attachments_log_delete;
    DROP TRIGGER routines_log_update; CREATE TRIGGER routines_log_update AFTER UPDATE ON routines BEGIN UPDATE sync_state SET counter=counter+1 WHERE id=1;
      INSERT INTO changes(tbl,key,seq,lamport,origin,at,deleted) SELECT 'routines', new.id, counter, counter, device, 'x', 0 FROM sync_state WHERE id=1
      ON CONFLICT(tbl,key) DO UPDATE SET seq=excluded.seq, lamport=excluded.lamport; END; PRAGMA user_version=13;`);
  db.close();
  const again = new Database(directory); t.after(() => { try { again.close(); } catch {} });
  assert.equal(again.get('PRAGMA user_version').user_version, SCHEMA);
  const entry = again.get("SELECT at,deleted FROM changes WHERE tbl='attachments' AND key=?", file); assert.equal(entry.at, stamp(4)); assert.equal(entry.deleted, 0);
  const before = again.get("SELECT seq FROM changes WHERE tbl='routines' AND key=?", routine).seq;
  again.run('UPDATE routines SET last_run_at=?,next_run_at=? WHERE id=?', stamp(5), stamp(6), routine);
  assert.equal(again.get("SELECT seq FROM changes WHERE tbl='routines' AND key=?", routine).seq, before);
  again.run('UPDATE routines SET enabled=0 WHERE id=?', routine);
  assert.ok(again.get("SELECT seq FROM changes WHERE tbl='routines' AND key=?", routine).seq > before);
  const attached = randomUUID(); again.run('INSERT INTO attachments(id,bot_id,name,mime,size,created_at) VALUES(?,?,?,?,?,?)', attached, bot.id, 'b.txt', 'text/plain', 1, stamp(7));
  assert.ok(again.get("SELECT 1 FROM changes WHERE tbl='attachments' AND key=?", attached));
});
