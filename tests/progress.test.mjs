import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSupervisor } from '../supervisor/index.mjs';

const require = createRequire(import.meta.url);
const { progressTracker } = require('../lib/codex-runner.cjs');
const claude = require('../lib/claude-runner.cjs');
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail('Estado esperado não chegou.'); }

test('what the IA says before moving on is shown as it goes; its last words are the reply', () => {
  const seen = []; const tracker = progressTracker(item => seen.push(item));
  tracker.message('Vou olhar a Gupy primeiro.'); tracker.step('Rodando curl …');
  tracker.message('A Gupy pagina de 10 em 10.'); tracker.message('Agora o filtro de cidade.'); tracker.message('Pronto: script em vagas.py.');
  assert.deepEqual(seen, [{ say: 'Vou olhar a Gupy primeiro.' }, { step: 'Rodando curl …' }, { say: 'A Gupy pagina de 10 em 10.' }, { say: 'Agora o filtro de cidade.' }]);
});

test('a reply is stopped only after a long silence, not while the IA keeps giving signs of life', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-idle-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const silent = join(directory, 'silent'); const chatty = join(directory, 'chatty');
  await writeFile(silent, '#!/bin/sh\nexec sleep 30\n'); await chmod(silent, 0o755);
  await writeFile(chatty, '#!/bin/sh\nfor i in 1 2 3 4 5 6; do echo \'{"type":"ping"}\'; sleep 0.15; done\nexec sleep 30\n'); await chmod(chatty, 0o755);
  let started = Date.now();
  await assert.rejects(claude.runReply({ model: 'haiku' }, 'oi', { binary: silent, idleMs: 300, maxMs: 60000 }), /tempo demais sem dar sinal/);
  assert.ok(Date.now() - started < 3000);
  started = Date.now();
  await assert.rejects(claude.runReply({ model: 'haiku' }, 'oi', { binary: chatty, idleMs: 300, maxMs: 60000 }), /tempo demais sem dar sinal/);
  assert.ok(Date.now() - started >= 900, 'the output kept it alive');
});

test('updates land in the chat and in the room before the final reply; the current step shows while it works', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-progress-'));
  let release; const gate = new Promise(resolve => { release = resolve; });
  const execute = async (bot, prompt, { onProgress }) => {
    onProgress({ say: `${bot.name}: vou começar pela Gupy.` }); onProgress({ step: 'Rodando python3 vagas.py' });
    await gate;
    return { text: `${bot.name}: pronto.`, ...selection, codexSessionId: randomUUID() };
  };
  const app = await createSupervisor({ directory, port: 0, codex, execute });
  t.after(async () => { release(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Programador', ...selection });
  const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Faz o script' });
  await until(() => app.state().tasks.find(task => task.id === sent.taskId)?.step === 'Rodando python3 vagas.py');
  assert.deepEqual(app.db.messages(bot.id).map(message => [message.role, message.text, Boolean(message.progress)]).slice(-2), [['user', 'Faz o script', false], ['assistant', 'Programador: vou começar pela Gupy.', true]]);
  release();
  await until(() => app.db.task(sent.taskId).state === 'done');
  assert.deepEqual(app.db.messages(bot.id).slice(-2).map(message => message.text), ['Programador: vou começar pela Gupy.', 'Programador: pronto.']);
  assert.equal(app.state().tasks.find(task => task.id === sent.taskId)?.step, undefined);
  const other = await app.rpc('bot.create', { name: 'Pesquisador', ...selection });
  const room = await app.rpc('room.create', { name: 'Projeto vagas', botIds: [bot.id, other.id] });
  await app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: '@Programador começa' });
  await until(() => !app.db.tasks().some(task => ['queued', 'running'].includes(task.state)));
  const texts = app.db.roomMessages(room.id).map(message => message.text);
  assert.deepEqual(texts.slice(-2), ['Programador: vou começar pela Gupy.', 'Programador: pronto.']);
});
