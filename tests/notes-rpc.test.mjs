import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from '../supervisor/database.mjs';
import { notesRpc, noteMethods, saveNote } from '../supervisor/notes.mjs';
import { DESKTOP_METHODS, Link } from '../supervisor/link.mjs';
import { MCP_TOOLS, MCP_NAMES } from '../supervisor/mcp/catalog.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';

function database(t) {
  const directory = mkdtempSync(join(tmpdir(), 'mybots-person-notes-'));
  const db = new Database(directory);
  t.after(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });
  return db;
}
const path = 'chefe/projeto.md';
const write = (db, path, text, create = true) => notesRpc(db, 'notes.write', { path, text, create });
const read = (db, path) => notesRpc(db, 'notes.read', { path });

test('the person RPC rejects invalid fields and paths on the supervisor and desktop relay; bot catalogs exclude it', async t => {
  const db = database(t);
  const relay = { rpc: (method, params) => notesRpc(db, method, params) };
  const frames = [];
  db.listen((event, data) => Link.prototype.event.call({ state: 'online', socket: { readyState: 1, send: frame => frames.push(JSON.parse(frame)) } }, event, data));
  for (const method of noteMethods) {
    assert.ok(DESKTOP_METHODS.includes(method));
    assert.ok(!Object.values(MCP_NAMES).includes(method));
    assert.ok(!MCP_TOOLS.some(tool => tool.name === method.replace('.', '_')));
    assert.throws(() => toolArguments(method, {}));
    assert.throws(() => notesRpc(db, method, { path, extra: true }));
  }
  for (const params of [null, [], 2, { prefix: '../' }, { prefix: 'chefe//x' }, { kind: 'entregas' }, { limit: 0 }, { limit: 101 },
    { limit: 1.2 }, { since: '2026-02-31' }, { botId: 4 }, { cursor: 'x' }, { cursor: '2026-01-01|../x' }]) {
    assert.throws(() => notesRpc(db, 'notes.list', params));
    assert.ok((await Link.prototype.desktop.call(relay, { method: 'notes.list', params })).error);
  }
  for (const p of ['chefe/../fora.md', '/chefe/a.md', 'pessoa.md', 'chefe/a', 4, 'chefe/' + 'x'.repeat(120) + '.md'])
    assert.throws(() => read(db, p), /Caminho/);
  for (const query of ['', null, ' ', 'á'.repeat(201)]) assert.throws(() => notesRpc(db, 'notes.search', { query }));
  for (const text of [null, 4, 'x'.repeat(8001)]) assert.throws(() => write(db, path, text), /8000/);
  assert.throws(() => write(db, path, 'texto', 'sim'), /criação/);
  assert.throws(() => write(db, 'arquivo/nova.md', 'texto'), /editar/);
  assert.throws(() => write(db, path, 'texto', false), /encontrada/);
  const response = await Link.prototype.desktop.call(relay, { method: 'notes.write', params: { path, text: 'texto', create: true } });
  assert.equal(response.result.path, path);
  assert.deepEqual(frames.find(frame => frame.event === 'notes.changed'), { type: 'event', event: 'notes.changed', data: { path } });
  assert.throws(() => write(db, path, 'duplicada'), /existe/);
});

test('filters, stable pages, normalized edges and accent-insensitive search snippets', t => {
  const db = database(t);
  const bot = db.create({ name: 'Sol' }, { model: 'test', reasoningEffort: 'low' });
  const at = '2026-11-01T12:00:00.000Z', old = '2025-01-01T00:00:00.000Z';
  const delivery = 'entregas/revisao.md';
  function add(p, title, body, date, botId = null) {
    saveNote(db, { path: p, bot_id: botId, kind: p.startsWith('entregas/') ? 'entrega' : 'chefe', title, body, created_at: date, updated_at: date });
  }
  add(path, 'Decisões', 'x'.repeat(150) + ' Ac\u0327a\u0303o [[entregas/revisao]] [[ausente]]', at);
  add(delivery, 'Revisão', 'Sobre [[projeto]] e [[chefe/projeto.md]].', at, bot.id);
  add('chefe/isolada.md', 'Outra', 'Avulsa', old);
  const page = notesRpc(db, 'notes.list', { limit: 1 });
  assert.equal(page.notes[0].path, path);
  assert.equal(page.notes[0].body, undefined);
  assert.ok(page.notes[0].snippet.length <= 140);
  assert.deepEqual(page.notes[0].incomingPaths, [delivery]);
  assert.deepEqual(page.notes[0].outgoingPaths, [delivery, 'chefe/ausente.md']);
  const next = notesRpc(db, 'notes.list', { cursor: page.nextCursor });
  assert.deepEqual(next.notes.map(n => n.path), [delivery, 'chefe/isolada.md']);
  assert.equal(next.nextCursor, null);
  assert.equal(next.notes[1].outgoingCount + next.notes[1].incomingCount, 0);
  assert.equal(notesRpc(db, 'notes.list', { since: at }).notes.length, 2);
  assert.equal(notesRpc(db, 'notes.list', { prefix: 'chefe/', since: at }).notes.length, 1);
  const filtered = notesRpc(db, 'notes.list', { kind: 'entrega', botId: bot.id }).notes;
  assert.deepEqual(filtered.map(n => [n.title, n.botName, n.botId]), [['Revisão', 'Sol', bot.id]]);
  const note = read(db, path);
  assert.deepEqual(note.links.map(n => [n.path, n.exists]), [[delivery, true], ['chefe/ausente.md', false]]);
  assert.deepEqual(note.backlinks, [{ path: delivery, title: 'Revisão', kind: 'entrega', botId: bot.id, snippet: read(db, delivery).body }]);
  const match = notesRpc(db, 'notes.search', { query: 'ACAO' }).notes[0];
  assert.equal(match.snippet.slice(...match.snippetMatch).normalize('NFC'), 'Ação');
  assert.ok(match.snippet.length <= 140);
  assert.deepEqual(notesRpc(db, 'notes.search', { query: 'decisoes' }).notes[0].titleMatch, [0, 8]);
  assert.deepEqual(notesRpc(db, 'notes.search', { query: 'decisoes', botId: bot.id }).notes, []);
});

test('person writes retain authorship, history and backups; edits, moves and removals reach a second database', t => {
  const db = database(t), peer = database(t), events = [], peerEvents = [];
  const bot = db.create({ name: 'Lua' }, { model: 'test', reasoningEffort: 'low' });
  const at = '2026-01-01T00:00:00.000Z', delivery = 'entregas/entrega.md';
  saveNote(db, { path: delivery, title: 'Entrega', kind: 'entrega', bot_id: bot.id, body: 'Antes', created_at: at, updated_at: at });
  const sync = () => peer.applyChanges(db.changesSince().changes);
  sync();
  db.listen((event, data) => events.push([event, data.path]));
  peer.listen((event, data) => { if (event === 'notes.changed') peerEvents.push(data.path); });
  assert.throws(() => write(db, delivery, 'senha: segredo', false), /possível senha/);
  assert.equal(events.length, 0);
  const { history } = write(db, delivery, 'Depois', false);
  assert.ok(history.startsWith('arquivo/historico/entregas/entrega-'));
  assert.deepEqual(events.filter(e => e[0] === 'notes.changed').map(e => e[1]), [history, delivery]);
  assert.equal(read(db, history).body, 'Antes');
  sync();
  assert.ok(peerEvents.includes(delivery));
  assert.deepEqual(read(peer, delivery), read(db, delivery));
  assert.equal(read(peer, delivery).botId, bot.id);
  assert.equal(read(peer, delivery).createdAt, at);
  assert.equal(read(peer, delivery).body, 'Depois');
  assert.ok(db.snapshot().toolsState.notes.some(n => n.path === history && n.body === 'Antes'));
  assert.throws(() => notesRpc(db, 'notes.remove', { path: delivery, confirm: true }), /Arquive/);
  write(db, path, 'Sem perda');
  const moved = notesRpc(db, 'notes.archive', { path, summary: 'Resumo da pessoa' }).path;
  assert.throws(() => read(db, path), /encontrada/);
  assert.equal(read(db, moved).body, 'Sem perda\n\nResumo: Resumo da pessoa');
  assert.throws(() => notesRpc(db, 'notes.archive', { path: moved }), /já está/);
  assert.throws(() => notesRpc(db, 'notes.archive', { path: delivery, summary: 4 }));
  const other = notesRpc(db, 'notes.archive', { path: delivery }).path;
  sync();
  assert.equal(read(peer, other).body, 'Depois');
  assert.throws(() => read(peer, delivery), /encontrada/);
  for (const confirm of [undefined, false, 1, 'true']) assert.throws(() => notesRpc(db, 'notes.remove', { path: moved, confirm }), /Confirme/);
  notesRpc(db, 'notes.remove', { path: moved, confirm: true });
  sync();
  assert.throws(() => read(peer, moved), /encontrada/);
  assert.ok(db.get("SELECT 1 FROM activity WHERE kind='note_removed' AND detail LIKE ?", '%' + moved));
});

test('notes.graph returns lean nodes, existing and broken edges, honours filters and truncates newest plus most linked', t => {
  const db = database(t);
  const bot = db.create({ name: 'Sol' }, { model: 'test', reasoningEffort: 'low' });
  const add = (p, body, date, botId = null) => saveNote(db, { path: p, bot_id: botId, kind: p.startsWith('entregas/') ? 'entrega' : p.startsWith('arquivo/') ? 'arquivo' : 'chefe',
    title: p.split('/').at(-1).slice(0, -3), body, created_at: date, updated_at: date });
  for (const params of [null, [], { limit: 0 }, { limit: 501 }, { limit: 2.5 }, { kind: 'pessoa' }, { botId: 'x' }, { since: '2026-13-01' },
    { query: 'x' }, { prefix: 'chefe/' }, { cursor: 'x' }, { path: 'chefe/a.md' }]) assert.throws(() => notesRpc(db, 'notes.graph', params), String(JSON.stringify(params)));
  assert.deepEqual(notesRpc(db, 'notes.graph', {}), { nodes: [], edges: [], truncated: false });
  add('chefe/hub.md', '[[a]] [[b]] [[entregas/feita]] [[sumida]]', '2026-01-01T00:00:00.000Z');
  add('chefe/a.md', '[[hub]]', '2026-02-01T00:00:00.000Z');
  add('chefe/b.md', 'sem links', '2026-03-01T00:00:00.000Z');
  add('entregas/feita.md', '[[hub]] [[falta]]', '2026-04-01T00:00:00.000Z', bot.id);
  add('chefe/orfa.md', 'sozinha', '2026-05-01T00:00:00.000Z');
  const all = notesRpc(db, 'notes.graph', { limit: 500 });
  assert.equal(all.truncated, false);
  assert.deepEqual(all.nodes.map(n => n.path), ['chefe/orfa.md', 'entregas/feita.md', 'chefe/b.md', 'chefe/a.md', 'chefe/hub.md']);
  for (const node of all.nodes) assert.deepEqual(Object.keys(node).sort(), ['botId', 'botName', 'incomingCount', 'kind', 'outgoingCount', 'path', 'title', 'updatedAt']);
  assert.deepEqual(all.nodes[1], { path: 'entregas/feita.md', title: 'feita', kind: 'entrega', botId: bot.id, botName: 'Sol', updatedAt: '2026-04-01T00:00:00.000Z', outgoingCount: 2, incomingCount: 1 });
  const key = e => e.from + '>' + e.to + ':' + e.exists;
  assert.deepEqual(all.edges.map(key).sort(), ['chefe/a.md>chefe/hub.md:true', 'chefe/hub.md>chefe/a.md:true', 'chefe/hub.md>chefe/b.md:true',
    'chefe/hub.md>chefe/sumida.md:false', 'chefe/hub.md>entregas/feita.md:true', 'entregas/feita.md>chefe/falta.md:false', 'entregas/feita.md>chefe/hub.md:true']);
  for (const edge of all.edges) assert.deepEqual(Object.keys(edge), edge.exists ? ['from', 'to', 'exists'] : ['from', 'to', 'exists', 'title']);
  assert.equal(all.edges.find(e => e.to === 'chefe/sumida.md').title, 'sumida');
  // Filters: edges only between included notes, plus broken targets of included notes; filtered-out real targets disappear.
  const chefe = notesRpc(db, 'notes.graph', { kind: 'chefe' });
  assert.ok(!chefe.nodes.some(n => n.kind !== 'chefe'));
  assert.deepEqual(chefe.edges.map(key).sort(), ['chefe/a.md>chefe/hub.md:true', 'chefe/hub.md>chefe/a.md:true', 'chefe/hub.md>chefe/b.md:true', 'chefe/hub.md>chefe/sumida.md:false']);
  const mine = notesRpc(db, 'notes.graph', { botId: bot.id });
  assert.deepEqual(mine.nodes.map(n => n.path), ['entregas/feita.md']);
  assert.deepEqual(mine.edges.map(key), ['entregas/feita.md>chefe/falta.md:false']);
  assert.deepEqual(notesRpc(db, 'notes.graph', { since: '2026-03-15' }).nodes.map(n => n.path), ['chefe/orfa.md', 'entregas/feita.md']);
  // Over the limit: the newest half, then the most linked (the old hub survives, the quiet old notes go).
  const cut = notesRpc(db, 'notes.graph', { limit: 2 });
  assert.equal(cut.truncated, true);
  assert.deepEqual(cut.nodes.map(n => n.path), ['chefe/orfa.md', 'chefe/hub.md']);
  assert.deepEqual(cut.edges.map(key), ['chefe/hub.md>chefe/sumida.md:false']);
  for (let i = 0; i < 520; i++) add(`arquivo/velha-${i}.md`, i % 2 ? '[[orfa]]' : 'nada', new Date(Date.UTC(2025, 0, 1, 0, i)).toISOString());
  const big = notesRpc(db, 'notes.graph', {});
  assert.equal(big.nodes.length, 500);
  assert.equal(big.truncated, true);
  assert.ok(big.nodes.some(n => n.path === 'chefe/hub.md'));
});

test('links are resolved like Obsidian: names with spaces and accents, aliases, headings, titles and file names', t => {
  const db = database(t);
  const at = '2026-11-07T15:53:00.000Z';
  const add = (p, title, body, date = at) => saveNote(db, { path: p, bot_id: null, kind: p.startsWith('entregas/') ? 'entrega' : p.startsWith('arquivo/') ? 'arquivo' : 'chefe', title, body, created_at: date, updated_at: date });
  add('chefe/central-de-vagas.md', 'central-de-vagas', 'Painel.');
  add('entregas/2026-11-07-1553-rastreadorrh-rastreamento.md', 'Rastreamento de candidaturas — 07/11/2026',
    'Publicado em [[Central de Vagas]]. Projeto: [[Candidaturas Augusto]]. [[Candidaturas LinkedIn 06/11/2026]] [[central de vagas|o painel]] [[Rastreamento de Candidaturas — 07/11/2026#Gupy]]');
  add('entregas/outra.md', 'Outra', 'Ver [[Candidaturas Augusto]] e [[rastreamento de candidaturas 07/11/2026]].');
  add('arquivo/historico/central.md', 'Central de Vagas', 'versão velha');
  const note = read(db, 'entregas/2026-11-07-1553-rastreadorrh-rastreamento.md');
  assert.deepEqual(note.links.map(l => [l.path, l.exists, l.title]), [
    ['chefe/central-de-vagas.md', true, 'central-de-vagas'],
    ['chefe/candidaturas-augusto.md', false, 'Candidaturas Augusto'],
    ['chefe/candidaturas-linkedin-06-11-2026.md', false, 'Candidaturas LinkedIn 06/11/2026'],
    ['entregas/2026-11-07-1553-rastreadorrh-rastreamento.md', true, 'Rastreamento de candidaturas — 07/11/2026']]);
  assert.deepEqual(note.links[0].names, ['Central de Vagas', 'central de vagas']);
  assert.deepEqual(read(db, 'chefe/central-de-vagas.md').backlinks.map(b => b.path), ['entregas/2026-11-07-1553-rastreadorrh-rastreamento.md']);
  const graph = notesRpc(db, 'notes.graph', {});
  // Two notes pointing at the same missing note meet on one ghost.
  assert.deepEqual(graph.edges.filter(e => e.to === 'chefe/candidaturas-augusto.md').map(e => [e.from, e.title]).sort(),
    [['entregas/2026-11-07-1553-rastreadorrh-rastreamento.md', 'Candidaturas Augusto'], ['entregas/outra.md', 'Candidaturas Augusto']]);
  assert.ok(graph.edges.some(e => e.from === 'entregas/outra.md' && e.to === 'entregas/2026-11-07-1553-rastreadorrh-rastreamento.md' && e.exists));
  assert.equal(graph.nodes.find(n => n.path === 'chefe/central-de-vagas.md').incomingCount, 1);
  // Backlinks quote the line that holds the link; summaries skip the "Bot: / Data:" header of deliveries.
  add('entregas/entrega.md', 'Entrega', 'Bot: Atlas\nData: 2026-11-07T15:00:00Z\nAssunto: x\n\nPrimeira linha.\nVer o [[Central de Vagas|painel]] hoje.', '2026-11-08T00:00:00.000Z');
  assert.equal(read(db, 'chefe/central-de-vagas.md').backlinks.find(b => b.path === 'entregas/entrega.md').snippet, 'Ver o [[Central de Vagas|painel]] hoje.');
  assert.equal(notesRpc(db, 'notes.list', { kind: 'entrega', limit: 1 }).notes[0].snippet, 'Primeira linha.\nVer o [[Central de Vagas|painel]] hoje.', '2026-11-08T00:00:00.000Z');
});
