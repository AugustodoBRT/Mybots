import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 600; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// The phone's IA and a fake computer: each records who answered where.
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-nodes-'));
  const ran = [];
  const reply = where => async bot => { ran.push({ bot: bot.name, where }); return { text: `${bot.name} ${where}`, ...selection, codexSessionId: randomUUID() }; };
  let app = await createSupervisor({ directory, port: 0, codex, execute: reply('phone') });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const make = (name, home) => app.rpc('bot.create', { name, instructions: '', ...selection, ...(home ? { home } : {}) });
  const send = (bot, text) => app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text });
  const restart = async () => { await app.close(); app = await createSupervisor({ directory, port: 0, codex, execute: reply('phone') }); return app; };
  return { get app() { return app; }, ran, reply, make, send, restart };
}

test('a bot of the computer sleeps while it is off; its message waits and runs there once it connects', async t => {
  const f = await setup(t);
  const phone = await f.make('Faculdade'); const pc = await f.make('Programador', 'pc'); const any = await f.make('Pesquisa', 'any');
  assert.equal(phone.home, 'phone');
  let state = f.app.state();
  assert.deepEqual(state.presence[phone.id], { online: true, where: 'phone' });
  assert.deepEqual(state.presence[pc.id], { online: false, where: null, lastSeen: null });
  assert.deepEqual(state.presence[any.id], { online: true, where: 'phone' });

  const waiting = await f.send(pc, 'Cria um projeto');
  await f.send(phone, 'Oi'); await f.send(any, 'Pesquisa algo');
  await until(() => f.ran.length === 2);
  assert.deepEqual(f.ran.map(item => item.where), ['phone', 'phone']);
  assert.equal(f.app.db.task(waiting.taskId).state, 'queued');

  const leave = f.app.nodes.connect({ id: 'notebook', name: 'Notebook', execute: f.reply('pc') });
  await until(() => f.app.db.task(waiting.taskId).state === 'done');
  assert.deepEqual(f.ran.at(-1), { bot: 'Programador', where: 'pc' });
  state = f.app.state();
  assert.deepEqual(state.presence[pc.id], { online: true, where: 'pc' });
  assert.deepEqual(state.presence[any.id], { online: true, where: 'pc' });
  assert.equal(state.nodes[0].online, true);
  assert.match(state.activity.find(item => item.kind === 'node_connected').detail, /Notebook conectado: 1 bot ficou online/);

  leave();
  state = f.app.state();
  assert.equal(state.presence[pc.id].online, false);
  assert.ok(Date.parse(state.presence[pc.id].lastSeen) > 0);
  assert.deepEqual(state.presence[any.id], { online: true, where: 'phone' });
});

test('the computer and the phone answer at the same time, but one bot never answers two turns at once', async t => {
  const f = await setup(t);
  const phone = await f.make('Faculdade'); const any = await f.make('Pesquisa', 'any');
  let release; const gate = new Promise(resolve => { release = resolve; });
  f.app.nodes.connect({ id: 'notebook', execute: async bot => { f.ran.push({ bot: bot.name, where: 'pc' }); await gate; return { text: 'ok', ...selection, codexSessionId: randomUUID() }; } });
  const first = await f.send(any, 'Tarefa longa'); const second = await f.send(any, 'Outra');
  await until(() => f.ran.length === 1);
  const quick = await f.send(phone, 'Oi');
  await until(() => f.app.db.task(quick.taskId).state === 'done');
  assert.equal(f.app.db.task(first.taskId).state, 'running');
  assert.equal(f.app.db.task(second.taskId).state, 'queued');
  release();
  await until(() => f.app.db.task(second.taskId).state === 'done');
  assert.deepEqual(f.ran.filter(item => item.bot === 'Pesquisa').map(item => item.where), ['pc', 'pc']);
});

test('if the computer goes away mid-answer the turn is interrupted, not replayed; waiting turns keep waiting', async t => {
  const f = await setup(t);
  const pc = await f.make('Programador', 'pc');
  let calls = 0;
  const leave = f.app.nodes.connect({ id: 'notebook', execute: (bot, prompt, { signal }) => { calls++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('fechado')))); } });
  const running = await f.send(pc, 'Compila tudo'); const next = await f.send(pc, 'Depois roda os testes');
  await until(() => f.app.db.task(running.taskId).state === 'running');
  leave();
  await until(() => f.app.db.task(running.taskId).state === 'failed');
  assert.match(f.app.db.task(running.taskId).error, /computador desconectou/);
  assert.equal(f.app.db.task(next.taskId).state, 'queued');
  assert.equal(calls, 1);
  // A waiting turn can be cancelled like any queued one.
  await f.app.rpc('task.cancel', { taskId: next.taskId });
  assert.equal(f.app.db.task(next.taskId).state, 'cancelled');
});

test('"visto por último" survives a restart; a waiting turn does not keep the phone awake; moving a bot starts a new session', async t => {
  const f = await setup(t);
  const pc = await f.make('Programador', 'pc'); const phone = await f.make('Faculdade');
  f.app.nodes.connect({ id: 'notebook', name: 'Notebook', execute: f.reply('pc') })();
  await f.send(pc, 'Espera o PC');
  const app = await f.restart();
  const state = app.state();
  assert.equal(state.nodes[0].name, 'Notebook'); assert.equal(state.nodes[0].online, false);
  assert.equal(state.presence[pc.id].lastSeen, state.nodes[0].lastSeen);
  const wake = await fetch(`http://127.0.0.1:${app.port}/device/wake`, { method: 'POST', headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: '{}' }).then(response => response.json());
  assert.equal(wake.busy, false);
  // Changing where a bot lives waits for its line and then drops the session (it belongs to the other machine).
  await assert.rejects(app.rpc('bot.update', { botId: pc.id, home: 'phone' }), /Aguarde/);
  await f.send(phone, 'Oi'); await until(() => app.db.bot(phone.id).codexSessionId);
  const moved = await app.rpc('bot.update', { botId: phone.id, home: 'any' });
  assert.equal(moved.home, 'any'); assert.equal(moved.codexSessionId, undefined);
  assert.match(app.state().activity[0].detail, /Agora vive onde estiver ligado/);
  await assert.rejects(app.rpc('bot.update', { botId: phone.id, home: 'nuvem' }), /onde o bot vive/);
});
