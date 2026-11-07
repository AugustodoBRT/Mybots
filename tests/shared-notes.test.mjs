import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { Database, SCHEMA } from '../supervisor/database.mjs';
import { validPath, links } from '../supervisor/notes.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { Tools } from '../supervisor/tools.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
function database(t) {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-notes-'));
  const db = new Database(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  return db;
}
function session(t, db, name = 'Lúa Azul', isChief = false) {
  const bot = db.create({ name, isChief, autonomy: 'local' }, selection);
  const tools = new Tools(db);
  const task = db.start(db.enqueue(bot.id, randomUUID(), 'Oi', selection).id);
  const cap = tools.open(task);
  const bridgeId = randomUUID();
  tools.context(cap.token, bridgeId, true);
  t.after(() => cap.close());
  return { bot, names: () => tools.toolList(cap.token, bridgeId).map(tool => tool.name), call: (name, args = {}) => tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name, args }),
    grant: (tool, allowed = true) => tools.grant(bot.id, tool, allowed) };
}

test('note paths, argument limits and normalized links', () => {
  for (const path of ['../x', '/x', 'outro/x.md', 'chefe/' + 'a'.repeat(112) + '.md', 'chefe/a..b.md','chefe//x.md','chefe/a.md\n']) {
    assert.equal(validPath(path), false);
    assert.throws(() => toolArguments('shared.note_read', { path }));
  }
  assert.deepEqual(links('[[pessoa]] [[ chefe/pessoa.md ]] [[chefe/projetos/site]] [[entregas/revisao.md]] [[../x]]'), ['chefe/pessoa.md','chefe/projetos/site.md','entregas/revisao.md']);
  assert.throws(() => toolArguments('shared.note_write', { path: 'chefe/a.md', text: 'x'.repeat(8001) }));
  assert.throws(() => toolArguments('delivery.write', { topic: 'x', text: 'x'.repeat(4001) }));
  assert.throws(() => toolArguments('shared.note_write', { path: 'arquivo/a.md', text: 'a' }));
  assert.throws(() => toolArguments('shared.note_write', { path: 'chefe/a.md', text: 'a', overwrite: 'true' }));
});

test('delivery identity, collision, per-bot grants and metadata listing', async t => {
  const db = database(t);
  const f = session(t, db);
  const other = session(t, db, 'Sol', true);
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 7, 23, 59) });
  const args = { topic: 'Revisão final', text: 'Pronto.' };
  await assert.rejects(f.call('delivery_write', { ...args, botId: other.bot.id }), /argumento/);
  const { path } = await f.call('delivery_write', args);
  assert.equal(path, 'entregas/2026-11-07-2359-lua-azul-revisao-final.md');
  const second = await f.call('delivery_write', { ...args, text: 'Outra entrega.' });
  assert.equal(second.path, path.replace('.md', '-2.md'));
  const requests = { shared_index_read: {}, shared_note_read: { path }, shared_note_write: { path: 'chefe/index.md', text: 'Índice' }, shared_archive: { path } };
  for (const [name, input] of Object.entries(requests)) await assert.rejects(f.call(name, input), /permissão/);
  assert.ok(f.names().includes('delivery_write'));
  assert.ok(!f.names().some(name => name.startsWith('shared_')));
  assert.throws(() => f.grant('shared.note_read'), /Chefe/);
  assert.ok(other.names().includes('shared_note_read'));
  const note = await other.call('shared_note_read', { path });
  assert.equal(note.bot_id, f.bot.id);
  assert.equal(note.body, 'Bot: Lúa Azul\nData: 2026-11-07T23:59:00.000Z\nAssunto: Revisão final\n\nPronto.');
  const { notes } = await other.call('shared_note_read', { list: true, prefix: 'entregas/' });
  assert.equal(notes.length, 2);
  assert.deepEqual(Object.keys(notes[0]).sort(), ['bot_id','path','title','updated_at']);
  other.grant('shared.note_read', false);
  await assert.rejects(other.call('shared_note_read', { path }), /permissão/);
  f.grant('delivery.write', false);
  await assert.rejects(f.call('delivery_write', args), /permissão/);
});

test('listing keeps the 100 most recent matching paths and omits bodies', async t => {
  const db = database(t);
  const f = session(t, db, 'Lua', true);
  f.grant('shared.note_read');
  for (let n = 0; n < 102; n++) {
    const at = new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
    db.run('INSERT INTO notes VALUES(?,?,?,?,?,?,?)', 'chefe/a_' + n + '.md', f.bot.id, 'chefe', String(n), 'Texto', at, at);
  }
  const { notes } = await f.call('shared_note_read', { list: true, prefix: 'chefe/a_' });
  assert.deepEqual(notes.map(note => note.title), Array.from({ length: 100 }, (_, n) => String(101 - n)));
  assert.ok(notes.every(note => !('body' in note)));
  assert.deepEqual((await f.call('shared_note_read', { list: true, prefix: 'arquivo/' })).notes, []);
});

test('chief index and overwrites keep previous versions', async t => {
  const f = session(t, database(t), 'Lua', true);
  f.grant('shared.index_read'); f.grant('shared.note_write'); f.grant('shared.note_read');
  assert.equal((await f.call('shared_index_read')).body, '');
  const path = 'chefe/index.md';
  await f.call('shared_note_write', { path, text: 'Primeira' });
  await assert.rejects(f.call('shared_note_write', { path, text: 'Outra' }), /overwrite/);
  const { history } = await f.call('shared_note_write', { path, text: 'Segunda', overwrite: true });
  assert.match(history, /^arquivo\/historico\/chefe\/index-/);
  assert.equal((await f.call('shared_note_read', { path: history })).body, 'Primeira');
  assert.equal((await f.call('shared_index_read')).body, 'Segunda');
});

test('secrets rejected before persistence in deliveries, notes and summaries', async t => {
  const db = database(t);
  const f = session(t, db, 'Lua', true);
  f.grant('shared.note_write'); f.grant('shared.archive');
  for (const text of ['sk-1234567890','ghp_1234567890','AKIA1234567890ABCDEF','password: privado','senha: segredo','token: valor']) {
    await assert.rejects(f.call('delivery_write', { topic: 'Teste', text }), /senha, chave ou token/);
    await assert.rejects(f.call('shared_note_write', { path: 'chefe/teste.md', text }), /senha, chave ou token/);
  }
  assert.deepEqual(db.all('SELECT * FROM notes'), []);
  const { path } = await f.call('delivery_write', { topic: 'Teste', text: 'Texto original' });
  await assert.rejects(f.call('shared_archive', { path, summary: 'token: escondido' }), /senha, chave ou token/);
  assert.equal(db.all('SELECT path FROM notes')[0].path, path);
});

test('archiving preserves content and propagates the move between two databases', async t => {
  const local = database(t), peer = database(t);
  const f = session(t, local, 'Lua', true);
  const { path } = await f.call('delivery_write', { topic: 'Projeto', text: 'Resultado [[chefe/site]]' });
  peer.applyChanges(local.changesSince().changes);
  const read = (db, key) => db.get('SELECT * FROM notes WHERE path=?', key);
  const original = read(local, path);
  assert.deepEqual(read(peer, path), original);
  const cursor = local.syncState().counter;
  f.grant('shared.archive');
  const archived = await f.call('shared_archive', { path, summary: 'Aprovado' });
  peer.applyChanges(local.changesSince(cursor).changes);
  assert.equal(read(peer, path), undefined);
  const copy = read(peer, archived.path);
  assert.deepEqual(copy, read(local, archived.path));
  assert.equal(copy.body, original.body + '\n\nResumo: Aprovado');
  assert.equal(copy.bot_id, original.bot_id);
  assert.equal(copy.created_at, original.created_at);
  assert.equal(copy.kind, 'arquivo');
});

test('backup round trip, invalid notes and old backups', async t => {
  const db = database(t), restored = database(t);
  const f = session(t, db);
  await f.call('delivery_write', { topic: 'Projeto', text: 'Resultado' });
  const snapshot = JSON.parse(readFileSync(db.backup().path, 'utf8'));
  restored.restore(snapshot);
  const [note] = snapshot.toolsState.notes;
  for (const notes of [[{ ...note, path: '../x' }], [{ ...note, kind: 'chefe' }], [note, note], Array(20001).fill(note)]) {
    assert.throws(() => restored.restore({ ...snapshot, toolsState: { ...snapshot.toolsState, notes } }));
  }
  delete snapshot.toolsState.notes;
  restored.restore(snapshot);
  assert.deepEqual(Array.from(restored.snapshot().toolsState.notes, row => ({ ...row })), [note]);
});

test('migration from schema 14 keeps existing data and registers notes exactly once', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-notes-migration-'));
  let db = new Database(dir);
  t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const bot = db.create({ name: 'Lua' }, selection);
  db.db.exec('DROP TABLE notes; PRAGMA user_version=14');
  db.close(); db = new Database(dir);
  assert.equal(db.bot(bot.id).name, 'Lua');
  const at = new Date().toISOString();
  db.run('INSERT INTO notes VALUES(?,?,?,?,?,?,?)', 'chefe/index.md', bot.id, 'chefe', 'Índice', 'Projeto', at, at);
  const before = db.changesSince();
  db.db.exec('PRAGMA user_version=14');
  db.close(); db = new Database(dir);
  assert.equal(db.get('PRAGMA user_version').user_version, SCHEMA);
  assert.deepEqual(db.changesSince(), before);
  assert.equal(before.changes.filter(row => row.table === 'notes').length, 1);
});
