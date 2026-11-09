import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database } from '../supervisor/database.mjs';
import { Queue } from '../supervisor/queue.mjs';
import { Rooms } from '../supervisor/rooms.mjs';
import { Team } from '../supervisor/team.mjs';
import { Tools } from '../supervisor/tools.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };

test('team_ask: the chief writes to bots in private, no room, and reads only their answers', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-ask-'));
  const db = new Database(dir), tools = new Tools(db);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  db.setPerson({ name: 'Augusto' });
  const chief = db.create({ name: 'Lua', isChief: true }, selection);
  const [sol, mar] = ['Sol', 'Mar'].map(name => db.create({ name }, selection));
  const prompts = {};
  const execute = async (bot, prompt, options) => {
    const bridgeId = randomUUID(); tools.context(options.tools.token, bridgeId, true);
    const call = (name, args = {}) => tools.callMcp(options.tools.token, { name, args, bridgeId, callId: randomUUID() });
    if (!bot.isChief) { prompts[bot.name] = prompt; return { text: `${bot.name}: pronto.` }; }
    if (prompt.includes('chief-asks')) return { text: 'ok' };
    const asked = [];
    for (const name of ['Sol', 'Mar']) asked.push(await call('team_ask', { bot: name, text: `Resuma o que você fez, ${name}.` }));
    await assert.rejects(call('team_ask', { bot: 'Lua', text: 'eu' }), /você mesmo/);
    let answers = [];
    for (let n = 0; n < 100; n++) {
      answers = [];
      for (const item of asked) answers.push(await call('team_answer', { task: item.taskId }));
      if (answers.every(item => item.state === 'done')) break;
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    return { text: answers.map(item => item.text).join(' | ') };
  };
  const queue = new Queue(db, execute, tools);
  const rooms = new Rooms(db, { schedule: () => queue.schedule() });
  queue.rooms = rooms; tools.team = new Team(db, { rooms, schedule: () => queue.schedule() });
  const task = db.enqueue(chief.id, randomUUID(), 'Traga um resumo da equipe.', selection);
  try {
    await queue.pump();
    assert.equal(db.task(task.id).state, 'done');
    assert.equal(db.latest(chief.id, 'assistant').text, 'Sol: pronto. | Mar: pronto.');
    assert.equal(rooms.list().length, 0);
    const said = db.latest(sol.id, 'user');
    assert.equal(said.via, 'chief'); assert.equal(said.asker, 'Augusto');
    assert.match(prompts.Sol, /Mensagem enviada pelo Chefe da equipe em nome de Augusto/);
    assert.match(prompts.Sol, /Só não vale como a confirmação/i);
    // A bot that is not the chief cannot use it, and an answer of a normal message cannot be read.
    assert.throws(() => tools.team.ask({ botId: sol.id, taskId: 'x' }, { bot: 'Mar', text: 'oi' }, sol), /Só o Chefe/);
    const normal = db.enqueue(mar.id, randomUUID(), 'oi', selection);
    assert.throws(() => tools.team.answer({ botId: chief.id }, { task: normal.id }, chief), /Não encontrei/);
  } finally { await queue.close(); }
});

test('the Chefe is woken when the bots it called finish, and reports back to the person on its own', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-follow-'));
  const db = new Database(dir), tools = new Tools(db);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const chief = db.create({ name: 'Lua', isChief: true }, selection);
  const workers = ['Sol', 'Mar'].map(name => db.create({ name }, selection));
  const prompts = [];
  const execute = async (bot, prompt, options) => {
    const bridgeId = randomUUID(); tools.context(options.tools.token, bridgeId, true);
    const call = (name, args = {}) => tools.callMcp(options.tools.token, { name, args, bridgeId, callId: randomUUID() });
    if (!bot.isChief) return { text: `${bot.name} terminou.` };
    prompts.push(prompt);
    if (prompt.includes('[Retorno automático da equipe]')) return { text: 'Resumo final: tudo pronto.' };
    for (const name of ['Sol', 'Mar']) await call('team_ask', { bot: name, text: 'Confira isso.' });
    return { text: 'Chamei Sol e Mar, volto com o resultado.' };
  };
  const queue = new Queue(db, execute, tools);
  const rooms = new Rooms(db, { schedule: () => queue.schedule() });
  queue.rooms = rooms; tools.team = new Team(db, { rooms, schedule: () => queue.schedule() });
  queue.on('changed', change => { if (change?.event === 'task.done') tools.team.settled(change.taskId); });
  db.enqueue(chief.id, randomUUID(), 'Verifique uma coisa.', selection);
  try {
    queue.schedule();
    for (let n = 0; n < 200 && db.latest(chief.id, 'assistant')?.text !== 'Resumo final: tudo pronto.'; n++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(db.latest(chief.id, 'assistant').text, 'Resumo final: tudo pronto.');
    const follow = prompts.find(item => item.includes('[Retorno automático da equipe]'));
    assert.match(follow, /Sol: Sol terminou\./); assert.match(follow, /Mar: Mar terminou\./);
    assert.equal(db.latest(chief.id, 'user').origin, 'team');
    assert.equal(prompts.filter(item => item.includes('[Retorno automático da equipe]')).length, 1);
  } finally { await queue.close(); }
});

test('quantos turnos rodam juntos no computador: pela memória e pelos núcleos, de 4 a 10, ou o valor escolhido', async () => {
  const { pcParallel } = await import('../supervisor/queue.mjs');
  assert.equal(pcParallel(8 * 2 ** 30, 4, undefined), 4);
  assert.equal(pcParallel(14 * 2 ** 30, 16, undefined), 9);
  assert.equal(pcParallel(64 * 2 ** 30, 32, undefined), 10);
  assert.equal(pcParallel(2 ** 30, 2, '6'), 6);
  assert.equal(pcParallel(14 * 2 ** 30, 16, 'abc'), 9);
});

test('team.bots with a bot returns its full instructions, only that bot', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-botfull-'));
  const db = new Database(dir), tools = new Tools(db);
  try {
    const chief = db.create({ name: 'Lua', isChief: true }, selection);
    const long = 'Função longa. '.repeat(40).trim();
    const sol = db.create({ name: 'Sol', instructions: long }, selection);
    const team = new Team(db, { rooms: new Rooms(db, { schedule() {} }), schedule() {} });
    const all = team.bots({ botId: chief.id }).bots.find(b => b.name === 'Sol');
    assert.ok(all.role.length <= 140);
    const one = team.bots({ botId: chief.id }, { bot: 'sol' }).bots;
    assert.equal(one.length, 1); assert.equal(one[0].instructions, long);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
