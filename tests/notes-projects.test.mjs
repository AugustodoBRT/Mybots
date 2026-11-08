import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../supervisor/database.mjs';
import { notesRpc, noteTool, saveNote, linkProjects, aliasesOf, PROJECTS } from '../supervisor/notes.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
function database(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mybots-projects-'));
  const db = new Database(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  return db;
}
let minute = 0;
// A delivery as delivery_write left it before projects existed, one minute after the previous one.
function delivery(db, bot, topic, text) {
  const at = new Date(Date.parse('2026-11-07T16:00:00Z') + minute++ * 60000).toISOString();
  const path = `entregas/${at.slice(0, 10)}-${at.slice(11, 16).replace(':', '')}-${bot.name.toLowerCase()}-${topic.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.md`;
  saveNote(db, { path, bot_id: bot.id, kind: 'entrega', title: topic, body: `Bot: ${bot.name}\nData: ${at}\nAssunto: ${topic}\n\n${text}`, created_at: at, updated_at: at });
  return path;
}
const graph = db => notesRpc(db, 'notes.graph', {});
const ghosts = db => [...new Set(graph(db).edges.filter(edge => !edge.exists).map(edge => edge.title))].sort();

test('a delivery that names its project creates the project note, lists itself there and later spellings join it', t => {
  const db = database(t);
  const bot = db.create({ name: 'Engajamento' }, selection);
  const first = noteTool(db, bot, 'delivery.write', { topic: 'Coleta do post 1', text: 'Coletei 61 curtidas.', project: 'Engajamento CommitJR' });
  assert.equal(first.project, 'Engajamento CommitJR'); assert.equal(first.projectPath, PROJECTS + 'engajamento-commitjr.md');
  const project = () => db.get('SELECT * FROM notes WHERE path=?', first.projectPath);
  assert.equal(project().kind, 'chefe'); assert.equal(project().bot_id, bot.id);
  assert.match(db.get('SELECT body FROM notes WHERE path=?', first.path).body, /^Projeto: \[\[chefe\/projetos\/engajamento-commitjr\|Engajamento CommitJR\]\]$/m);
  assert.match(project().body, /## Entregas\n\n- \d\d\/\d\d · Engajamento · \[\[entregas\/.*\|Coleta do post 1\]\]/);
  // Another spelling of the same bot's project: the same note, which learns the name as an alias.
  const second = noteTool(db, bot, 'delivery.write', { topic: 'Coleta do post 2', text: 'Feito.', project: 'Engajamento Commit Júnior' });
  assert.equal(second.projectPath, first.projectPath); assert.match(second.message, /Projetos deste bot: Engajamento CommitJR/);
  assert.deepEqual(aliasesOf(project().body), ['Engajamento Commit Júnior']);
  assert.equal((project().body.match(/^- /gm) || []).length, 2, 'both deliveries are listed');
  // A [[link]] by an alias also counts, and the Chief's text above the list stays.
  db.run('UPDATE notes SET body=? WHERE path=?', project().body.replace('## Entregas', 'Meta: 10 posts por mês.\n\n## Entregas'), first.projectPath);
  noteTool(db, bot, 'delivery.write', { topic: 'Gráfico', text: 'Um ponto por post. [[Engajamento Commit Júnior]]' });
  assert.match(project().body, /Meta: 10 posts por mês\./); assert.equal((project().body.match(/^- /gm) || []).length, 3);
  assert.deepEqual(ghosts(db), []);
  // Another bot's project with a close name stays apart; the same name is the same project.
  const other = db.create({ name: 'Outro' }, selection);
  assert.notEqual(noteTool(db, other, 'delivery.write', { topic: 'x', text: 'y', project: 'Engajamento Commit LinkedIn' }).projectPath, first.projectPath);
  assert.equal(noteTool(db, other, 'delivery.write', { topic: 'x', text: 'y', project: 'projeto engajamento commitjr' }).projectPath, first.projectPath);
});

test('deliveries already written: a project linked by 3 or more becomes a note with the other spellings as aliases; decisions stay links', t => {
  const db = database(t);
  const bot = db.create({ name: 'Engajamento' }, selection), routine = db.create({ name: 'Maniaco' }, selection);
  delivery(db, bot, 'Teste 1', 'Pedido: testar o post para [[Engajamento CommitJR]].\nDecisão: esperar em [[Agendamento semanal após validação]].');
  delivery(db, bot, 'Teste 2', 'Pedido: revisar [[Engajamento CommitJR]]. [[Agendamento semanal após validação]].');
  delivery(db, bot, 'Conferência', 'Projeto: [[Engajamento Commit Júnior]]\nDecisão: [[Coletar e gerar build de um post por vez]]');
  delivery(db, bot, 'Gráfico', 'Decisão: espaçar por publicação. [[Engajamento Commit]] [[um ponto por post]]');
  delivery(db, bot, 'Rotina', 'Mantida a regra. [[Projeto Engajamento CommitJR]] [[Decisão janela semanal de 7 dias]]');
  for (let i = 0; i < 3; i++) delivery(db, routine, 'Prazos ' + i, 'Decisão: não cobrar. [[Cobrança do SIGAA]] [[Cobrar só o que vence hoje]]');
  delivery(db, bot, 'Avulsa', '[[Busca única]]'); delivery(db, bot, 'Avulsa 2', '[[Busca única]]');

  assert.deepEqual(linkProjects(db), { created: 2, aliased: 0 });
  const hub = db.get('SELECT * FROM notes WHERE path=?', PROJECTS + 'engajamento-commitjr.md');
  assert.equal(hub.title, 'Engajamento CommitJR');
  assert.deepEqual(aliasesOf(hub.body).sort(), ['Engajamento Commit', 'Engajamento Commit Júnior', 'Projeto Engajamento CommitJR']);
  assert.equal((hub.body.match(/^- /gm) || []).length, 5);
  assert.ok(db.get('SELECT 1 FROM notes WHERE path=?', PROJECTS + 'cobranca-do-sigaa.md'));
  const node = graph(db).nodes.find(item => item.path === hub.path);
  assert.equal(node.incomingCount, 5, 'every spelling now points at the note');
  // The decisions, and a name used only twice, are still links to notes not written yet.
  assert.deepEqual(ghosts(db), ['Agendamento semanal após validação', 'Busca única', 'Coletar e gerar build de um post por vez', 'Cobrar só o que vence hoje',
    'Decisão janela semanal de 7 dias', 'um ponto por post'].sort());
  // Running again changes nothing; a new spelling in an old-style delivery becomes another alias.
  assert.deepEqual(linkProjects(db), { created: 0, aliased: 0 });
  delivery(db, bot, 'Mais uma', 'Para [[Engajamento CommitJR 2026]].');
  assert.deepEqual(linkProjects(db), { created: 0, aliased: 1 });
  assert.ok(aliasesOf(db.get('SELECT body FROM notes WHERE path=?', hub.path).body).includes('Engajamento CommitJR 2026'));
});

test('delivery_write accepts an optional project, and an empty one is no project', () => {
  assert.deepEqual(toolArguments('delivery.write', { topic: 'T', text: 'x', project: ' Engajamento ' }), { topic: 'T', text: 'x', project: 'Engajamento' });
  assert.deepEqual(toolArguments('delivery.write', { topic: 'T', text: 'x', project: '' }), { topic: 'T', text: 'x' });
  assert.throws(() => toolArguments('delivery.write', { topic: 'T', text: 'x', project: 'a'.repeat(81) }));
});

test('aliases in front matter, inline or as a list', () => {
  assert.deepEqual(aliasesOf('---\naliases: [A, "B c"]\ntags: x\n---\n# T'), ['A', 'B c']);
  assert.deepEqual(aliasesOf('---\naliases:\n  - Um\n  - Dois\n---\ntexto'), ['Um', 'Dois']);
  assert.deepEqual(aliasesOf('# Sem front matter\naliases: [x]'), []);
});
