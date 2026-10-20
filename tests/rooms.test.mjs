import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { mentions, MAX_ROUNDS } from '../supervisor/rooms.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 600; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// A fake IA: answers by bot name, records each prompt and the session it was given.
async function setup(t, answer = bot => `Sou ${bot.name}.`) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-rooms-'));
  const calls = [];
  const execute = async (bot, prompt) => { calls.push({ bot: bot.name, prompt, session: bot.codexSessionId }); const session = bot.codexSessionId || randomUUID(); return { text: answer(bot, prompt, calls), ...selection, codexSessionId: session }; };
  const app = await createSupervisor({ directory, port: 0, codex, execute });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const make = name => app.rpc('bot.create', { name, instructions: `Bot ${name}.`, ...selection });
  const idle = () => until(() => !app.db.tasks().some(task => ['queued', 'running', 'waiting_approval'].includes(task.state)));
  return { app, calls, make, idle };
}

test('@mentions match member names without accents or case, in order', () => {
  const bots = [{ id: '1', name: 'Faculdade' }, { id: '2', name: 'Pobre Jobs' }, { id: '3', name: 'Ana' }];
  assert.deepEqual(mentions('oi @pobre jobs e @FACULDADE, cadê a @Anabela?', bots).map(bot => bot.id), ['2', '1']);
  assert.deepEqual(mentions('email@faculdade.br', bots), []);
  assert.deepEqual(mentions('@Faculdádé', bots).map(bot => bot.id), ['1']);
});

test('a room needs 2 to 8 bots; without @ all answer in order, with @ only the named ones, in the room only', async t => {
  const f = await setup(t);
  const [a, b, c] = [await f.make('Faculdade'), await f.make('Vagas'), await f.make('Agenda')];
  await assert.rejects(f.app.rpc('room.create', { name: 'Sala', botIds: [a.id] }), /2 a 8/);
  const room = await f.app.rpc('room.create', { name: 'Estudos', botIds: [a.id, b.id, c.id] });
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: 'Bom dia, time' });
  await f.idle();
  let messages = f.app.db.room(room.id).messages;
  assert.deepEqual(messages.map(item => item.role === 'user' ? 'Pessoa' : item.text), ['Pessoa', 'Sou Faculdade.', 'Sou Vagas.', 'Sou Agenda.']);
  // Private chats and private sessions are untouched.
  assert.equal(f.app.db.bot(a.id).messages.length, 0); assert.equal(f.app.db.bot(a.id).codexSessionId, undefined);
  const request = randomUUID();
  assert.deepEqual((await f.app.rpc('room.send', { roomId: room.id, requestId: request, text: '@Vagas, achou estágio?' })).targets, [b.id]);
  assert.equal((await f.app.rpc('room.send', { roomId: room.id, requestId: request, text: '@Vagas, achou estágio?' })).duplicate, true);
  await f.idle();
  messages = f.app.db.room(room.id).messages;
  assert.equal(messages.length, 6); assert.equal(messages.at(-1).botId, b.id);
  // The bot read the room with names, not another bot's private chat.
  const first = f.calls.find(call => call.bot === 'Agenda');
  assert.match(first.prompt, /sala de conversa chamada "Estudos"/); assert.match(first.prompt, /Faculdade: Sou Faculdade\./); assert.match(first.prompt, /Pessoa: Bom dia, time/);
  // A resumed room session gets only what is new since the bot last spoke.
  const resumed = f.calls.at(-1);
  assert.ok(resumed.session); assert.match(resumed.prompt, /novas mensagens/); assert.doesNotMatch(resumed.prompt, /Bom dia, time/); assert.match(resumed.prompt, /Pessoa: @Vagas, achou estágio\?/);
  assert.ok(f.app.db.roomSession(room.id, b.id));
  const state = await f.app.rpc('state.get');
  assert.equal(state.rooms[0].name, 'Estudos'); assert.deepEqual(state.rooms[0].active, []);
});

test('a bot naming another hands it the next turn, at most MAX_ROUNDS times after the person spoke', async t => {
  // Two bots that always ask each other.
  const f = await setup(t, bot => bot.name === 'Ping' ? 'Pergunta para @Pong.' : 'Devolvo para @Ping.');
  const ping = await f.make('Ping'); const pong = await f.make('Pong');
  const room = await f.app.rpc('room.create', { name: 'Eco', botIds: [ping.id, pong.id] });
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: '@Ping começa' });
  await f.idle();
  const answers = f.app.db.room(room.id).messages.filter(item => item.role === 'assistant');
  assert.equal(answers.length, 1 + MAX_ROUNDS);
  assert.deepEqual(answers.map(item => item.botId), [ping.id, pong.id, ping.id, pong.id]);
  // Turns from other bots tell the bot who called it.
  assert.match(f.calls[1].prompt, /Ping chamou você/);
});

test('rooms survive a backup restore; a room with answers in line cannot be deleted', async t => {
  let release; const hold = new Promise(resolve => { release = resolve; });
  const f = await setup(t);
  const a = await f.make('Um'); const b = await f.make('Dois');
  const room = await f.app.rpc('room.create', { name: 'Dupla', botIds: [a.id, b.id] });
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: 'oi' });
  await f.idle();
  const backup = f.app.db.snapshot();
  await f.app.rpc('room.delete', { roomId: room.id });
  assert.equal((await f.app.rpc('state.get')).rooms.length, 0);
  f.app.db.restore(backup);
  assert.equal(f.app.db.room(room.id).messages.length, 3); assert.equal((await f.app.rpc('state.get')).rooms.length, 1);
  f.app.queue.execute = async bot => { await hold; return { text: 'ok', ...selection }; };
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: 'de novo' });
  await assert.rejects(f.app.rpc('room.delete', { roomId: room.id }), /Aguarde/);
  release(); await f.idle();
});
