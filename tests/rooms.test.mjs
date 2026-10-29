import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { mentions } from '../supervisor/rooms.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 600; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// A fake IA: answers by bot name, records each prompt and the session it was given.
async function setup(t, answer = bot => `Sou ${bot.name}.`) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-rooms-'));
  const calls = [];
  const execute = async (bot, prompt) => { calls.push({ bot: bot.name, prompt, session: bot.codexSessionId }); const session = bot.codexSessionId || randomUUID(); return { text: await answer(bot, prompt, calls), ...selection, codexSessionId: session }; };
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
  let messages = f.app.db.roomMessages(room.id);
  assert.deepEqual(messages.map(item => item.role === 'user' ? 'Pessoa' : item.text), ['Pessoa', 'Sou Faculdade.', 'Sou Vagas.', 'Sou Agenda.']);
  // Private chats and private sessions are untouched.
  assert.equal(f.app.db.messages(a.id).length, 0); assert.equal(f.app.db.bot(a.id).codexSessionId, undefined);
  const request = randomUUID();
  assert.deepEqual((await f.app.rpc('room.send', { roomId: room.id, requestId: request, text: '@Vagas, achou estágio?' })).targets, [b.id]);
  assert.equal((await f.app.rpc('room.send', { roomId: room.id, requestId: request, text: '@Vagas, achou estágio?' })).duplicate, true);
  await f.idle();
  messages = f.app.db.roomMessages(room.id);
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

test('a bot naming another hands it the next turn, with no limit of rounds', async t => {
  // Two bots that ask each other until the 40th answer, past the old limit of 30 rounds.
  let count = 0;
  const f = await setup(t, bot => ++count >= 40 ? 'Pronto.' : bot.name === 'Ping' ? 'Pergunta para @Pong.' : 'Devolvo para @Ping.');
  const ping = await f.make('Ping'); const pong = await f.make('Pong');
  const room = await f.app.rpc('room.create', { name: 'Eco', botIds: [ping.id, pong.id] });
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: '@Ping começa' });
  await f.idle();
  const answers = f.app.db.roomMessages(room.id).filter(item => item.role === 'assistant');
  assert.equal(answers.length, 40);
  assert.deepEqual(answers.map(item => item.botId), Array.from({ length: 40 }, (_, index) => index % 2 ? pong.id : ping.id));
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
  assert.equal(f.app.db.roomMessages(room.id).length, 3); assert.equal((await f.app.rpc('state.get')).rooms.length, 1);
  f.app.queue.execute = async bot => { await hold; return { text: 'ok', ...selection }; };
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: 'de novo' });
  await assert.rejects(f.app.rpc('room.delete', { roomId: room.id }), /Aguarde/);
  release(); await f.idle();
});

test('a bot working for a long time does not hold the others: private chats and the room go on, while one bot still answers one turn at a time', async t => {
  let release; const hold = new Promise(resolve => { release = resolve; });
  const f = await setup(t, async bot => { if (bot.name === 'Lento') await hold; return `Sou ${bot.name}.`; });
  const [slow, quick, outside] = [await f.make('Lento'), await f.make('Rapido'), await f.make('Fora')];
  const room = await f.app.rpc('room.create', { name: 'Equipe', botIds: [slow.id, quick.id] });
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: '@Lento faça o trabalho grande' });
  await until(() => f.app.db.tasks().some(task => task.bot_id === slow.id && task.state === 'running'));
  // Another message of the person to the other member of the same room, and a private chat with it: both answer now.
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: '@Rapido e você?' });
  await until(() => f.app.db.roomMessages(room.id).some(item => item.botId === quick.id));
  await f.app.rpc('chat.send', { botId: quick.id, requestId: randomUUID(), text: 'Oi no privado' });
  await until(() => f.app.db.messages(quick.id).some(item => item.role === 'assistant'));
  // The busy bot itself waits its turn: a second message to it stays queued, in order.
  const again = await f.app.rpc('chat.send', { botId: slow.id, requestId: randomUUID(), text: 'E no privado?' });
  assert.equal(f.app.db.task(again.taskId).state, 'queued');
  assert.equal(f.app.db.task(f.app.db.all('SELECT task_id FROM room_turns').find(row => f.app.db.task(row.task_id).bot_id === slow.id).task_id).state, 'running');
  release(); await f.idle();
  assert.equal(f.app.db.messages(slow.id).filter(item => item.role === 'assistant').length, 1);
  assert.equal(f.app.db.messages(outside.id).length, 0);
});

test('bots called together with @ (by the person or by another bot) work at the same time; a message to everyone still goes in turn', async t => {
  let running = 0, most = 0; const release = [];
  const f = await setup(t, async bot => {
    if (['Produtor', 'Operador'].includes(bot.name)) { running++; most = Math.max(most, running); await new Promise(resolve => release.push(resolve)); running--; }
    return bot.name === 'Diretor' ? 'Chamando @Produtor e @Operador.' : `Feito, ${bot.name}.`;
  });
  const [director, producer, operator] = [await f.make('Diretor'), await f.make('Produtor'), await f.make('Operador')];
  const room = await f.app.rpc('room.create', { name: 'TikTok', botIds: [director.id, producer.id, operator.id] });
  // The director calls both in one answer: they start together.
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: '@Diretor organize o vídeo' });
  await until(() => release.length === 2);
  assert.equal(most, 2);
  release.splice(0).forEach(resolve => resolve()); await f.idle();
  // The person names two at once: also together.
  most = 0; running = 0;
  await f.app.rpc('room.send', { roomId: room.id, requestId: randomUUID(), text: '@Produtor e @Operador, comecem' });
  await until(() => release.length === 2);
  assert.equal(most, 2);
  release.splice(0).forEach(resolve => resolve()); await f.idle();
});

test('a long room opens fast: the state carries no messages and chat.page brings them by cursor', async t => {
  const f = await setup(t);
  const [a, b] = [await f.make('Um'), await f.make('Dois')];
  const room = await f.app.rpc('room.create', { name: 'Longa', botIds: [a.id, b.id] });
  const stamp = new Date().toISOString();
  for (let index = 0; index < 150; index++) f.app.db.appendRoomMessage(room.id, { id: randomUUID(), role: 'user', text: `Mensagem ${index}`, status: 'complete', createdAt: stamp });
  const shown = (await f.app.rpc('state.get')).rooms.find(item => item.id === room.id);
  assert.equal(shown.messages, undefined); assert.equal(shown.messageCount, 150); assert.equal(shown.lastMessage.text, 'Mensagem 149');
  const latest = await f.app.rpc('chat.page', { roomId: room.id });
  assert.equal(latest.messages.length, 40); assert.equal(latest.more, true); assert.equal(latest.messages.at(-1).text, 'Mensagem 149');
  const more = await f.app.rpc('chat.page', { roomId: room.id, before: latest.before, limit: 100 });
  assert.equal(more.messages.length, 100); assert.equal(more.more, true); assert.equal(more.messages[0].text, 'Mensagem 10');
  const rest = await f.app.rpc('chat.page', { roomId: room.id, before: more.before, limit: 100 });
  assert.equal(rest.messages.length, 10); assert.equal(rest.more, false); assert.equal(rest.messages[0].text, 'Mensagem 0');
  await assert.rejects(f.app.rpc('chat.page', { roomId: room.id, botId: a.id }), /bot ou a sala/);
  // The stored history is whole.
  assert.equal(f.app.db.roomMessages(room.id).length, 150);
});
