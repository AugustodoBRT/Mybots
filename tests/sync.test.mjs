import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { createSync } from '../pc/sync.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'T', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const stamp = n => new Date(Date.UTC(2026, 10, 3, 12, 0, n)).toISOString();

async function pair(t, options = {}) {
  const base = await mkdtemp(join(tmpdir(), 'mybots-sync-'));
  const phone = await createSupervisor({ directory: join(base, 'phone'), port: 0, codex, kind: 'phone', execute: async () => ({ text: 'x', ...selection }) });
  const computer = await createSupervisor({ directory: join(base, 'pc'), port: 0, codex, kind: 'computer', execute: async () => ({ text: 'x', ...selection }) });
  const sides = { phone: { online: () => true, call: (method, params) => phone.rpc(method, params) }, local: { online: () => true, call: (method, params) => computer.rpc(method, params) } };
  const sync = createSync({ directory: join(base, 'node'), ...sides, minGapMs: 0, delayMs: 0, intervalMs: 3600000, log: () => {}, ...options });
  t.after(async () => { sync.close(); await phone.close(); await computer.close(); await rm(base, { recursive: true, force: true }); });
  return { phone, computer, sync, sides, base };
}
const messagesOf = (app, botId) => app.db.all('SELECT id,body FROM messages WHERE bot_id=? ORDER BY id', botId).map(row => JSON.parse(row.body).text);
const sentence = (app, botId, text, n) => app.db.appendMessage(botId, { id: randomUUID(), role: 'user', text, status: 'complete', createdAt: stamp(n) });

test('the first round brings the phone\'s bots, chats, memory, rooms and settings to the empty computer, and the access level never goes up', async t => {
  const f = await pair(t);
  const a = f.phone.db.create({ name: 'Maniaco', access: 'full' }, selection); const b = f.phone.db.create({ name: 'Livre', access: 'free' }, selection); const c = f.phone.db.create({ name: 'Pouco', access: 'basic' }, selection);
  for (let n = 0; n < 5; n++) sentence(f.phone, a.id, `mensagem ${n}`, n);
  f.phone.db.run('INSERT INTO memory(id,bot_id,body,updated_at) VALUES(?,?,?,?)', randomUUID(), a.id, '{"text":"gosta de café"}', stamp(1));
  const room = randomUUID(); f.phone.db.run('INSERT INTO rooms(id,body,updated_at) VALUES(?,?,?)', room, JSON.stringify({ id: room, name: 'Sala', botIds: [a.id, b.id] }), stamp(2));
  f.phone.db.setPerson({ name: 'Ana', theme: 'dark' });
  const grant = randomUUID(); f.phone.db.run('INSERT INTO grants(id,bot_id,tool,body) VALUES(?,?,?,?)', grant, a.id, 'browser', '{"state":"allow"}');
  const status = await f.sync.now();
  assert.equal(status.state, 'idle'); assert.ok(status.firstAt);
  assert.deepEqual(messagesOf(f.computer, a.id), messagesOf(f.phone, a.id));
  assert.equal(f.computer.db.bot(a.id).name, 'Maniaco');
  // What is stored: a bot arriving on the other device is at most Médio (the product also normalizes the level when it reads a bot), and the phone's own stay as they were.
  const stored = (app, id) => JSON.parse(app.db.get('SELECT body FROM bots WHERE id=?', id).body).access;
  for (const bot of [a, b, c]) assert.equal(stored(f.computer, bot.id), 'ask');
  assert.equal(stored(f.phone, a.id), 'full'); assert.equal(stored(f.phone, c.id), 'full');
  assert.equal(f.computer.db.all('SELECT * FROM memory').length, 1); assert.equal(f.computer.db.get('SELECT id FROM rooms WHERE id=?', room).id, room);
  assert.deepEqual(f.computer.db.person(), { name: 'Ana', theme: 'dark' });
  assert.equal(f.computer.db.get('SELECT 1 FROM grants WHERE id=?', grant), undefined);   // permissions are decided per device
  // Both supervisors know about the other side and how the round went.
  assert.equal(f.computer.state().sync.peer, 'Celular'); assert.equal(f.phone.state().sync.peer, 'Computador'); assert.equal(f.phone.state().sync.state, 'idle');
});

test('both directions, and nothing bounces back: a second round with no changes moves nothing', async t => {
  const f = await pair(t);
  const a = f.phone.db.create({ name: 'Do celular' }, selection); sentence(f.phone, a.id, 'oi do celular', 1);
  const b = f.computer.db.create({ name: 'Do PC' }, selection); sentence(f.computer, b.id, 'oi do PC', 2);
  await f.sync.now();
  assert.deepEqual(messagesOf(f.phone, b.id), ['oi do PC']); assert.deepEqual(messagesOf(f.computer, a.id), ['oi do celular']);
  const counters = [f.phone.db.syncState().counter, f.computer.db.syncState().counter];
  const again = await f.sync.now(); assert.equal(again.state, 'idle');
  assert.deepEqual([f.phone.db.syncState().counter, f.computer.db.syncState().counter], counters);
  // A new message on one side crosses, and only that one.
  sentence(f.computer, a.id, 'resposta do PC', 3); await f.sync.now();
  assert.deepEqual(messagesOf(f.phone, a.id).sort(), ['oi do celular', 'resposta do PC'].sort());
  assert.equal(f.phone.db.all("SELECT * FROM changes WHERE origin=?", f.phone.db.syncState().device).length > 0, true);
});

test('the same record edited on both sides: the newest version wins, the loser is recorded in Activity, and both end equal', async t => {
  const f = await pair(t);
  const bot = f.phone.db.create({ name: 'Original' }, selection); await f.sync.now();
  // Both rename it while apart; the computer's edit is the later one.
  f.phone.db.putBot({ ...f.phone.db.bot(bot.id), name: 'Do celular', updatedAt: stamp(10) }); await wait(15);
  f.computer.db.putBot({ ...f.computer.db.bot(bot.id), name: 'Do computador', updatedAt: stamp(20) });
  await f.sync.now();
  assert.equal(f.phone.db.bot(bot.id).name, 'Do computador'); assert.equal(f.computer.db.bot(bot.id).name, 'Do computador');
  // Each device tells its own person: the phone lost its edit, the computer kept its own.
  const lost = f.phone.db.all("SELECT * FROM activity WHERE kind='sync_conflict'"); const kept = f.computer.db.all("SELECT * FROM activity WHERE kind='sync_conflict'");
  assert.equal(lost.length, 1); assert.match(lost[0].detail, /Conflito em bot “Do celular”.*a do outro aparelho/); assert.equal(f.phone.state().sync.conflicts, 1);
  assert.equal(kept.length, 1); assert.match(kept[0].detail, /a deste aparelho/);
  // An edit on one side only is not a conflict.
  f.phone.db.putBot({ ...f.phone.db.bot(bot.id), name: 'Só no celular', updatedAt: stamp(30) }); await f.sync.now();
  assert.equal(f.computer.db.bot(bot.id).name, 'Só no celular'); assert.equal(f.computer.db.all("SELECT * FROM activity WHERE kind='sync_conflict'").length, 1);   // still only the first one
});

test('deletions cross: a cleared chat, a deleted bot and a removed memory', async t => {
  const f = await pair(t);
  const bot = f.phone.db.create({ name: 'Apaga' }, selection); for (let n = 0; n < 3; n++) sentence(f.phone, bot.id, `m${n}`, n);
  const memory = randomUUID(); f.phone.db.run('INSERT INTO memory(id,bot_id,body,updated_at) VALUES(?,?,?,?)', memory, bot.id, '{"text":"x"}', stamp(1));
  await f.sync.now(); assert.equal(messagesOf(f.computer, bot.id).length, 3);
  f.phone.db.run('DELETE FROM messages WHERE bot_id=?', bot.id); f.phone.db.run('DELETE FROM memory WHERE id=?', memory);
  await f.sync.now();
  assert.equal(messagesOf(f.computer, bot.id).length, 0); assert.equal(f.computer.db.get('SELECT 1 FROM memory WHERE id=?', memory), undefined);
  // The search index stays right after rows arrive, change and go.
  sentence(f.computer, bot.id, 'palavra-rara-xyz', 9); await f.sync.now();
  assert.equal(f.phone.db.all("SELECT rowid FROM messages_fts WHERE messages_fts MATCH 'rara'").length, 1);
});

test('a bot\'s access level is decided per device: a higher level set on the phone does not reach the computer (and the rest of the bot does)', async t => {
  const f = await pair(t);
  const stored = (app, id) => JSON.parse(app.db.get('SELECT body FROM bots WHERE id=?', id).body);
  const bot = f.phone.db.create({ name: 'Nivel', access: 'ask' }, selection); await f.sync.now();
  f.phone.db.putBot({ ...stored(f.phone, bot.id), access: 'full', color: 'blue', updatedAt: stamp(6) }); await f.sync.now();
  assert.equal(stored(f.computer, bot.id).color, 'blue'); assert.equal(stored(f.computer, bot.id).access, 'ask');
  f.computer.db.putBot({ ...stored(f.computer, bot.id), access: 'free', updatedAt: stamp(50) }); await wait(5); await f.sync.now();
  assert.equal(stored(f.phone, bot.id).access, 'full');
});

test('routines are shared but run on one device: the phone while it is on, the computer while the phone is away', async t => {
  const f = await pair(t);
  const mine = f.phone.db.create({ name: 'Celular' }, selection); const theirs = f.computer.db.create({ name: 'PC' }, selection);
  const routine = f.phone.routines.create(mine.id, { title: 'Diária', instructions: 'Resuma o dia', trigger: { type: 'daily', time: '08:00', days: [0, 1, 2, 3, 4, 5, 6] } });
  assert.equal(f.phone.routines.owns(mine.id), true); assert.equal(f.computer.routines.owns(theirs.id), true);    // alone: everything runs where it is
  await f.sync.now();
  const copy = f.computer.routines.all().find(item => item.id === routine.id);
  assert.ok(copy); assert.equal(copy.title, 'Diária'); assert.ok(copy.nextRunAt, 'the arriving routine gets its own schedule');
  // "Onde estiver": the computer runs them while it is on, so a phone on mobile data dropping its connection does not kill the turn.
  assert.equal(f.phone.routines.owns(mine.id), false); assert.equal(f.phone.routines.owns(theirs.id), false);
  assert.equal(f.computer.routines.owns(mine.id), true); assert.equal(f.computer.routines.owns(theirs.id), true);
  // Notification routines stay with the phone, which is the one that sees the notifications.
  assert.equal(f.phone.routines.owns(mine.id, 'notification'), true); assert.equal(f.computer.routines.owns(mine.id, 'notification'), false);
  await f.sync.phone(false); assert.equal(f.computer.routines.owns(mine.id, 'notification'), true);   // the phone went away: the computer takes over
  await f.sync.now(); assert.equal(f.computer.routines.owns(mine.id, 'notification'), false);         // and gives it back when the phone returns
  // The phone takes the routines back when it stops hearing from the computer.
  const peer = JSON.parse(f.phone.db.get("SELECT value FROM metadata WHERE key='sync.peer'").value);
  f.phone.db.run("UPDATE metadata SET value=? WHERE key='sync.peer'", JSON.stringify({ ...peer, seenAt: new Date(Date.now() - 10 * 60000).toISOString() }));
  assert.equal(f.phone.routines.owns(mine.id), true);
  // A routine running (its schedule fields change) is not an edit of the routine.
  const before = f.phone.db.get("SELECT seq FROM changes WHERE tbl='routines' AND key=?", routine.id).seq;
  f.phone.db.run('UPDATE routines SET last_run_at=?,next_run_at=? WHERE id=?', stamp(1), stamp(2), routine.id);
  assert.equal(f.phone.db.get("SELECT seq FROM changes WHERE tbl='routines' AND key=?", routine.id).seq, before);
});

test('files follow their rows, in parts, up to the limit; a bigger one stays where it was made', async t => {
  const f = await pair(t, { fileLimit: 4 * 1024 * 1024 });
  const bot = f.phone.db.create({ name: 'Arquivos' }, selection);
  const small = Buffer.alloc(3 * 1024 * 1024 + 123, 7); const big = Buffer.alloc(5 * 1024 * 1024, 9);
  const one = f.phone.tools.attachments.store(bot.id, { name: 'pequeno.txt', mime: 'text/plain', bytes: small });
  const two = f.phone.tools.attachments.store(bot.id, { name: 'grande.txt', mime: 'text/plain', bytes: big });
  await f.sync.now();
  const stored = f.computer.tools.attachments;
  assert.ok(stored.has(one.id)); assert.deepEqual(await readFile(stored.path(one.id)), small);
  assert.equal(f.computer.db.get('SELECT size FROM attachments WHERE id=?', two.id).size, big.length); assert.equal(stored.has(two.id), false);
  // A file made on the computer reaches the phone the same way.
  const three = f.computer.tools.attachments.store(bot.id, { name: 'do-pc.txt', mime: 'text/plain', bytes: Buffer.from('olá do computador') }); await f.sync.now();
  assert.equal((await readFile(f.phone.tools.attachments.path(three.id))).toString(), 'olá do computador');
});

test('a device that was reinstalled (new id) is read again from the start, and what it already has is not duplicated', async t => {
  const f = await pair(t);
  const bot = f.phone.db.create({ name: 'Persistente' }, selection); for (let n = 0; n < 4; n++) sentence(f.phone, bot.id, `m${n}`, n);
  await f.sync.now();
  const base = await mkdtemp(join(tmpdir(), 'mybots-sync-new-'));
  const fresh = await createSupervisor({ directory: join(base, 'pc'), port: 0, codex, kind: 'computer', execute: async () => ({ text: 'x', ...selection }) });
  const again = createSync({ directory: join(base, 'node'), phone: f.sides.phone, local: { online: () => true, call: (method, params) => fresh.rpc(method, params) }, minGapMs: 0, delayMs: 0, log: () => {} });
  t.after(async () => { again.close(); await fresh.close(); await rm(base, { recursive: true, force: true }); });
  await again.now();
  assert.equal(messagesOf(fresh, bot.id).length, 4); assert.equal(fresh.db.bot(bot.id).name, 'Persistente');
  assert.equal(f.phone.db.all('SELECT * FROM messages WHERE bot_id=?', bot.id).length, 4);
});

test('big histories move in pages with progress, and a round that fails reports it without losing its place', async t => {
  const f = await pair(t, { pageSize: 50 });
  const bot = f.phone.db.create({ name: 'Longo' }, selection);
  f.phone.db.transaction(() => { for (let n = 0; n < 230; n++) sentence(f.phone, bot.id, `m${n}`, n % 50); });
  const seen = []; const original = f.sides.local.call; let broken = true;
  f.sides.local.call = async (method, params) => { if (method === 'sync.apply') { seen.push(params.changes.length); if (broken && seen.length === 3) { broken = false; throw new Error('conexão caiu'); } } return original(method, params); };
  const failed = await f.sync.now(); assert.equal(failed.state, 'error'); assert.match(failed.error, /conexão caiu/);
  const partial = messagesOf(f.computer, bot.id).length; assert.ok(partial > 0 && partial < 230);
  const ok = await f.sync.now(); assert.equal(ok.state, 'idle');
  assert.equal(messagesOf(f.computer, bot.id).length, 230);
  assert.ok(seen.every(size => size <= 50));
});

test('a mismatched version or an old phone is reported, and offline sides wait', async t => {
  const f = await pair(t);
  f.sides.phone.call = async method => { throw new Error('Isto só pode ser feito no celular.'); };
  assert.match((await f.sync.now()).error, /precisa do MyBots mais novo/);
  const g = await pair(t); g.sides.phone.online = () => false;
  assert.equal((await g.sync.now()).state, 'waiting');
  const h = await pair(t); const original = h.sides.local.call; h.sides.local.call = async (method, params) => { const value = await original(method, params); return method === 'sync.status' ? { ...value, schema: 99 } : value; };
  assert.match((await h.sync.now()).error, /versões diferentes/);
});
