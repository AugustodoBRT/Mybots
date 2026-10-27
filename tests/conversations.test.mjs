import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import WebSocket from '../supervisor/node_modules/ws/index.js';
import { createSupervisor } from '../supervisor/index.mjs';
import { Database } from '../supervisor/database.mjs';
import { SupervisorClient } from '../mobile/supervisor-client.js';
import { inSequence, addPage, applyMessage, applyToLists, applyBot, applyStep } from '../mobile/chat-events.js';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check, ms = 5000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }
const stamp = index => new Date(Date.UTC(2026, 9, 1) + index * 1000).toISOString();
// A long message like the bots write: Markdown, a table and sometimes a file.
const body = index => `**Resposta ${index}**\n\n| Item | Valor |\n|---|---|\n| a | ${index} |\n\nTexto de exemplo com alguns detalhes para ocupar espaço como uma conversa real, número ${index}.`;

async function setup(t, execute = async () => ({ text: 'ok', ...selection })) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-chats-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, directory, make: name => app.rpc('bot.create', { name, ...selection }) };
}
function seedBot(db, botId, count) {
  db.transaction(() => { for (let index = 0; index < count; index++) db.appendMessage(botId, { id: randomUUID(), role: index % 2 ? 'assistant' : 'user', text: body(index), status: 'complete', createdAt: stamp(index), ...(index % 50 === 7 ? { attachments: [{ id: randomUUID(), name: `planilha-${index}.xlsx`, mime: 'application/vnd.ms-excel', size: 1200 }] } : {}) }); });
}
function seedRoom(db, roomId, botIds, count) {
  db.transaction(() => { for (let index = 0; index < count; index++) db.appendRoomMessage(roomId, { id: randomUUID(), role: index % 3 ? 'assistant' : 'user', ...(index % 3 ? { botId: botIds[index % botIds.length] } : {}), text: body(index), status: 'complete', createdAt: stamp(index) }); });
}

test('size budget: with 5 bots × 5000 messages and 3 rooms × 3000, state.get stays under 50 KB and 50 ms', async t => {
  const f = await setup(t);
  const bots = []; for (const name of ['Um', 'Dois', 'Três', 'Quatro', 'Cinco']) bots.push(await f.make(name));
  for (const bot of bots) seedBot(f.app.db, bot.id, 5000);
  for (const name of ['Sala A', 'Sala B', 'Sala C']) { const room = await f.app.rpc('room.create', { name, botIds: bots.slice(0, 3).map(bot => bot.id) }); seedRoom(f.app.db, room.id, room.botIds, 3000); }
  // A phone used for months: hundreds of finished turns and lots of activity, which the lists do not need.
  f.app.db.transaction(() => { for (let index = 0; index < 400; index++) { const id = randomUUID(); f.app.db.run("INSERT INTO tasks(id,bot_id,message_id,state,payload,error,created_at,updated_at) VALUES(?,?,?,'failed','{}',?,?,?)", id, bots[index % 5].id, randomUUID(), 'O computador desconectou durante esta resposta. O histórico foi preservado; mande de novo quando ele voltar.', stamp(index), stamp(index)); f.app.db.record('tool_browser', `Abriu https://example.com/pagina/${index} no navegador do bot.`, bots[index % 5].id, id); } });
  await f.app.rpc('state.get');
  const times = []; let state;
  for (let index = 0; index < 7; index++) { const start = performance.now(); state = await f.app.rpc('state.get'); times.push(performance.now() - start); }
  const size = Buffer.byteLength(JSON.stringify(state)); const median = times.sort((a, b) => a - b)[3];
  assert.ok(size < 50_000, `state.get tem ${size} bytes`); assert.ok(median < 50, `state.get levou ${median.toFixed(1)} ms`);
  assert.equal(state.bots.length, 5); assert.ok(state.bots.every(bot => bot.messages === undefined && bot.messageCount === 5000 && bot.lastMessage.text.length <= 280));
  assert.equal(state.tasks.length, 0); assert.equal((await f.app.rpc('tasks.list')).length, 200);
  assert.equal(state.rooms.length, 3); assert.ok(state.rooms.every(room => room.messages === undefined && room.messageCount === 3000));
  // Skills, memories and permissions come with the profile, not with every update.
  for (const key of ['skills', 'memories', 'grants', 'accountApps', 'toolsState', 'skillsState', 'roomsState']) assert.equal(state[key], undefined, key);
  const profile = await f.app.rpc('bot.profile', { botId: bots[0].id });
  assert.ok(Array.isArray(profile.grants) && profile.grants.length && Array.isArray(profile.memories) && Array.isArray(profile.skills) && Array.isArray(profile.accountApps));
  // Opening a conversation reads one page, whatever its size.
  const start = performance.now(); const page = await f.app.rpc('chat.page', { botId: bots[0].id }); const opened = performance.now() - start;
  assert.equal(page.messages.length, 40); assert.ok(opened < 50, `chat.page levou ${opened.toFixed(1)} ms`); assert.ok(Buffer.byteLength(JSON.stringify(page)) < 20_000);
  // Backups still carry everything.
  const snapshot = f.app.db.snapshot();
  assert.equal(snapshot.bots.find(bot => bot.id === bots[0].id).messages.length, 5000); assert.equal(snapshot.roomsState.rooms[0].messages.length, 3000);
});

test('chat.page walks a whole conversation by cursor without repeating or skipping; reading marks it as seen', async t => {
  const f = await setup(t);
  const bot = await f.make('Longo'); seedBot(f.app.db, bot.id, 1234);
  const other = await f.make('Outro'); seedBot(f.app.db, other.id, 30);
  assert.equal((await f.app.rpc('state.get')).bots.find(item => item.id === bot.id).unread, 100, 'não lidas param em 100');
  const seen = []; let page = await f.app.rpc('chat.page', { botId: bot.id, limit: 97 }); seen.unshift(...page.messages);
  while (page.more) { page = await f.app.rpc('chat.page', { botId: bot.id, before: page.before, limit: 97 }); seen.unshift(...page.messages); }
  const all = f.app.db.messages(bot.id);
  assert.equal(seen.length, 1234); assert.equal(new Set(seen.map(message => message.id)).size, 1234);
  assert.deepEqual(seen.map(message => message.id), all.map(message => message.id));
  assert.equal(page.messages[0].text, body(0));
  // The latest page marked it as seen; a new reply counts again.
  assert.equal((await f.app.rpc('state.get')).bots.find(item => item.id === bot.id).unread, 0);
  f.app.db.appendMessage(bot.id, { id: randomUUID(), role: 'assistant', text: 'Nova', status: 'complete', createdAt: stamp(9999) });
  const shown = (await f.app.rpc('state.get')).bots.find(item => item.id === bot.id);
  assert.equal(shown.unread, 1); assert.equal(shown.lastMessage.text, 'Nova'); assert.equal(shown.messageCount, 1235);
  await f.app.rpc('chat.read', { botId: bot.id }); assert.equal((await f.app.rpc('state.get')).bots.find(item => item.id === bot.id).unread, 0);
  // Pages of one bot never bring another's messages, and bad cursors are refused.
  assert.equal((await f.app.rpc('chat.page', { botId: other.id, limit: 200 })).messages.length, 30);
  await assert.rejects(f.app.rpc('chat.page', { botId: bot.id, before: -3 }), /Página inválida/);
  await assert.rejects(f.app.rpc('chat.page', { botId: randomUUID() }), /Bot não encontrado/);
  await assert.rejects(f.app.rpc('chat.history', { botId: bot.id }), /Operação não permitida/);
});

test('migration 9 moves room messages out of the room body, keeps their order and starts read marks at the end', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-migrate-')); t.after(() => rm(directory, { recursive: true, force: true }));
  let db = new Database(directory);
  const a = db.create({ name: 'A' }, selection); const b = db.create({ name: 'B' }, selection);
  db.appendMessage(a.id, { id: randomUUID(), role: 'user', text: 'oi', status: 'complete', createdAt: stamp(0) });
  // The database as v55 left it: version 8, the room's messages inside its JSON body.
  const roomId = randomUUID(); const messages = Array.from({ length: 1000 }, (_, index) => ({ id: randomUUID(), role: index % 2 ? 'assistant' : 'user', ...(index % 2 ? { botId: b.id } : {}), text: `Mensagem ${index}`, status: 'complete', createdAt: stamp(index) }));
  db.db.exec('DROP TABLE room_messages; PRAGMA user_version=8;'); db.run("DELETE FROM metadata WHERE key LIKE 'read.%'");
  db.run('INSERT INTO rooms(id,body,updated_at) VALUES(?,?,?)', roomId, JSON.stringify({ id: roomId, name: 'Antiga', botIds: [a.id, b.id], messages, createdAt: stamp(0), updatedAt: stamp(999) }), stamp(999));
  db.close();
  db = new Database(directory); t.after(() => db.close());
  assert.equal(db.get('PRAGMA user_version').user_version, 10);
  assert.equal(db.room(roomId).messages, undefined); assert.equal(db.room(roomId).name, 'Antiga');
  assert.deepEqual(db.roomMessages(roomId).map(message => message.text), messages.map(message => message.text));
  assert.deepEqual(db.chatSummary('room', roomId), { lastMessage: { id: messages[999].id, role: 'assistant', status: 'complete', text: 'Mensagem 999', createdAt: stamp(999), botId: b.id }, messageCount: 1000, unread: 0 });
  assert.equal(db.chatSummary('bot', a.id).unread, 0);
  // No cap anymore: the room grows past 1000.
  db.appendRoomMessage(roomId, { id: randomUUID(), role: 'user', text: 'Mensagem 1000', status: 'complete', createdAt: stamp(1000) });
  assert.equal(db.roomMessages(roomId).length, 1001); assert.equal(db.room(roomId).updatedAt, stamp(1000));
});

test('saving message 5000 costs the same as message 10: one insert, no rewrite of the chat', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-append-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new Database(directory); t.after(() => db.close());
  const bot = db.create({ name: 'Lua' }, selection);
  const statements = []; const prepare = db.db.prepare.bind(db.db); db.db.prepare = sql => { statements.push(sql); return prepare(sql); };
  // A whole turn: the person's message, the reply and the task, as the queue does it.
  const turn = () => {
    statements.length = 0; const start = performance.now();
    const task = db.enqueue(bot.id, randomUUID(), 'Oi de novo', selection); db.start(task.id); db.finish(task.id, 'done', { text: 'Olá', ...selection });
    return { statements: statements.length, writes: statements.filter(sql => /^(INSERT|UPDATE|DELETE)/.test(sql)).length, ms: performance.now() - start };
  };
  seedBot(db, bot.id, 8); const early = turn();
  seedBot(db, bot.id, 4990); const late = turn();
  assert.ok(db.messages(bot.id).length >= 5000);
  assert.equal(late.statements, early.statements); assert.equal(late.writes, early.writes);
  assert.ok(!statements.some(sql => /DELETE FROM messages/.test(sql)));
  assert.ok(late.ms < early.ms * 5 + 20, `mensagem 5000: ${late.ms.toFixed(1)} ms; mensagem 10: ${early.ms.toFixed(1)} ms`);
});

test('events carry their content and a growing number; steps are events only; the app sees gaps', async t => {
  let release; const f = await setup(t, async (bot, prompt, options) => {
    for (let index = 0; index < 5; index++) options.onProgress({ step: `Passo ${index}` });
    options.onProgress({ say: 'Começando.' });
    await new Promise(resolve => { release = resolve; });
    return { text: 'Pronto.', ...selection };
  });
  const bot = await f.make('Lua');
  const client = new SupervisorClient({ WebSocketClass: WebSocket, onEvent: (event, data) => events.push({ event, data }) }); const events = [];
  t.after(() => client.close()); await client.connect({ port: f.app.port, token: f.app.token });
  const state = await client.call('state.get');
  await client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Faz' });
  await until(() => release);
  const rows = f.app.db.messages(bot.id).length;
  release(); await until(() => f.app.db.messages(bot.id).length === rows + 1 && events.some(item => item.event === 'message.updated'));
  await until(() => events.some(item => item.event === 'task.done'));
  const numbered = events.filter(item => typeof item.data?.seq === 'number');
  assert.deepEqual(numbered.map(item => item.data.seq), numbered.map((_, index) => state.seq + 1 + index), 'números seguidos, a partir do estado');
  assert.deepEqual(new Set(numbered.map(item => item.event)), new Set(['message.added', 'message.updated', 'task.progress', 'bot.updated']));
  const added = numbered.filter(item => item.event === 'message.added').map(item => item.data.message.text);
  assert.deepEqual(added, ['Faz', 'Começando.', 'Pronto.']);
  assert.equal(numbered.find(item => item.event === 'message.updated').data.message.status, 'complete');
  assert.equal(numbered.find(item => item.event === 'bot.updated').data.bot.id, bot.id);
  // The steps went out as events (with the bot), and none of them rewrote the conversation.
  const steps = numbered.filter(item => item.event === 'task.progress' && 'step' in item.data);
  assert.deepEqual(steps.map(item => item.data.step).slice(0, 5), ['Passo 0', 'Passo 1', 'Passo 2', 'Passo 3', 'Passo 4']); assert.ok(steps.every(item => item.data.botId === bot.id));
  assert.equal(f.app.db.messages(bot.id).filter(message => message.progress).length, 1);
  // A step alone does not make every window ask for the whole state.
  const stepAt = events.findIndex(item => item.data?.step === 'Passo 1');
  assert.notEqual(events[stepAt + 1]?.event, 'activity.new');
  assert.equal((await client.call('state.get')).seq, numbered.at(-1).data.seq);
  // The app's side: the next number continues; anything else is a gap.
  assert.equal(inSequence(null, 7), true); assert.equal(inSequence(7, 8), true); assert.equal(inSequence(7, 9), false); assert.equal(inSequence(7, 3), false); assert.equal(inSequence(7, undefined), true);
});

test('the app applies pages and events to the open conversations and the lists without the state', () => {
  const message = (id, extra = {}) => ({ id, role: 'assistant', text: `m${id}`, status: 'complete', createdAt: stamp(Number(id)), ...extra });
  let chats = addPage({}, 'bot', { messages: [message('5'), message('6')], before: 50, more: true });
  chats = addPage(chats, 'bot', { messages: [message('3'), message('4'), message('5')], before: 30, more: false }, true);
  assert.deepEqual(chats.bot.messages.map(item => item.id), ['3', '4', '5', '6']); assert.equal(chats.bot.before, 30); assert.equal(chats.bot.more, false);
  chats = applyMessage(chats, 'message.added', { botId: 'bot', message: message('7') });
  chats = applyMessage(chats, 'message.added', { botId: 'bot', message: message('7') });
  chats = applyMessage(chats, 'message.updated', { botId: 'bot', message: message('6', { text: 'editada' }) });
  assert.deepEqual(chats.bot.messages.map(item => item.text), ['m3', 'm4', 'm5', 'editada', 'm7']);
  assert.equal(applyMessage(chats, 'message.added', { botId: 'other', message: message('8') }), chats, 'conversa não aberta fica para quando abrir');
  // The lists: latest, count, unseen (not for the open one nor for the person's own) and order.
  let data = { bots: [{ id: 'bot', messageCount: 7, unread: 0, updatedAt: stamp(1) }, { id: 'x', updatedAt: stamp(2) }], rooms: [{ id: 'r1', updatedAt: stamp(3), unread: 0 }, { id: 'r2', updatedAt: stamp(1) }], tasks: [{ id: 't', step: 'velho' }] };
  data = applyToLists(data, 'message.added', { botId: 'bot', message: message('8') });
  assert.deepEqual([data.bots[0].messageCount, data.bots[0].unread, data.bots[0].lastMessage.id], [8, 1, '8']);
  data = applyToLists(data, 'message.added', { botId: 'bot', message: message('9') }, 'bot');
  assert.equal(data.bots[0].unread, 1);
  data = applyToLists(data, 'message.added', { roomId: 'r2', message: message('20', { role: 'system' }) });
  assert.deepEqual(data.rooms.map(room => room.id), ['r2', 'r1']); assert.equal(data.rooms[0].lastMessage, undefined, 'aviso da sala não vira prévia');
  data = applyBot(data, { botId: 'x', bot: { id: 'x', name: 'X', updatedAt: stamp(100) } });
  assert.equal(data.bots[0].name, 'X');
  assert.equal(applyBot(data, { botId: 'x', bot: { id: 'x', deletedAt: stamp(101), updatedAt: stamp(101) } }).bots.length, 1);
  assert.equal(applyStep(data, { taskId: 't', step: 'Rodando' }).tasks[0].step, 'Rodando');
  assert.equal(applyStep(data, { taskId: 't', step: null }).tasks[0].step, undefined);
});
