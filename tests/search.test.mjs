import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from '../supervisor/database.mjs';
import { createSupervisor } from '../supervisor/index.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-search-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return app;
}
const say = (db, botId, text, extra = {}) => db.appendMessage(botId, { id: randomUUID(), role: 'assistant', text, status: 'complete', createdAt: new Date().toISOString(), ...extra });

test('search finds messages of every chat and room, ignoring accents and case, with the last word as a prefix', async t => {
  const app = await setup(t);
  const a = await app.rpc('bot.create', { name: 'A', ...selection }), b = await app.rpc('bot.create', { name: 'B', ...selection });
  say(app.db, a.id, 'A reunião de ação foi marcada para quinta');
  say(app.db, b.id, 'Nada a ver com isso');
  const room = await app.rpc('room.create', { name: 'Sala', botIds: [a.id, b.id] });
  app.db.appendRoomMessage(room.id, { id: randomUUID(), role: 'assistant', botId: a.id, text: 'Lembrete: ACAO urgente', status: 'complete', createdAt: new Date().toISOString() });
  const all = await app.rpc('chat.search', { query: 'acao' });
  assert.deepEqual(all.results.map(item => item.kind).sort(), ['bot', 'room']);
  assert.equal((await app.rpc('chat.search', { query: 'reuni' })).results.length, 1);
  assert.equal((await app.rpc('chat.search', { query: 'reunião quinta' })).results.length, 1);
  assert.equal((await app.rpc('chat.search', { query: 'reunião sexta' })).results.length, 0);
  assert.equal((await app.rpc('chat.search', { query: 'acao', botId: b.id })).results.length, 0);
  assert.equal((await app.rpc('chat.search', { query: 'acao', roomId: room.id })).results.length, 1);
  // Operators and quotes in the query are plain words, never FTS syntax.
  assert.deepEqual((await app.rpc('chat.search', { query: '" OR * NEAR(' })).results, []);
  assert.deepEqual((await app.rpc('chat.search', { query: '   ' })).results, []);
});

test('the index follows edits and deletions, and the migration can run twice without duplicates', async t => {
  const app = await setup(t);
  const bot = await app.rpc('bot.create', { name: 'A', ...selection });
  const message = say(app.db, bot.id, 'rascunho inicial');
  app.db.updateMessage(message.id, { text: 'versão final' });
  assert.equal((await app.rpc('chat.search', { query: 'rascunho' })).results.length, 0);
  assert.equal((await app.rpc('chat.search', { query: 'final' })).results.length, 1);
  // Lower the version and reopen: the migration runs again over the existing index.
  const directory = app.db.directory; app.db.db.exec('PRAGMA user_version=11');
  const again = new Database(directory);
  assert.equal(again.get('PRAGMA user_version').user_version, 12);
  assert.equal(again.search({ query: 'final' }).results.length, 1);
  assert.equal(again.get('SELECT count(*) AS n FROM messages_fts').n, 1);
  again.db.close();
  await app.rpc('bot.delete', { botId: bot.id });
  assert.equal((await app.rpc('chat.search', { query: 'final' })).results.length, 0);
});

test('pinning marks a message of a chat or a room and the pinned filter lists only those', async t => {
  const app = await setup(t);
  const bot = await app.rpc('bot.create', { name: 'A', ...selection }), other = await app.rpc('bot.create', { name: 'B', ...selection });
  const room = await app.rpc('room.create', { name: 'Sala', botIds: [bot.id, other.id] });
  const first = say(app.db, bot.id, 'um'), second = say(app.db, bot.id, 'dois');
  const line = app.db.appendRoomMessage(room.id, { id: randomUUID(), role: 'user', text: 'da sala', status: 'complete', createdAt: new Date().toISOString() });
  await app.rpc('message.pin', { messageId: second.id }); await app.rpc('message.pin', { messageId: line.id });
  const pinned = await app.rpc('chat.search', { pinned: true });
  assert.deepEqual(pinned.results.map(item => item.message.id).sort(), [second.id, line.id].sort());
  assert.equal((await app.rpc('chat.search', { pinned: true, botId: bot.id })).results.length, 1);
  await app.rpc('message.pin', { messageId: second.id, pinned: false });
  assert.equal(app.db.message(second.id).pinned, undefined);
  assert.equal((await app.rpc('chat.search', { pinned: true })).results.length, 1);
  await assert.rejects(app.rpc('message.pin', { messageId: randomUUID() }), /Mensagem não encontrada/);
});
