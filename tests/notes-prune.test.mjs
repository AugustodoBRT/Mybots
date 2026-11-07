import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../supervisor/database.mjs';
import { createSupervisor } from '../supervisor/index.mjs';
import { notesRpc, noteTool, pruneNotes, saveNote, PRUNE } from '../supervisor/notes.mjs';

const DAY = 86400000, NOW = Date.parse('2026-11-07T12:00:00Z');
function database(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mybots-prune-'));
  const db = new Database(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  return db;
}
// A delivery written `daysAgo` days before NOW, with the path delivery_write would give it.
function delivery(db, bot, daysAgo, topic, text = 'Feito.') {
  const at = new Date(NOW - daysAgo * DAY).toISOString(), stamp = at.slice(0, 10) + '-' + at.slice(11, 16).replace(':', '');
  const path = `entregas/${stamp}-${bot.name.toLowerCase()}-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
  saveNote(db, { path, bot_id: bot.id, kind: 'entrega', title: topic, body: `Bot: ${bot.name}\nData: ${at}\nAssunto: ${topic}\n\n${text}`, created_at: at, updated_at: at });
  return path;
}
const paths = (db, prefix) => db.all('SELECT path FROM notes WHERE instr(path,?)=1 ORDER BY path', prefix).map(row => row.path);

test('old deliveries move to the archive intact, the newest stay, each month gets a summary and links keep working', t => {
  const db = database(t);
  const bot = db.create({ name: 'Sol' }, { model: 'test', reasoningEffort: 'low' });
  const old = [delivery(db, bot, 60, 'Busca de outubro', 'Achei [[Central de Vagas]] com 3 vagas.\nSegunda linha.'), delivery(db, bot, 45, 'Relatório antigo')];
  const recent = [];
  for (let i = 0; i < PRUNE.keep - 1; i++) recent.push(delivery(db, bot, 31 + i / 100, 'Rotina ' + i));
  const fresh = delivery(db, bot, 2, 'Hoje');
  saveNote(db, { path: 'chefe/central-de-vagas.md', bot_id: null, kind: 'chefe', title: 'Central de Vagas', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
    body: `Painel. Fonte: [[${old[0].slice(0, -3)}]] e [[Relatório antigo]].` });
  const before = db.get('SELECT body FROM notes WHERE path=?', old[0]).body;

  const result = pruneNotes(db, { now: NOW });
  // 32 deliveries: the 30 newest stay even past 30 days, the two oldest go.
  assert.equal(result.archived, 2);
  assert.deepEqual(result.months, ['2026-09']);
  assert.deepEqual(paths(db, 'entregas/').sort(), [...recent, fresh].sort());
  const moved = old.map(path => 'arquivo/' + path.slice(9));
  for (const path of moved) assert.ok(db.get('SELECT 1 FROM notes WHERE path=? AND kind=?', path, 'arquivo'), path);
  assert.equal(db.get('SELECT body FROM notes WHERE path=?', moved[0]).body, before, 'the body is kept as it was');

  const summary = notesRpc(db, 'notes.read', { path: 'arquivo/resumos/2026-09.md' });
  assert.equal(summary.title, 'Entregas de setembro de 2026');
  assert.match(summary.body, /^# Entregas de setembro de 2026\n/);
  assert.match(summary.body, /- 08\/09 · Sol · \[\[arquivo\/2026-09-08-1200-sol-busca-de-outubro\|Busca de outubro\]\] — Achei Central de Vagas com 3 vagas\./);
  assert.match(summary.body, /Relatório antigo/);
  assert.deepEqual(summary.links.map(link => link.exists), [true, true]);

  // Links by path and by title both land on the archived copy; a bot asking for the old path is told where it went.
  const hub = notesRpc(db, 'notes.read', { path: 'chefe/central-de-vagas.md' });
  assert.deepEqual(hub.links.map(link => [link.path, link.exists]), [[moved[0], true], [moved[1], true]]);
  const asked = noteTool(db, bot, 'shared.note_read', { path: old[0] });
  assert.equal(asked.path, moved[0]);
  assert.equal(asked.movedFrom, old[0]);
  assert.throws(() => noteTool(db, bot, 'shared.note_read', { path: 'entregas/nunca-existiu.md' }), /não encontrada/);

  assert.match(db.all('SELECT detail FROM activity WHERE kind=?', 'notes_pruned')[0].detail, /2 entregas antigas foram para o arquivo/);
  // Running again finds nothing to do and changes nothing.
  const stamp = db.get('SELECT updated_at FROM notes WHERE path=?', 'arquivo/resumos/2026-09.md').updated_at;
  assert.deepEqual(pruneNotes(db, { now: NOW + 3600000 }), { archived: 0, months: [] });
  assert.equal(db.get('SELECT updated_at FROM notes WHERE path=?', 'arquivo/resumos/2026-09.md').updated_at, stamp);
});

test('the index drops only lines that pointed solely at archived deliveries, keeps history and lists the latest months', t => {
  const db = database(t);
  const bot = db.create({ name: 'Lua' }, { model: 'test', reasoningEffort: 'low' });
  const months = [];
  for (let m = 0; m < 8; m++) months.push(delivery(db, bot, 40 + m * 31, 'Mês ' + m));
  for (let i = 0; i < PRUNE.keep; i++) delivery(db, bot, i / 10, 'Nova ' + i);
  const index = ['# Índice', '', '## Projetos', '- [[Central de Vagas]]', '', '## Últimas entregas',
    `- [[${months[0].slice(0, -3)}]]`, `- [[Mês 1]] e [[Central de Vagas]]`, `- [[Mês 2|apelido]]`, 'Texto solto sobre [[Mês 3]].', ''].join('\n');
  saveNote(db, { path: 'chefe/index.md', bot_id: null, kind: 'chefe', title: 'index', body: index, created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });

  assert.equal(pruneNotes(db, { now: NOW }).archived, 8);
  const body = db.get('SELECT body FROM notes WHERE path=?', 'chefe/index.md').body;
  assert.ok(body.includes('- [[Central de Vagas]]'));
  assert.ok(!body.includes(months[0].slice(0, -3)), 'a line with only archived links goes');
  assert.ok(!body.includes('[[Mês 2|apelido]]'));
  assert.ok(body.includes('- [[Mês 1]] e [[Central de Vagas]]'), 'a line that also links a living note stays');
  assert.ok(body.includes('Texto solto sobre [[Mês 3]].'), 'plain paragraphs are never touched');
  const section = body.split('## Arquivo\n')[1];
  const listed = [...section.matchAll(/arquivo\/resumos\/(\d{4}-\d\d)\|Entregas de ([^\]]+)\]\]/g)].map(match => match[1]);
  assert.equal(listed.length, PRUNE.months);
  assert.deepEqual(listed, [...listed].sort().reverse());
  assert.equal(listed[0], new Date(NOW - 40 * DAY).toISOString().slice(0, 7));
  assert.match(section, /Entregas de setembro de 2026/);
  // The version the Chief wrote is kept in the history.
  const history = paths(db, 'arquivo/historico/chefe/index');
  assert.equal(history.length, 1);
  assert.equal(db.get('SELECT body FROM notes WHERE path=?', history[0]).body, index);
  assert.equal(paths(db, 'arquivo/resumos/').length, 8);
  // A second round with a new old delivery reuses the section instead of adding another.
  delivery(db, bot, 39, 'Mais uma');
  for (let i = 0; i < 1; i++) delivery(db, bot, 0.01, 'Recente extra');
  pruneNotes(db, { now: NOW + DAY });
  const again = db.get('SELECT body FROM notes WHERE path=?', 'chefe/index.md').body;
  assert.equal(again.match(/## Arquivo/g).length, 1);
  assert.equal([...again.matchAll(/arquivo\/resumos\//g)].length, PRUNE.months);
});

test('a busy month is split into linked summary parts under the note size limit', t => {
  const db = database(t);
  const bot = db.create({ name: 'Nico' }, { model: 'test', reasoningEffort: 'low' });
  const long = 'Uma linha bem comprida que descreve o que foi feito na rotina de hoje com bastante detalhe.';
  for (let i = 0; i < 160; i++) delivery(db, bot, 70 + i / 200, 'Rotina com um assunto de tamanho razoável ' + i, long);
  for (let i = 0; i < PRUNE.keep; i++) delivery(db, bot, i / 10, 'Nova ' + i);
  assert.equal(pruneNotes(db, { now: NOW }).archived, 160);
  const parts = paths(db, 'arquivo/resumos/');
  assert.ok(parts.length >= 2, parts.join());
  for (const path of parts) assert.ok(db.get('SELECT length(body) AS n FROM notes WHERE path=?', path).n <= 8000);
  const first = notesRpc(db, 'notes.read', { path: 'arquivo/resumos/2026-08.md' });
  assert.match(first.body, /Continua em \[\[arquivo\/resumos\/2026-08-parte-2\|Entregas de agosto de 2026 \(parte 2\)\]\]/);
  const lines = parts.flatMap(path => db.get('SELECT body FROM notes WHERE path=?', path).body.split('\n').filter(line => line.startsWith('- ')));
  assert.equal(lines.length, 160);
});

test('the Chief cannot grow the index past the limit, the person can, and prune runs over RPC and at startup', async t => {
  const db = database(t);
  const chief = db.create({ name: 'Chefe' }, { model: 'test', reasoningEffort: 'low' });
  assert.throws(() => noteTool(db, chief, 'shared.note_write', { path: 'chefe/index.md', text: 'x'.repeat(PRUNE.indexLimit + 1) }), /até 4000 caracteres/);
  noteTool(db, chief, 'shared.note_write', { path: 'chefe/index.md', text: 'x'.repeat(PRUNE.indexLimit) });
  noteTool(db, chief, 'shared.note_write', { path: 'chefe/outra.md', text: 'x'.repeat(6000) });
  notesRpc(db, 'notes.write', { path: 'chefe/index.md', text: 'y'.repeat(6000) });
  assert.throws(() => notesRpc(db, 'notes.prune', { now: 1 }));
  assert.deepEqual(notesRpc(db, 'notes.prune', {}), { archived: 0, months: [] });

  // At startup the supervisor tidies by itself (the clock decides what is old).
  const directory = mkdtempSync(join(tmpdir(), 'mybots-prune-sup-'));
  let second;
  t.after(async () => { await second?.close(); rmSync(directory, { recursive: true, force: true }); });
  const selection = { model: 'test', reasoningEffort: 'low' };
  const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }], limits: async () => ({ windows: [] }) };
  const first = await createSupervisor({ directory, port: 0, codex, clock: () => NOW, execute: async () => ({ text: 'Pronto.', ...selection }) });
  const bot = await first.rpc('bot.create', { name: 'Sol', instructions: 'Bot.', face: { seed: 'x' }, ...selection });
  const old = delivery(first.db, { ...bot, name: 'Sol' }, 90, 'Velha');
  for (let i = 0; i < PRUNE.keep; i++) delivery(first.db, { ...bot, name: 'Sol' }, i / 10, 'Nova ' + i);
  await first.close();
  second = await createSupervisor({ directory, port: 0, codex, clock: () => NOW, execute: async () => ({ text: 'Pronto.', ...selection }) });
  assert.ok(!second.db.get('SELECT 1 FROM notes WHERE path=?', old));
  assert.ok(second.db.get('SELECT 1 FROM notes WHERE path=?', 'arquivo/' + old.slice(9)));
  assert.deepEqual(await second.rpc('notes.prune', {}), { archived: 0, months: [] });
});
