import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { sessionsOf, openedLine } from '../mobile/state/sessions.js';
import { createLayout } from '../mobile/state/graph-layout.js';
import { Database } from '../supervisor/database.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };

test('sessões do Chefe: agrupa pelo campo session, a antiga é a base, o nome vem do título ou do começo da fala e a mais recente vem primeiro', () => {
  const list = sessionsOf([
    { id: '1', role: 'user', text: 'Qual a vaga de hoje?\nPreciso saber', createdAt: '2026-11-07T10:00:00Z' }, { id: '2', role: 'assistant', text: 'x', createdAt: '2026-11-07T10:01:00Z' },
    { id: '3', role: 'system', text: 'Nova sessão iniciada ao abrir o app.', session: 'S1', title: 'Vagas de hoje', createdAt: '2026-11-08T10:00:00Z' },
    { id: '4', role: 'user', text: 'y'.repeat(100), session: 'S1', createdAt: '2026-11-08T10:00:05Z' },
    { id: '5', role: 'system', text: 'Nova sessão iniciada ao abrir o app.', session: 'S2', createdAt: '2026-11-08T12:00:00Z' },
    { id: '6', role: 'user', text: 'terceira', session: 'S2', createdAt: '2026-11-08T12:00:05Z' },
    { id: '7', role: 'assistant', text: 'de volta à base', createdAt: '2026-11-08T13:00:00Z' }
  ]);
  assert.deepEqual(list.map(item => item.id), ['base', 'S2', 'S1']);
  assert.deepEqual(list.map(item => item.title), ['Qual a vaga de hoje? Preciso saber', 'terceira', 'Vagas de hoje']);
  assert.equal(openedLine({ role: 'system', text: 'Sessão retomada. A conversa continua.' }), true);
  assert.equal(openedLine({ role: 'system', text: 'Nova sessão da IA, iniciada sozinha para economizar contexto' }), false);
});

test('retomar uma sessão do Chefe devolve a sessão da IA dela e as mensagens novas ficam nela', t => {
  const dir = mkdtempSync(join(tmpdir(), 'mybots-sessions-'));
  const db = new Database(dir); t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const chief = db.create({ name: 'Lua', isChief: true }, selection);
  const say = text => db.appendMessage(chief.id, { id: randomUUID(), role: 'user', text, status: 'complete', createdAt: new Date().toISOString() });
  const [A, B, C] = [randomUUID(), randomUUID(), randomUUID()];
  say('antes das sessões'); db.session(chief.id, A);
  db.startSession(chief.id, 'Nova sessão iniciada ao abrir o app.');
  assert.equal(db.bot(chief.id).codexSessionId, undefined);
  const first = db.chatSession(chief.id); assert.ok(first);
  say('na sessão 1'); db.session(chief.id, B);
  db.startSession(chief.id, 'Nova sessão iniciada ao abrir o app.');
  const second = db.chatSession(chief.id); assert.notEqual(second, first);
  say('na sessão 2'); db.session(chief.id, C);
  const stamped = text => db.page({ botId: chief.id, limit: 50 }).messages.find(item => item.text === text).session;
  assert.equal(stamped('antes das sessões'), undefined); assert.equal(stamped('na sessão 1'), first); assert.equal(stamped('na sessão 2'), second);
  assert.equal(db.sessionTitle(chief.id, first, 'Título da um'), true);
  assert.equal(db.page({ botId: chief.id, limit: 50 }).messages.find(item => item.session === first && item.role === 'system').title, 'Título da um');
  // pick session 1: its IA session comes back and new messages belong to it
  assert.equal(db.resumeSession(chief.id, first), true);
  assert.equal(db.bot(chief.id).codexSessionId, B); assert.equal(db.chatSession(chief.id), first);
  say('continuando a um'); assert.equal(stamped('continuando a um'), first);
  assert.equal(db.resumeSession(chief.id, first), false);
  assert.equal(db.page({ botId: chief.id, limit: 50 }).messages.at(-1).text.startsWith('Sessão retomada'), true);
  // and back to session 2, then to the conversation from before sessions
  db.resumeSession(chief.id, second); assert.equal(db.bot(chief.id).codexSessionId, C);
  db.resumeSession(chief.id, 'base'); assert.equal(db.bot(chief.id).codexSessionId, A); assert.equal(db.chatSession(chief.id), null);
  assert.throws(() => db.resumeSession(chief.id, randomUUID()), /não encontrada/);
});

test('grafo com disco livre: nenhuma nota fica dentro dele, nem as arrastadas', () => {
  const nodes = Array.from({ length: 60 }, (_, i) => ({ id: 'n' + i })), edges = Array.from({ length: 59 }, (_, i) => ({ from: 'n' + i, to: 'n' + (i + 1) }));
  const layout = createLayout({ nodes, edges, options: { hole: 100 } });
  layout.run({ maxTicks: 400 });
  layout.pin('n3', 5, 5);
  for (const { x, y } of layout.nodes()) assert.ok(Math.hypot(x, y) >= 99.9 || (x === 5 && y === 5) === false);
  layout.tick();
  const pinned = layout.nodes().find(item => item.id === 'n3');
  assert.ok(Math.hypot(pinned.x, pinned.y) >= 99.9);
  for (const { x, y } of layout.nodes()) assert.ok(Math.hypot(x, y) >= 99.9);
});


test('o primeiro retorno de uma sessão do Chefe dá o nome a ela, uma vez, e a sessão nova da IA só lê as mensagens daquela sessão', async t => {
  const { Queue } = await import('../supervisor/queue.mjs');
  const { Tools } = await import('../supervisor/tools.mjs');
  const dir = mkdtempSync(join(tmpdir(), 'mybots-name-'));
  const db = new Database(dir), tools = new Tools(db); t.after(() => { db.close(); rmSync(dir, { recursive: true, force: true }); });
  const chief = db.create({ name: 'Lua', isChief: true }, selection);
  db.appendMessage(chief.id, { id: randomUUID(), role: 'user', text: 'conversa velha que não deve entrar', status: 'complete', createdAt: new Date().toISOString() });
  db.startSession(chief.id, 'Nova sessão iniciada ao abrir o app. A conversa continua.');
  const prompts = [];
  const queue = new Queue(db, async (bot, prompt) => { prompts.push(prompt); return { text: prompt.includes('Dê um título curto') ? '"Vagas de hoje".' : 'Resposta.' }; }, tools);
  try {
    db.enqueue(chief.id, randomUUID(), 'Traga as vagas de hoje, por favor', selection); await queue.pump();
    db.enqueue(chief.id, randomUUID(), 'E as de ontem?', selection); await queue.pump();
    const line = db.page({ botId: chief.id, limit: 50 }).messages.find(item => item.role === 'system');
    assert.equal(line.title, 'Vagas de hoje');
    assert.equal(prompts.filter(item => item.includes('Dê um título curto')).length, 1);
    assert.ok(!prompts.some(item => item.includes('conversa velha')));
  } finally { await queue.close(); }
});
