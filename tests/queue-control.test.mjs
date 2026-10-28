import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';

const SESSION = '11111111-2222-4333-8444-555555555555';
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// A runner that holds each turn until the test lets it go (or the turn is stopped), remembering what it was asked.
function slowRunner() {
  const calls = []; const gates = [];
  const execute = (bot, prompt, { signal, onSession }) => new Promise((resolve, reject) => {
    const call = { prompt, release: () => resolve({ text: 'pronto ' + calls.length, ...selection, codexSessionId: SESSION }) };
    calls.push(call); gates.push(call); onSession?.(SESSION);
    signal.addEventListener('abort', () => reject(Object.assign(new Error('parado'), { aborted: true })));
  });
  return { calls, execute };
}
async function setup(t) {
  const runner = slowRunner(); const directory = await mkdtemp(join(tmpdir(), 'mybots-queue-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: runner.execute });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'A', ...selection });
  const send = text => app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text });
  return { app, bot, runner, send };
}

test('pausing the line lets the running turn finish but starts nothing new until resumed', async t => {
  const { app, bot, runner, send } = await setup(t);
  await send('primeira'); await until(() => runner.calls.length === 1);
  await send('segunda'); await send('terceira');
  assert.deepEqual((await app.rpc('queue.pause', { botId: bot.id })).paused, true);
  assert.deepEqual((await app.rpc('state.get')).pausedQueues, [bot.id]);
  runner.calls[0].release();
  await until(() => app.db.all("SELECT * FROM tasks WHERE state='done'").length === 1);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(runner.calls.length, 1, 'nada novo começa com a fila pausada');
  assert.equal(app.db.all("SELECT * FROM tasks WHERE state='queued'").length, 2);
  await app.rpc('queue.pause', { botId: bot.id, paused: false });
  await until(() => runner.calls.length === 2);
  assert.deepEqual((await app.rpc('state.get')).pausedQueues, []);
});

test('"corrigir rumo" is not held back by a paused line', async t => {
  const { app, bot, runner, send } = await setup(t);
  await send('primeira'); await until(() => runner.calls.length === 1);
  await send('segunda'); await app.rpc('queue.pause', { botId: bot.id });
  await app.rpc('task.steer', { botId: bot.id, requestId: randomUUID(), text: 'mude de assunto' });
  await until(() => runner.calls.length === 2);
  assert.match(runner.calls[1].prompt, /mude de assunto/);
  runner.calls[1].release(); await until(() => app.db.all("SELECT * FROM tasks WHERE state='done'").length === 1);
  await new Promise(r => setTimeout(r, 60));
  assert.equal(runner.calls.length, 2, 'a fila segue pausada para o resto');
});

test('a waiting item can be cancelled without touching the others, and shows what it will say', async t => {
  const { app, runner, send } = await setup(t);
  await send('primeira'); await until(() => runner.calls.length === 1);
  const second = await send('segunda'); const third = await send('terceira');
  const queued = (await app.rpc('state.get')).tasks.filter(task => task.state === 'queued');
  assert.deepEqual(queued.map(task => task.preview).sort(), ['segunda', 'terceira']);
  await app.rpc('task.cancel', { taskId: second.taskId });
  assert.equal(app.db.task(second.taskId).state, 'cancelled'); assert.equal(app.db.task(third.taskId).state, 'queued');
  runner.calls[0].release();
  await until(() => runner.calls.length === 2);
  assert.match(runner.calls[1].prompt, /terceira/); assert.doesNotMatch(runner.calls[1].prompt, /segunda/);
});

test('"corrigir rumo" stops the running turn and its instruction goes ahead of the line, in the same session', async t => {
  const { app, bot, runner, send } = await setup(t);
  const first = await send('faça o relatório'); await until(() => runner.calls.length === 1);
  await send('depois me lembre do dentista');
  const steered = await app.rpc('task.steer', { botId: bot.id, requestId: randomUUID(), text: 'só o resumo de uma página' });
  assert.equal(app.db.task(first.taskId).state, 'cancelled');
  assert.match(app.db.message(first.messageId).error, /corrigir o rumo/);
  await until(() => runner.calls.length === 2);
  assert.match(runner.calls[1].prompt, /corrigir o rumo/); assert.match(runner.calls[1].prompt, /só o resumo de uma página/);
  assert.doesNotMatch(runner.calls[1].prompt, /dentista/, 'a instrução passa à frente do que já esperava');
  runner.calls[1].release();
  await until(() => runner.calls.length === 3);
  assert.match(runner.calls[2].prompt, /dentista/);
  assert.equal(app.db.task(steered.taskId).state === 'done' || app.db.task(steered.taskId).state === 'running', true);
  // Nothing to steer when the bot is idle.
  runner.calls[2].release(); await until(() => app.db.activeTasks(bot.id).length === 0);
  await assert.rejects(app.rpc('task.steer', { botId: bot.id, requestId: randomUUID(), text: 'x' }), /não está trabalhando/);
});
