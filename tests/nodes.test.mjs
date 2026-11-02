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

test('every bot responds on the phone while the PC is off and moves to the computer when it connects', async t => {
  const f = await setup(t);
  const bots = await Promise.all([f.make('Faculdade'), f.make('Programador', 'pc'), f.make('Pesquisa', 'any')]);
  for (const bot of bots) {
    assert.equal(bot.home, 'any');
    assert.deepEqual(f.app.state().presence[bot.id], { online: true, where: 'phone' });
    await f.send(bot, 'Oi');
  }
  await until(() => f.ran.length === 3);
  assert.ok(f.ran.every(item => item.where === 'phone'));
  const leave = f.app.nodes.connect({ id: 'notebook', connections: { codex: { loggedIn: true } }, execute: f.reply('pc') });
  const task = await f.send(bots[0], 'Continue');
  await until(() => f.app.db.task(task.taskId).state === 'done');
  assert.equal(f.ran.at(-1).where, 'pc');
  leave();
  assert.deepEqual(f.app.state().presence[bots[0].id], { online: true, where: 'phone' });
});

test('bots can work concurrently on the active device, but one bot never answers two turns at once', async t => {
  const f = await setup(t), a = await f.make('A'), b = await f.make('B');
  let release; const gate = new Promise(resolve => { release = resolve; });
  f.app.nodes.connect({ id: 'pc', connections: { codex: { loggedIn: true } }, execute: async bot => { f.ran.push({ bot: bot.name }); await gate; return { text: 'Ok', ...selection }; } });
  const first = await f.send(a, 'Primeira'), second = await f.send(a, 'Segunda'), third = await f.send(b, 'Outra');
  await until(() => f.ran.length === 2);
  assert.equal(f.app.db.task(first.taskId).state, 'running'); assert.equal(f.app.db.task(second.taskId).state, 'queued'); assert.equal(f.app.db.task(third.taskId).state, 'running');
  release(); await until(() => f.app.db.task(second.taskId).state === 'done');
});

test('disconnecting interrupts the running PC turn, while the next turn proceeds on the phone', async t => {
  const f = await setup(t), bot = await f.make('Programador', 'pc');
  let calls = 0;
  const leave = f.app.nodes.connect({ id: 'pc', connections: { codex: { loggedIn: true } }, execute: (bot, prompt, { signal }) => { calls++; return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('fechado')))); } });
  const first = await f.send(bot, 'Demorada'); await until(() => calls === 1);
  const next = await f.send(bot, 'Próxima'); leave();
  await until(() => f.app.db.task(first.taskId).state === 'failed');
  await until(() => f.app.db.task(next.taskId).state === 'done');
  assert.equal(calls, 1); assert.equal(f.ran.at(-1).where, 'phone');
});

test('known computer details survive restart while all bots stay available on the phone', async t => {
  const f = await setup(t), bot = await f.make('Programador', 'pc');
  f.app.nodes.connect({ id: 'notebook', connections: { codex: { loggedIn: true } }, name: 'Notebook', execute: f.reply('pc') })();
  const app = await f.restart();
  assert.equal(app.state().nodes[0].name, 'Notebook'); assert.equal(app.state().nodes[0].online, false);
  assert.deepEqual(app.state().presence[bot.id], { online: true, where: 'phone' });
  const turn = await f.send(bot, 'Oi'); await until(() => app.db.task(turn.taskId).state === 'done');
});
