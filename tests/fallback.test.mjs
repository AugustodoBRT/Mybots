import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSupervisor } from '../supervisor/index.mjs';

const require = createRequire(import.meta.url);
const claudeRunner = require('../lib/claude-runner.cjs');
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
const claude = { status: async () => ({ available: true, loggedIn: true }), models: async () => claudeRunner.CLAUDE_MODELS };
const SESSION = '11111111-2222-4333-8444-555555555555';
async function until(check, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// Claude's subscription limit is over; Codex answers. Every call is remembered with who made it and what it could use.
async function setup(t, { codexFails = false } = {}) {
  const calls = [];
  const execute = async (bot, prompt, options) => {
    calls.push({ provider: bot.provider || 'codex', prompt, session: bot.codexSessionId, tools: Boolean(options.tools), termux: options.tools?.termux, computer: options.tools?.computer });
    await options.onSession?.(SESSION);
    if (bot.provider === 'claude') throw Object.assign(new Error('O limite de uso da sua conta Claude foi atingido ou o serviço está ocupado. Tente novamente mais tarde.'), { codexSessionId: SESSION });
    if (codexFails) throw new Error('O Codex não conseguiu concluir a resposta.');
    return { text: 'Respondi pelo Codex', model: bot.model, reasoningEffort: bot.reasoningEffort, codexSessionId: SESSION, usage: { input: 10, cached: 0, output: 5 } };
  };
  const directory = await mkdtemp(join(tmpdir(), 'mybots-fallback-'));
  const app = await createSupervisor({ directory, port: 0, codex, claude, execute });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'A', provider: 'claude', model: 'opus', access: 'ask' });
  return { app, bot, calls, send: text => app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text }) };
}

test('without a reserve model, a limit error is shown as before', async t => {
  const f = await setup(t); const sent = await f.send('oi');
  await until(() => f.app.db.task(sent.taskId).state === 'failed');
  assert.deepEqual(f.calls.map(call => call.provider), ['claude']);
  assert.match(f.app.db.message(sent.messageId).error, /limite de uso/);
});

test('with a reserve model, the same turn is answered by the other IA, keeping the conversation and the bot\'s access', async t => {
  const f = await setup(t);
  await f.app.rpc('bot.update', { botId: f.bot.id, fallback: { provider: 'codex', model: 'test', reasoningEffort: 'low' } });
  assert.deepEqual(f.app.db.bot(f.bot.id).fallback, { provider: 'codex', model: 'test', reasoningEffort: 'low' });
  f.app.db.appendMessage(f.bot.id, { id: randomUUID(), role: 'user', text: 'Meu nome é Bia', status: 'complete', createdAt: new Date().toISOString() });
  f.app.db.appendMessage(f.bot.id, { id: randomUUID(), role: 'assistant', text: 'Prazer, Bia!', status: 'complete', createdAt: new Date().toISOString() });
  const sent = await f.send('Qual é o meu nome?');
  await until(() => f.app.db.task(sent.taskId).state === 'done');
  assert.deepEqual(f.calls.map(call => call.provider), ['claude', 'codex']);
  assert.match(f.calls[1].prompt, /Meu nome é Bia/, 'o histórico vai junto');
  assert.equal(f.calls[1].session, undefined, 'não tenta retomar a sessão de outra IA');
  const reply = f.app.db.messages(f.bot.id).at(-1);
  assert.equal(reply.text, 'Respondi pelo Codex'); assert.equal(reply.fallback, true);
  assert.ok(f.app.db.all("SELECT * FROM activity WHERE kind='model_fallback'").length === 1);
  // The reserve's session is never kept, and its tokens count for the provider that answered.
  assert.equal(f.app.db.get('SELECT * FROM codex_sessions WHERE bot_id=?', f.bot.id), undefined);
  assert.equal(f.app.db.bot(f.bot.id).codexSessionId, undefined);
  assert.equal(f.app.db.get('SELECT provider FROM usage WHERE bot_id=?', f.bot.id).provider, 'codex');
  assert.equal(f.app.db.bot(f.bot.id).provider, 'claude', 'o bot continua sendo do Claude');
});

test('the reserve cannot widen what the bot may do: same level, no shell where Codex cannot ask, and a failing reserve shows its own error', async t => {
  const f = await setup(t, { codexFails: true });
  await f.app.rpc('bot.update', { botId: f.bot.id, fallback: { provider: 'codex', model: 'test', reasoningEffort: 'low' } });
  const sent = await f.send('oi');
  await until(() => f.app.db.task(sent.taskId).state === 'failed');
  assert.equal(f.app.db.bot(f.bot.id).access, 'ask');
  assert.ok(f.calls.every(call => !call.termux && !call.computer), 'nenhum acesso extra ao celular ou computador');
  assert.match(f.app.db.message(sent.messageId).error, /Codex/);
  assert.equal(f.calls[1].session, undefined, 'a reserva nunca retoma nem grava a sessão do Claude');
});

test('a reserve of the same IA, or an unknown model, is refused', async t => {
  const f = await setup(t);
  await assert.rejects(f.app.rpc('bot.update', { botId: f.bot.id, fallback: { provider: 'claude', model: 'sonnet' } }), /outra IA/);
  await assert.rejects(f.app.rpc('bot.update', { botId: f.bot.id, fallback: { provider: 'codex', model: 'nao-existe' } }), /catálogo/);
  await f.app.rpc('bot.update', { botId: f.bot.id, fallback: { provider: 'codex', model: 'test', reasoningEffort: 'low' } });
  await f.app.rpc('bot.update', { botId: f.bot.id, fallback: null });
  assert.equal(f.app.db.bot(f.bot.id).fallback, undefined);
});
