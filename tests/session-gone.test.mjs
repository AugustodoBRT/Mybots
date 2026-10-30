import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
const DEAD = '11111111-2222-4333-8444-555555555555', FRESH = '99999999-2222-4333-8444-555555555555';
async function until(check) { for (let i = 0; i < 600; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// The IA refuses to resume DEAD (its file is gone) and answers in any other session.
async function setup(t, { alwaysFails = false } = {}) {
  const calls = [];
  const execute = async (bot, prompt, options) => {
    calls.push({ bot: bot.name, prompt, session: bot.codexSessionId });
    if (alwaysFails || bot.codexSessionId === DEAD) throw Object.assign(new Error('O Codex não conseguiu concluir a resposta.'), { codexSessionId: bot.codexSessionId, output: `Error: thread/resume: thread/resume failed: no rollout found for thread id ${DEAD} (code -32600)` });
    await options.onSession?.(FRESH);
    return { text: `Respondi em ${FRESH.slice(0, 4)}`, ...selection, codexSessionId: FRESH };
  };
  const directory = await mkdtemp(join(tmpdir(), 'mybots-gone-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const make = name => app.rpc('bot.create', { name, instructions: `Bot ${name}.`, ...selection });
  return { app, calls, make };
}

test('a private chat whose saved session vanished starts a new one, with the history, and keeps working', async t => {
  const f = await setup(t); const bot = await f.make('Otávio');
  f.app.db.session(bot.id, DEAD);
  const sent = await f.app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'tá aí?' });
  await until(() => f.app.db.task(sent.taskId).state === 'done');
  assert.deepEqual(f.calls.map(call => call.session), [DEAD, undefined], 'tenta a antiga uma vez e refaz sem ela');
  assert.equal(f.app.db.bot(bot.id).codexSessionId, FRESH);
  assert.equal(f.app.db.all("SELECT * FROM activity WHERE kind='session_reset'").length, 1);
});

test('a room whose saved session vanished starts a new one with the full room prompt, for that bot only', async t => {
  const f = await setup(t); const [a, b] = [await f.make('Otávio'), await f.make('Marta')];
  const room = await f.app.rpc('room.create', { name: 'Estúdio', botIds: [a.id, b.id] });
  f.app.db.setRoomSession(room.id, a.id, DEAD);
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: '@Otávio tá aí?' });
  await until(() => f.app.db.roomMessages(room.id).some(item => item.role !== 'user' && /Respondi/.test(item.text)));
  const mine = f.calls.filter(call => call.bot === 'Otávio');
  assert.deepEqual(mine.map(call => call.session), [DEAD, undefined]);
  assert.equal(f.app.db.roomSession(room.id, a.id), FRESH);
  assert.equal(f.app.db.roomSession(room.id, b.id), undefined, 'a sessão dos outros não muda');
});

test('if the new session fails too, the error shows and nothing loops', async t => {
  const f = await setup(t, { alwaysFails: true }); const bot = await f.make('Otávio');
  f.app.db.session(bot.id, DEAD);
  const sent = await f.app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'oi' });
  await until(() => f.app.db.task(sent.taskId).state === 'failed');
  assert.equal(f.calls.length, 2);
});
