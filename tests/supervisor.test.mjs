import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { Database } from '../supervisor/database.mjs';
import { Queue } from '../supervisor/queue.mjs';
import { createSupervisor } from '../supervisor/index.mjs';
import { SupervisorClient } from '../mobile/supervisor-client.js';
import { processIdentity } from '../supervisor/process.mjs';
import WS from '../supervisor/node_modules/ws/index.js';
const models = [{ model: 'test', displayName: 'Test', efforts: ['low'], defaultEffort: 'low', isDefault: true }];
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true, message: 'Conectado' }), models: async () => models };
const initial = () => {
  const stamp = new Date().toISOString();
  return { schema: 1, mode: 'phone', bots: [{ id: randomUUID(), name: 'Lua', color: 'green', instructions: '', ...selection,
    codexSessionId: randomUUID(), createdAt: stamp, updatedAt: stamp,
    messages: [{ id: randomUUID(), role: 'user', text: 'Lembre abacaxi', status: 'complete', createdAt: stamp }] }] };
};
async function directory(t) { const path = await mkdtemp(join(tmpdir(), 'mybots-supervisor-')); t.after(() => rm(path, { recursive: true, force: true })); return path; }
async function until(check) { for (let i = 0; i < 300; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 10)); } assert.fail('Estado esperado não chegou.'); }
async function fixture(t, execute = async bot => ({ text: 'abacaxi', codexSessionId: bot.codexSessionId || randomUUID(), ...selection })) {
  const path = await mkdtemp(join(tmpdir(), 'mybots-supervisor-'));
  const app = await createSupervisor({ directory: path, port: 0, codex, execute });
  const client = new SupervisorClient({ WebSocketClass: WS });
  await client.connect({ port: app.port, token: app.token });
  t.after(async () => { client.close(); await app.close(); await rm(path, { recursive: true, force: true }); });
  return { app, client, path };
}

test('SQLite migration preserves all bot/message/session IDs and imports exactly once', async t => {
  const path = await directory(t); const source = initial(); const input = JSON.stringify(source);
  const file = join(path, 'original.json'); await writeFile(file, input);
  let db = new Database(path);
  assert.equal(db.importLegacy(source), true);
  assert.equal(db.importLegacy(source), false);
  assert.deepEqual(db.snapshot().bots, source.bots.map(bot => ({ ...bot, browserMode: 'own' })));
  db.close(); db = new Database(path);
  assert.deepEqual(db.snapshot().bots, source.bots.map(bot => ({ ...bot, browserMode: 'own' })));
  assert.equal(await readFile(file, 'utf8'), input);
  assert.equal((await stat(join(path, 'mybots.db'))).mode & 0o777, 0o600);
  for (const table of ['bots','messages','codex_sessions','tasks','task_events','memory','grants','approvals','activity','connector_state','heartbeats']) assert.ok(db.get("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table));
  db.close();
});

test('corrupt import rolls back without discarding existing data', async t => {
  const db = new Database(await directory(t));
  const source = initial(); source.bots.push({ ...source.bots[0], id: randomUUID() });
  assert.throws(() => db.importLegacy(source));
  assert.equal(db.bots().length, 0);
  assert.equal(db.get("SELECT value FROM metadata WHERE key='legacy_imported'"), undefined);
  db.importLegacy(initial()); assert.equal(db.bots().length, 1); db.close();
});

test('WebSocket rejects a missing/wrong token and HTTP health is authenticated', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(`http://127.0.0.1:${f.app.port}/health`)).status, 401);
  const bad = new WS(`ws://127.0.0.1:${f.app.port}`); await once(bad, 'open');
  const closed = once(bad, 'close'); bad.send(JSON.stringify({ id: 'x', method: 'auth', params: { token: 'wrong' } }));
  assert.equal((await closed)[0], 1008);
  assert.equal((await f.client.call('state.get')).connection.loggedIn, true);
  assert.equal((await stat(join(f.path, 'token'))).mode & 0o777, 0o600);
  const serialized = JSON.stringify(await f.client.call('state.get'));
  assert.ok(!serialized.includes(f.app.token));
  assert.ok(!JSON.stringify(f.app.db.all('SELECT * FROM activity')).includes(f.app.token));
});

test('two clients see the same persistent task; reconnecting never loses or duplicates a response', async t => {
  let finish;
  const f = await fixture(t, () => new Promise(resolve => { finish = resolve; }));
  const bot = await f.client.call('bot.create', { name: 'Lua', ...selection });
  const requestId = randomUUID();
  const result = await f.client.call('chat.send', { botId: bot.id, requestId, text: 'Lembre abacaxi' });
  await until(() => finish);
  f.client.close();
  const second = new SupervisorClient({ WebSocketClass: WS });
  t.after(() => second.close()); await second.connect({ port: f.app.port, token: f.app.token });
  assert.equal((await second.call('tasks.list'))[0].state, 'running');
  finish({ text: 'abacaxi', codexSessionId: randomUUID(), ...selection });
  await until(() => f.app.db.task(result.taskId).state === 'done');
  const state = await second.call('state.get');
  assert.equal(state.bots[0].messages, undefined); assert.equal(state.bots[0].messageCount, 2); assert.equal(state.bots[0].lastMessage.text, 'abacaxi');
  assert.deepEqual((await second.call('chat.page', { botId: bot.id })).messages.map(message => message.text), ['Lembre abacaxi','abacaxi']);
  await second.call('chat.send', { botId: bot.id, requestId, text: 'Lembre abacaxi' });
  assert.equal(f.app.db.tasks().length, 1);
  await assert.rejects(second.call('chat.send', { botId: bot.id, requestId, text: 'Mensagem diferente' }), /outra mensagem/);
});

test('queue is persistent and startup marks uncertain running work as failed with a reason', async t => {
  const path = await directory(t); let db = new Database(path); const bot = db.create({ name: 'Lua' }, selection);
  const task = db.enqueue(bot.id, randomUUID(), 'Oi', selection); db.start(task.id); db.close();
  db = new Database(path); const queue = new Queue(db);
  queue.recover();
  assert.equal(db.task(task.id).state, 'failed');
  assert.match(db.task(task.id).error, /supervisor foi interrompido/);
  assert.equal(db.messages(bot.id)[0].status, 'error');
  assert.equal(db.tasks().length, 1); db.close();
});

test('queued tasks survive restart, use saved session and run together across bots', async t => {
  const path = await directory(t); let db = new Database(path);
  const source = initial(); db.importLegacy(source); const second = db.create({ name: 'Outra' }, selection);
  const a = db.enqueue(source.bots[0].id, randomUUID(), 'Primeira', selection);
  const b = db.enqueue(second.id, randomUUID(), 'Segunda', selection); db.close();
  db = new Database(path); let concurrent = 0, maximum = 0; const sessions = [];
  const queue = new Queue(db, async bot => { concurrent++; maximum = Math.max(maximum, concurrent); sessions.push(bot.codexSessionId); await new Promise(resolve => setTimeout(resolve, 20)); concurrent--; return { text: 'Oi', codexSessionId: bot.codexSessionId || randomUUID(), ...selection }; });
  queue.recover(); queue.schedule(); await until(() => db.task(b.id).state === 'done');
  assert.equal(db.task(a.id).state, 'done'); assert.equal(maximum, 2); assert.equal(sessions[0], source.bots[0].codexSessionId);
  await queue.close(); db.close();
});

test('cancel stops a real Codex subprocess and records cancellation only after exit', async t => {
  const f = await fixture(t, undefined);
  const fake = join(f.path, 'codex-fake.cjs');
  await writeFile(fake, `#!${process.execPath}\nif(process.argv[2]==='features'){console.log('shell_tool stable true');process.exit(0);}console.log(JSON.stringify({type:'thread.started',thread_id:'${randomUUID()}'})); setInterval(()=>{},1000);`, { mode: 0o700 });
  const previous = process.env.CODEX_BIN; process.env.CODEX_BIN = fake;
  t.after(() => { if (previous === undefined) delete process.env.CODEX_BIN; else process.env.CODEX_BIN = previous; });
  // Use the real runner here rather than the simulated fixture executor.
  const runner = (await import('../lib/codex-runner.cjs')).default;
  f.app.queue.execute = (bot, prompt, options) => runner.runReply(bot, prompt, { ...options, binary: fake });
  const bot = await f.client.call('bot.create', { name: 'Lua', ...selection });
  const { taskId } = await f.client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Espere' });
  await until(() => f.app.db.task(taskId).worker_pid);
  const pid = f.app.db.task(taskId).worker_pid;
  await f.client.call('task.cancel', { taskId });
  assert.equal(f.app.db.task(taskId).state, 'cancelled');
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  assert.equal((await f.client.call('chat.page', { botId: bot.id })).messages.length, 1);
});

test('orphan process is killed only when its recorded identity matches', async t => {
  const path = await directory(t); const db = new Database(path); const bot = db.create({ name: 'Lua' }, selection);
  const child = spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], { detached: true, stdio: 'ignore' });
  t.after(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch {} });
  const task = db.enqueue(bot.id, randomUUID(), 'Oi', selection); db.start(task.id);
  const exit = once(child, 'exit');
  db.run('UPDATE tasks SET worker_pid=?,worker_start=? WHERE id=?', child.pid, processIdentity(child.pid), task.id);
  const queue = new Queue(db); queue.recover(); await exit;
  assert.equal(db.task(task.id).state, 'failed'); db.close();
});

test('cancel queued work, delete and restore preserve IDs and protect active work', async t => {
  let finish;
  const f = await fixture(t, () => new Promise(resolve => { finish = resolve; }));
  const a = await f.client.call('bot.create', { name: 'Lua', ...selection });
  const b = await f.client.call('bot.create', { name: 'Sol', ...selection });
  const first = await f.client.call('chat.send', { botId: a.id, requestId: randomUUID(), text: 'Oi' }); await until(() => finish);
  // A bot answers one turn at a time: a second message to it waits in line (other bots would run alongside).
  const queued = await f.client.call('chat.send', { botId: a.id, requestId: randomUUID(), text: 'Oi de novo' });
  assert.equal(f.app.db.task(queued.taskId).state, 'queued');
  await f.client.call('task.cancel', { taskId: queued.taskId });
  assert.equal(f.app.db.task(queued.taskId).state, 'cancelled');
  await assert.rejects(f.client.call('bot.delete', { botId: a.id }), /Aguarde/);
  finish({ text: 'Oi', codexSessionId: randomUUID(), ...selection }); await until(() => f.app.db.task(first.taskId).state === 'done');
  const updated = await f.client.call('bot.update', { botId: a.id, name: 'Lua nova', instructions: 'Seja direta.' });
  assert.equal(updated.name, 'Lua nova'); assert.equal(updated.codexSessionId, undefined);
  assert.equal(f.app.db.messages(a.id).length, 3);
  const backup = await f.client.call('backup.create');
  const snapshot = await f.client.call('backup.read', { name: backup.name });
  await f.client.call('bot.delete', { botId: a.id });
  assert.equal((await f.client.call('bots.list')).length, 1);
  await f.client.call('backup.restore', { snapshot });
  assert.equal((await f.client.call('bots.list')).find(bot => bot.id === a.id).messageCount, 3);
  assert.equal((await f.client.call('chat.page', { botId: a.id })).messages.length, 3);
  await assert.rejects(f.client.call('backup.read', { name: '../token' }), /Backup inválido/);
  await assert.rejects(f.client.call('approval.respond', { approved: true }), /Nenhuma ação/);
});

test('heartbeat and activity reveal an interruption without claiming uninterrupted uptime', async t => {
  const f = await fixture(t);
  f.app.db.run('UPDATE heartbeats SET created_at=?', '2020-01-01T00:00:00.000Z');
  await f.app.close();
  const app = await createSupervisor({ directory: f.path, port: 0, codex });
  const late = app.db.all('SELECT * FROM activity').find(item => item.kind === 'heartbeat_late');
  assert.match(late.detail, /parado de .* até .*; iniciado de novo/);
  assert.equal(app.state().interruptions[0].id, late.id);
  assert.ok(Date.now() - Date.parse(app.state().heartbeat) < 5000);
  await app.close();
});

test('killing the actual supervisor persists the task and restart terminates its orphan worker', async t => {
  const path = await mkdtemp(join(tmpdir(), 'mybots-crash-test-'));
  const fake = join(path, 'codex-crash.cjs');
  const session = randomUUID();
  await writeFile(fake, `#!${process.execPath}
const {createInterface}=require('node:readline');
const args=process.argv.slice(2);
if(process.argv[2]==='features'){console.log('shell_tool stable true');process.exit(0);}
if(args[0]==='login') process.exit(0);
if(args[0]==='app-server') {
  const send=(id,result)=>console.log(JSON.stringify({id,result}));
  createInterface({input:process.stdin}).on('line',line=>{
    const request=JSON.parse(line);
    if(request.method==='initialize') send(request.id,{});
    if(request.method==='model/list') send(request.id,{data:[{model:'test',isDefault:true,defaultReasoningEffort:'low',supportedReasoningEfforts:[{reasoningEffort:'low'}]}],nextCursor:null});
  });
} else if(args[0]==='exec') {
  console.log(JSON.stringify({type:'thread.started',thread_id:'${session}'}));
  setInterval(()=>{},1000);
} else process.exit(1);
`, { mode: 0o700 });
  const entry = new URL('../supervisor/index.mjs', import.meta.url);
  const child = spawn(process.execPath, [entry.pathname], { env: { ...process.env, MYBOTS_HOME: path, MYBOTS_PORT: '0', CODEX_BIN: fake }, stdio: 'ignore' });
  let restarted, worker;
  const client = new SupervisorClient({ WebSocketClass: WS });
  t.after(async () => { client.close(); try { child.kill('SIGKILL'); } catch {} if (worker) { try { process.kill(-worker, 'SIGKILL'); } catch {} } await restarted?.close(); await rm(path, { recursive: true, force: true }); });
  let port, token;
  await until(async () => { try { port = JSON.parse(await readFile(join(path,'endpoint.json'),'utf8')).port; token = await readFile(join(path,'token'),'utf8'); return true; } catch { return false; } });
  await client.connect({ port, token });
  const bot = await client.call('bot.create', { name: 'Lua', ...selection });
  const { taskId } = await client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi' });
  await until(async () => (await client.call('state.get')).bots[0].codexSessionId === session);
  const inspector = new Database(path); worker = inspector.task(taskId).worker_pid; inspector.close();
  const exited = once(child,'exit'); child.kill('SIGKILL'); await exited;
  client.close();
  restarted = await createSupervisor({ directory: path, port: 0, codex });
  assert.equal(restarted.db.task(taskId).state, 'failed');
  assert.equal(restarted.db.bot(bot.id).codexSessionId, session);
  assert.equal(restarted.db.messages(bot.id)[0].id, restarted.db.task(taskId).message_id);
  assert.match(restarted.db.task(taskId).error, /supervisor foi interrompido/);
});

test('client reconnects with backoff and reads persisted state after server restart', async t => {
  const path = await mkdtemp(join(tmpdir(), 'mybots-reconnect-test-'));
  const first = await createSupervisor({ directory: path, port: 0, codex });
  let restarted;
  const client = new SupervisorClient({ WebSocketClass: WS });
  t.after(async () => { client.close(); await first.close(); await restarted?.close(); await rm(path, { recursive: true, force: true }); });
  await client.connect({ port: first.port, token: first.token });
  const bot = await client.call('bot.create', { name: 'Lua', ...selection });
  const port = first.port; await first.close();
  await until(() => !client.authenticated);
  restarted = await createSupervisor({ directory: path, port, codex });
  await until(() => client.authenticated);
  assert.equal((await client.call('state.get')).bots[0].id, bot.id);
});
