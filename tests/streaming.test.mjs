import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSupervisor } from '../supervisor/index.mjs';
import { createStore } from '../mobile/state/store.js';

const require = createRequire(import.meta.url);
const { createBatcher } = require('../lib/stream-batch.cjs');
const claudeRunner = require('../lib/claude-runner.cjs');
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

test('the batcher sends the first piece at once and groups the rest by window, always with the latest full text', () => {
  const sent = []; const waiting = [];
  const batch = createBatcher(text => sent.push(text), { ms: 32, timers: { setTimeout: (fn, ms) => { waiting.push({ fn, ms }); return waiting.length; }, clearTimeout: () => {} } });
  batch.set('O'); batch.set('Olá'); batch.set('Olá, mun'); batch.set('Olá, mundo');
  assert.deepEqual(sent, ['O']); assert.equal(waiting.length, 1); assert.equal(waiting[0].ms, 32);
  waiting[0].fn();
  assert.deepEqual(sent, ['O', 'Olá, mundo']);
  batch.set('Olá, mundo!'); waiting[1].fn();
  assert.deepEqual(sent, ['O', 'Olá, mundo', 'Olá, mundo!']);
  batch.clear(); assert.equal(sent.at(-1), '');
});

// A Claude Code that streams partial messages when asked, like `--include-partial-messages`.
async function streamingClaude(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-stream-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'claude');
  await writeFile(binary, `#!${process.execPath}
const args = process.argv.slice(2); const id = args[args.indexOf('--session-id') + 1];
process.stdin.resume(); process.stdin.on('end', async () => {
  const out = event => console.log(JSON.stringify(event)); const wait = ms => new Promise(r => setTimeout(r, ms));
  out({ type: 'system', subtype: 'init', session_id: id, tools: [] });
  if (args.includes('--include-partial-messages')) {
    out({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
    for (const piece of ['Olá', ', ', 'mundo']) { out({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: piece } } }); await wait(50); }
  }
  out({ type: 'assistant', message: { content: [{ type: 'text', text: 'Olá, mundo' }] } });
  out({ type: 'result', subtype: 'success', is_error: false, result: 'Olá, mundo', session_id: id });
});`, { mode: 0o700 });
  return binary;
}

test('Claude asks for partial messages only when someone listens, and reports the reply as it grows', async t => {
  const binary = await streamingClaude(t); const drafts = [];
  const quiet = await claudeRunner.runReply({ model: 'sonnet', reasoningEffort: 'low' }, 'oi', { binary });
  assert.equal(quiet.text, 'Olá, mundo');
  const reply = await claudeRunner.runReply({ model: 'sonnet', reasoningEffort: 'low' }, 'oi', { binary, onDelta: text => drafts.push(text) });
  assert.equal(reply.text, 'Olá, mundo');
  assert.equal(drafts[0], ''); assert.ok(drafts.includes('Olá'), drafts.join('|')); assert.ok(drafts.includes('Olá, mundo')); assert.equal(drafts.at(-1), '');
  assert.ok(drafts.length <= 6, 'em lotes, não uma atualização por letra');
});

test('the supervisor broadcasts the draft of a private chat and clears it when the turn ends', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-draft-'));
  const execute = async (bot, prompt, { onDelta }) => { onDelta('Pri'); onDelta('Primeira parte'); await new Promise(r => setTimeout(r, 20)); return { text: 'Primeira parte final', ...selection }; };
  const app = await createSupervisor({ directory, port: 0, codex, execute });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'A', ...selection }); const seen = [];
  app.queue.on('changed', change => { if (change?.event === 'message.draft') seen.push({ botId: change.botId, text: change.text }); });
  const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'oi' });
  await until(() => app.db.task(sent.taskId).state === 'done');
  assert.deepEqual(seen.map(item => item.text), ['Pri', 'Primeira parte', '']);
  assert.ok(seen.every(item => item.botId === bot.id));
});

test('the app store keeps one draft per conversation and the finished message replaces it', () => {
  const store = createStore();
  store.draft({ botId: 'a', text: 'Escrevendo…' }); store.draft({ roomId: 'r', botId: 'b', text: 'Na sala' });
  assert.deepEqual(store.getSnapshot().drafts, { a: 'Escrevendo…', 'r:b': 'Na sala' });
  store.event('message.added', { botId: 'a', message: { id: 'm', role: 'assistant', text: 'pronto' } });
  assert.deepEqual(store.getSnapshot().drafts, { 'r:b': 'Na sala' });
  store.event('message.added', { roomId: 'r', message: { id: 'n', role: 'assistant', botId: 'b', text: 'pronto' } });
  assert.deepEqual(store.getSnapshot().drafts, {});
});
