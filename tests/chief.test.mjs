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
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { CHIEF_TEXT } from '../mobile/local.js';

const selection = { model: 'test', reasoningEffort: 'low' };
function open(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-chief-'));
  const db = new Database(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return db;
}
const chiefs = db => db.bots().filter(bot => bot.isChief).map(bot => bot.id);

test('the person creates or promotes one chief and previous grants cannot preserve that role', t => {
  const db = open(t), tools = new Tools(db);
  const a = db.create({ name: 'Lua', isChief: true }, selection);
  const b = db.create({ name: 'Sol' }, selection);
  assert.throws(() => db.create({ name: 'Outro', isChief: true }, selection), /Já existe/);
  assert.throws(() => db.configure(b.id, selection, { isChief: 'true' }), /inválido/);
  assert.throws(() => toolArguments('team.create_bot', { name: 'Novo', isChief: true }), /argumento/);
  const room = new Rooms(db).create({ name: 'Sala', botIds: [a.id, b.id] });
  for (const bot of [a,b]) {
    db.session(bot.id, randomUUID()); db.setRoomSession(room.id, bot.id, randomUUID());
  }
  tools.grant(a.id, 'shared.note_read', true);
  assert.equal(db.configure(b.id, selection, { isChief: true }).isChief, true);
  assert.deepEqual(chiefs(db), [b.id]);
  for (const bot of [a,b]) {
    assert.ok(!db.roomSession(room.id, bot.id)); assert.ok(!db.bot(bot.id).codexSessionId);
    assert.equal(tools.policy(bot.id, 'shared.note_read'), bot.id === b.id ? 'allow' : 'deny');
  }
  assert.equal(db.bots().length, 2);
  const snapshot = db.snapshot(), restored = open(t);
  restored.restore(snapshot); assert.deepEqual(chiefs(restored), [b.id]);
  for (const bot of snapshot.bots) bot.isChief = true;
  assert.throws(() => restored.restore(snapshot), /mais de um Chefe/);
  db.delete(b.id); assert.deepEqual(chiefs(db), []);
  assert.equal(db.configure(a.id, selection, { isChief: true }).isChief, true);
});

test('concurrent promotions on paired devices converge on one chief', t => {
  const a = open(t), b = open(t);
  const lua = a.create({ name: 'Lua' }, selection), sol = a.create({ name: 'Sol' }, selection);
  b.applyChanges(a.changesSince().changes);
  a.configure(lua.id, selection, { isChief: true });
  b.configure(sol.id, selection, { isChief: true });
  const left = a.changesSince().changes, right = b.changesSince().changes;
  a.applyChanges(right); b.applyChanges(left);
  assert.equal(chiefs(a).length, 1);
  assert.deepEqual(chiefs(b), chiefs(a));
  const id = chiefs(a)[0];
  a.configure(id, selection, { isChief: false });
  b.applyChanges(a.changesSince().changes);
  assert.deepEqual(chiefs(b), []);
});

test('the chief delegates in a room and returns both results in the private chat', async t => {
  const db = open(t), tools = new Tools(db);
  const chief = db.create({ name: 'Lua', isChief: true }, selection);
  const workers = ['Sol', 'Mar'].map(name => db.create({ name }, selection));
  const execute = async (bot, prompt, options) => {
    const bridgeId = randomUUID();
    tools.context(options.tools.token, bridgeId, true);
    const call = (name, args = {}) => tools.callMcp(options.tools.token, { name, args, bridgeId, callId: randomUUID() });
    if (!bot.isChief) {
      assert.ok(!prompt.includes(CHIEF_TEXT));
      await call('delivery_write', { topic: 'Projeto', text: 'Entreguei a minha parte.' });
      return { text: bot.name === 'Sol' ? 'Escopo fechado.' : 'Prazo de cinco dias.' };
    }
    assert.ok(prompt.includes(CHIEF_TEXT));
    assert.equal((await call('shared_index_read')).body, '');
    await call('team_post', { room: 'Projeto', text: '@Sol confirme o escopo. @Mar confirme o prazo.' });
    for (let n = 0; n < 50; n++) {
      const page = await call('team_read_room', { room: 'Projeto' });
      if (!page.pending.length) {
        const text = page.messages.filter(line => /^(Sol|Mar):/.test(line)).join('\n');
        await call('shared_note_write', { path: 'chefe/index.md', text });
        return { text };
      }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    throw new Error('Tempo esgotado aguardando as entregas.');
  };
  const queue = new Queue(db, execute, tools);
  const rooms = new Rooms(db, { schedule: () => queue.schedule() });
  queue.rooms = rooms; tools.team = new Team(db, { rooms });
  rooms.create({ name: 'Projeto', botIds: [chief.id, ...workers.map(bot => bot.id)] });
  const task = db.enqueue(chief.id, randomUUID(), 'Combine o escopo e o prazo.', selection);
  try {
    await queue.pump();
    assert.equal(db.task(task.id).state, 'done');
    const summary = db.latest(chief.id, 'assistant').text;
    assert.match(summary, /Sol: Escopo fechado/); assert.match(summary, /Mar: Prazo de cinco dias/);
    assert.equal(db.get("SELECT body FROM notes WHERE path='chefe/index.md'").body, summary);
    assert.equal(db.all("SELECT * FROM notes WHERE kind='entrega'").length, 2);
  } finally { await queue.close(); }
});

test('team_status is chief-only and projects operational fields without private content', async t => {
  const db = open(t), tools = new Tools(db);
  const chief = db.create({ name: 'Lua', isChief: true }, selection);
  const bot = db.create({ name: 'Sol' }, selection);
  function connect(owner) {
    const task = db.start(db.enqueue(owner.id, randomUUID(), 'CONVERSA_PRIVADA', selection).id);
    const cap = tools.open(task), bridgeId = randomUUID();
    tools.context(cap.token, bridgeId, true);
    t.after(() => cap.close());
    return { names: () => tools.toolList(cap.token, bridgeId).map(item => item.name),
      call: (args = {}) => tools.callMcp(cap.token, { name: 'team_status', bridgeId, callId: randomUUID(), args }) };
  }
  const mine = connect(chief), other = connect(bot), at = new Date().toISOString();
  db.run('INSERT INTO pending_items VALUES(?,?,?,?,?)', randomUUID(), bot.id, JSON.stringify({ title: 'Comprar papel', details: 'DETALHE_PRIVADO' }), 'open', at);
  db.run('INSERT INTO pending_items VALUES(?,?,?,?,?)', randomUUID(), bot.id, '{"title":"CONCLUIDA"}', 'done', at);
  db.run('INSERT INTO routines(id,bot_id,body,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?)', randomUUID(), bot.id, '{"title":"Planejar","instructions":"ROTINA_PRIVADA"}', 1, at, at);
  assert.ok(!other.names().includes('team_status')); assert.ok(mine.names().includes('team_status'));
  await assert.rejects(other.call(), /permissão/);
  await assert.rejects(mine.call({ botId: bot.id }), /argumento/);
  db.record('item_created', 'ATIVIDADE_PRIVADA', bot.id);
  const result = await mine.call(), row = result.bots.find(item => item.id === bot.id);
  assert.equal(row.openItemCount, 1); assert.equal(row.openItems[0].title, 'Comprar papel');
  assert.deepEqual(row.routines, [{ title: 'Planejar', enabled: true, nextRunAt: null }]);
  assert.equal(row.lastActivity.kind, 'item_created'); assert.equal(row.activeTasks.running, 1);
  assert.doesNotMatch(JSON.stringify(result), /PRIVAD[AO]|CONCLUIDA/);
  tools.grant(chief.id, 'team.status', false);
  await assert.rejects(mine.call(), /permissão/);
});

test('rounds keep counting across rooms, and a bot may call its caller back and go deeper than two levels', t => {
  const db = open(t), rooms = new Rooms(db), team = new Team(db, { rooms });
  const [a,b,c,d] = ['Lua','Sol','Mar','Rio'].map(name => db.create({ name }, selection));
  const first = rooms.create({ name: 'Um', botIds: [a.id,b.id] });
  const second = rooms.create({ name: 'Dois', botIds: [a.id,b.id,c.id,d.id] });
  rooms.post(first.id, a, '@Sol revise', () => selection);
  const parent = rooms.active(first.id)[0].id;
  assert.equal(rooms.active(first.id)[0].round, 1);
  // Calling back whoever called is allowed, from a post and from a new room opened with a first message.
  assert.equal(rooms.post(first.id, b, '@Lua volte', () => selection, parent).posted, true);
  assert.equal(team.createRoom({ taskId: parent }, { name: 'Volta', bots: [a.id], message: '@Lua volte' }, b).created, true);
  rooms.post(second.id, b, '@Mar revise', () => selection, parent);
  const child = rooms.active(second.id)[0];
  assert.equal(child.round, 2);
  const resumed = new Rooms(db);
  // A third level is not blocked: the chain only ends when nobody is named.
  assert.equal(resumed.post(second.id, c, '@Rio revise', () => selection, child.id).posted, true);
  assert.equal(resumed.active(second.id).find(item => item.bot_id === d.id).round, 3);
  db.start(child.id); db.finish(child.id, 'done', { text: 'Confira @Rio e @Lua', ...selection });
  resumed.answered(child.id, () => selection);
  assert.ok(resumed.active(second.id).some(item => item.bot_id === a.id && item.round === 3));
  resumed.send(second.id, randomUUID(), '@Rio comece', () => selection);
  assert.equal(resumed.active(second.id).at(-1).round, 0);
});

test('the room queue limit counts the entire incoming batch of a person message or a post', t => {
  const db = open(t), rooms = new Rooms(db);
  const bots = ['Lua','Sol','Mar','Rio'].map(name => db.create({ name }, selection));
  const room = rooms.create({ name: 'Equipe', botIds: bots.map(bot => bot.id) });
  for (let n = 0; n < 11; n++) rooms.send(room.id, randomUUID(), '@Lua trabalhe', () => selection);
  assert.throws(() => rooms.send(room.id, randomUUID(), '@Sol @Mar', () => selection), /fila/);
  assert.throws(() => rooms.post(room.id, bots[0], '@Sol @Mar', () => selection), /fila/);
  rooms.send(room.id, randomUUID(), '@Lua termine', () => selection);
  assert.equal(rooms.active(room.id).length, 12);
});
