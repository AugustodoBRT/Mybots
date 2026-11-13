import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Database, SCHEMA } from '../supervisor/database.mjs';
import { Rooms, ROOM_BOTS_MAX } from '../supervisor/rooms.mjs';
import { Team, BUSY_TASKS } from '../supervisor/team.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
function setup(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-busy-'));
  const db = new Database(dir);
  t.after(() => { try { db.close(); } catch {} rmSync(dir, { recursive: true, force: true }); });
  const rooms = new Rooms(db); const team = new Team(db, { rooms, schedule: () => {} });
  return { dir, db, rooms, team };
}

// 13/11/2026: the chief kept reminding a slow bot (Gemini in high effort) and its line grew to 6 requests.
test('the chief cannot pile a third request on a bot that is still working on one and has another waiting', t => {
  const { db, rooms, team } = setup(t);
  const chief = db.create({ name: 'Lua', isChief: true }, selection);
  const [sol, mar] = ['Sol', 'Mar'].map(name => db.create({ name }, selection));
  const run = { botId: chief.id, taskId: randomUUID() };
  assert.equal(BUSY_TASKS, 2);
  team.ask(run, { bot: 'Sol', text: 'Faça a tela.' }, chief);
  team.ask(run, { bot: 'Sol', text: 'E corrija o título.' }, chief);
  assert.throws(() => team.ask(run, { bot: 'Sol', text: 'Já terminou?' }, chief), /Sol \(1 em andamento e 1 na fila\) ainda não terminou.*junte todas as correções/s);
  // Another bot that is free still gets it.
  assert.equal(team.ask(run, { bot: 'Mar', text: 'Revise.' }, chief).asked, true);

  // In a room, calling the busy one is refused; calling only the free ones goes through; a post without @ calls nobody and goes through.
  const room = rooms.create({ name: 'Design', botIds: [chief.id, sol.id, mar.id] });
  assert.throws(() => team.post(run, { room: room.id, text: '@Sol como está?' }, chief), /Sol \(1 em andamento e 1 na fila\)/);
  assert.equal(team.post(run, { room: room.id, text: 'Pessoal, anotei tudo na pasta.' }, chief).posted, true);
  assert.deepEqual(team.post(run, { room: room.id, text: '@Mar confira a pasta.' }, chief).called, ['Mar']);
  // Once Sol finishes, it can be called again.
  for (const task of db.activeTasks(sol.id)) db.run("UPDATE tasks SET state='done' WHERE id=?", task.id);
  assert.deepEqual(team.post(run, { room: room.id, text: '@Sol agora sim.' }, chief).called, ['Sol']);
});

test('a room holds up to 30 bots, the app\'s own ceiling', t => {
  const { db, rooms } = setup(t);
  const bots = Array.from({ length: ROOM_BOTS_MAX + 1 }, (_, i) => db.create({ name: `Bot ${i + 1}` }, selection));
  assert.equal(ROOM_BOTS_MAX, 30);
  const room = rooms.create({ name: 'Todos', botIds: bots.slice(0, 30).map(bot => bot.id) });
  assert.equal(room.botIds.length, 30);
  assert.throws(() => rooms.create({ name: 'Demais', botIds: bots.map(bot => bot.id) }), /2 a 30 bots/);
  // A message to everyone in a full room queues one turn each.
  const sent = rooms.send(room.id, randomUUID(), 'Olá a todos', () => selection);
  assert.equal(sent.targets.length, 30);
});

test('Antigravity usage saved as running totals becomes per turn, with the cached part in the input', t => {
  const { dir, db } = setup(t);
  const bot = db.create({ name: 'Palco' }, selection), other = db.create({ name: 'Radar' }, selection);
  const add = (botId, at, input, cached, output, provider = 'agy') => db.run('INSERT INTO usage(id,bot_id,task_id,provider,model,input,cached,output,created_at,context) VALUES(?,?,?,?,?,?,?,?,?,?)',
    randomUUID(), botId, null, provider, 'gemini-4-hydrogen', input, cached, output, at, null);
  add(bot.id, '2026-11-13T03:30:00.000Z', 1000, 5000, 100);
  add(bot.id, '2026-11-13T03:31:00.000Z', 1500, 9000, 160);   // same conversation: +500, +4000, +60
  add(bot.id, '2026-11-13T03:40:00.000Z', 300, 200, 20);      // smaller: a new conversation
  add(other.id, '2026-11-13T03:41:00.000Z', 400, 100, 10);
  add(bot.id, '2026-11-13T03:42:00.000Z', 900, 900, 90, 'claude'); // other IAs untouched
  db.db.exec('PRAGMA user_version=22;'); db.close();
  const again = new Database(dir);
  try {
    assert.equal(again.get('PRAGMA user_version').user_version, SCHEMA);
    const rows = again.all('SELECT provider, input, cached, output FROM usage ORDER BY created_at').map(row => ({ ...row }));
    assert.deepEqual(rows, [
      { provider: 'agy', input: 6000, cached: 5000, output: 100 },
      { provider: 'agy', input: 4500, cached: 4000, output: 60 },
      { provider: 'agy', input: 500, cached: 200, output: 20 },
      { provider: 'agy', input: 500, cached: 100, output: 10 },
      { provider: 'claude', input: 900, cached: 900, output: 90 }
    ]);
  } finally { again.close(); }
});

test('the chief sees how long each model takes per reply here, without the wait in line', t => {
  const { db } = setup(t);
  const bot = db.create({ name: 'Palco' }, selection);
  const at = seconds => new Date(Date.parse('2026-11-13T03:00:00.000Z') + seconds * 1000).toISOString();
  const day = Date.now() - 3600000;
  for (const [i, took] of [100, 160, 200].entries()) {
    const task = db.enqueue(bot.id, randomUUID(), 'oi', { provider: 'agy', model: 'gemini-4-hydrogen', reasoningEffort: 'high' });
    db.run('DELETE FROM task_events WHERE task_id=?', task.id);
    const start = new Date(day + i * 1000).toISOString();
    db.run('INSERT INTO task_events(task_id,state,created_at) VALUES(?,?,?)', task.id, 'queued', at(0));
    db.run('INSERT INTO task_events(task_id,state,created_at) VALUES(?,?,?)', task.id, 'running', new Date(Date.parse(at(0)) + 300000).toISOString());
    db.run('INSERT INTO task_events(task_id,state,created_at) VALUES(?,?,?)', task.id, 'done', new Date(Date.parse(at(0)) + 300000 + took * 1000).toISOString());
    db.run('INSERT INTO usage(id,bot_id,task_id,provider,model,input,cached,output,created_at,context) VALUES(?,?,?,?,?,?,?,?,?,?)', randomUUID(), bot.id, task.id, 'agy', 'gemini-4-hydrogen', 1, 0, 1, start, null);
  }
  assert.deepEqual(db.turnSpeeds(), [{ provider: 'agy', model: 'gemini-4-hydrogen', effort: 'high', turns: 3, medianSeconds: 160 }]);
});

// 13/11/2026: Painel and Palco traded five "sigo parado" / "aguardo" messages, each waking the other for a paid turn.
test('a post that only acknowledges or waits does not wake the bots it names; a delivery with "aguardo" still does', async t => {
  const { onlyWaiting } = await import('../supervisor/rooms.mjs');
  for (const text of ['Combinado, @Painel. Sigo aguardando o aviso de liberação e as suas exportações junto com as do @Grafo.',
    '@Palco, não pediu nada novo, então sigo parado. Aviso na sala "Direção A pronta" quando eu terminar.', 'Certo, fico no aguardo sem mais ações até a liberação na sala.', 'Entendido, @chefin. Não vou usar desktop nesta fase.'])
    assert.equal(onlyWaiting(text), true, text);
  for (const text of ['@chefin, a direção B está pronta. Aguardo a direção A do Matiz.', '@chefin, tentei de novo e ainda dá erro: Failed to copy HTML. Aguardo.',
    '@Fluxo, exportei a direção A em time-stitch/direcao-a. Aguardo a revisão.', '@Painel, combinado. Você consegue exportar hoje?', 'Aguardo. ' + 'x'.repeat(300)])
    assert.equal(onlyWaiting(text), false, text);
  const { db, rooms } = setup(t);
  const [sol, mar] = ['Sol', 'Mar'].map(name => db.create({ name }, selection));
  const room = rooms.create({ name: 'Sala', botIds: [sol.id, mar.id] });
  assert.deepEqual(rooms.post(room.id, sol, '@Mar, entendido. Sigo aguardando a sua entrega.', () => selection).called, []);
  assert.equal(db.activeTasks(mar.id).length, 0);
  assert.deepEqual(rooms.post(room.id, sol, '@Mar, gravei o arquivo novo. Aguardo a revisão.', () => selection).called, ['Mar']);
  assert.equal(db.activeTasks(mar.id).length, 1);
});
