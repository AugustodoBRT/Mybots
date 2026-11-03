import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';

// A computer where only Claude Code is installed and logged in (Codex is not): the first thing a Windows user sees.
const noCodex = { status: async () => ({ available: false, loggedIn: false, message: 'Instale o Codex.' }), models: async () => [] };
const claude = { provider: 'claude', model: 'opus', displayName: 'Claude Opus', isDefault: true, efforts: ['low', 'medium', 'high'], defaultEffort: 'medium' };

test('a computer with only Claude: it is a working computer, the default model is Claude\'s, and a bot can be created and answered', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-only-claude-'));
  const app = await createSupervisor({ directory, port: 0, codex: noCodex, kind: 'computer' });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  // Nothing connected yet: nothing to offer, and the message says what to do (not a Codex that was never meant to be there).
  let state = await app.rpc('state.get'); assert.equal(state.defaultSelection, null); assert.equal(state.connection.loggedIn, false);
  const turns = [];
  app.nodes.connect({ id: 'este-pc', name: 'Este computador', connections: { claude: { available: true, loggedIn: true, message: '' } }, models: [claude], execute: async (bot, prompt) => { turns.push(bot.provider); return { text: 'Claude respondeu', model: 'opus', reasoningEffort: 'medium', codexSessionId: randomUUID() }; } });
  state = await app.rpc('state.get');
  assert.equal(state.connection.loggedIn, true); assert.match(state.connection.message, /Claude conectado/);
  assert.deepEqual(state.defaultSelection, { provider: 'claude', model: 'opus', reasoningEffort: 'medium' });
  assert.deepEqual(state.models.map(item => item.provider), ['claude']);
  // What the new-bot screen does: creates with the default selection and the bot is answered by the computer's Claude.
  const bot = await app.rpc('bot.create', { name: 'Só Claude', instructions: '', ...state.defaultSelection });
  assert.equal(bot.provider, 'claude');
  const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'oi' });
  for (let i = 0; i < 400 && app.db.task(sent.taskId).state !== 'done'; i++) await new Promise(resolve => setTimeout(resolve, 25));
  assert.equal(app.db.task(sent.taskId).state, 'done'); assert.deepEqual(turns, ['claude']);
  assert.equal(app.db.page({ botId: bot.id }).messages.at(-1).text, 'Claude respondeu');
});

test('with Codex and Claude both there, the default stays Codex (nothing changes for who already had it)', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-both-'));
  const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ model: 'gpt', displayName: 'GPT', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
  const app = await createSupervisor({ directory, port: 0, codex });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  app.nodes.connect({ id: 'pc', name: 'PC', connections: { claude: { available: true, loggedIn: true } }, models: [claude], execute: async () => ({ text: 'x' }) });
  const state = await app.rpc('state.get');
  assert.equal(state.defaultSelection.model, 'gpt'); assert.equal(state.defaultSelection.provider, 'codex');
  assert.deepEqual(new Set(state.models.map(item => item.provider || 'codex')), new Set(['codex', 'claude'])); assert.match(state.connection.message, /Codex e Claude conectados/);
});
