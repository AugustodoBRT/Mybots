import './isolate-accounts.mjs';
import test from 'node:test';
import { DESKTOP_METHODS } from '../supervisor/link.mjs';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { areaBoxes, botSpots, bounds, cord, fitView, hit, linkLine, sandboxed, teamCords, teamSpots, zoomAround, HTML_POLICY, NODE_W, NODE_H } from '../mobile/state/canvas-layout.js';

// The team's canvas (it replaced the 3D office): the bots leave cards there, link them and group them in areas; the person sees it in
// the app on the phone and on the computer.
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };

async function setup(t) {
  const events = [];
  const directory = await mkdtemp(join(tmpdir(), 'mybots-canvas-'));
  const app = await createSupervisor({ directory, port: 0, codex, approvalMs: 2000, routineTickMs: 60000, notify: async () => ({ notified: true }), execute: async bot => ({ text: `Feito por ${bot.name}.`, ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('state.get');
  const vagas = app.db.create({ name: 'Vagas', autonomy: 'local' }, selection);
  const outro = app.db.create({ name: 'Outro', autonomy: 'local' }, selection);
  const runAs = botId => {
    const task = app.db.start(app.db.enqueue(botId, randomUUID(), 'Trabalhe', selection).id); const cap = app.tools.open(task); const bridgeId = randomUUID(); app.tools.context(cap.token, bridgeId, true);
    t.after(() => { cap.close(); try { app.db.finish(task.id, 'cancelled', null, 'fim'); } catch {} });
    return (tool, args = {}) => app.tools.call(cap.token, { bridgeId, callId: randomUUID(), tool: tool.replace('_', '.'), args });
  };
  return { app, vagas, outro, runAs, events };
}

test('bots fill the canvas: notes, live tables and charts, html, links, areas, tidy and remove', async t => {
  const { app, vagas, outro, runAs } = await setup(t);
  const call = runAs(vagas.id), other = runAs(outro.id);
  await call('table_add', { table: 'candidaturas', row: { empresa: 'Acme', status: 'enviada' } });
  await call('table_add', { table: 'candidaturas', row: { empresa: 'Beta', status: 'recusada' } });
  const note = await call('canvas_add', { kind: 'note', title: 'Resumo do dia', area: 'Vagas', text: '# 2 candidaturas' });
  const table = await call('canvas_add', { kind: 'table', title: 'Candidaturas', table: 'candidaturas', area: 'Vagas' });
  const chart = await call('canvas_add', { kind: 'chart', title: 'Por status', table: 'candidaturas', by: 'status', near: table.id, label: 'resumo' });
  const page = await other('canvas_add', { kind: 'html', title: 'Calculadora', area: 'Faculdade', html: '<button onclick="x()">1</button><script>function x(){}</script>' });
  assert.equal(chart.area, 'Vagas', 'a card placed near another joins its area');
  assert.notEqual(note.x, table.x, 'cards of an area do not pile up');

  // The table and the chart follow the shared table: a new row shows up without touching the card.
  await other('table_add', { table: 'candidaturas', row: { empresa: 'Gama', status: 'enviada' } });
  const state = await app.rpc('canvas.state');
  const live = state.cards.find(card => card.id === table.id), counted = state.cards.find(card => card.id === chart.id);
  assert.deepEqual(live.columns, ['empresa', 'status']); assert.equal(live.rows.length, 3);
  assert.deepEqual(counted.chart.labels, ['enviada', 'recusada']); assert.deepEqual(counted.chart.series[0].data, [2, 1]);
  assert.equal(state.links.length, 1); assert.equal(state.links[0].label, 'resumo');
  assert.equal(state.at[outro.id].card, page.id, 'each bot stands on the card it touched last');

  // What a bot reads is short: no html, no long note.
  const read = await call('canvas_read');
  assert.equal(read.cards.length, 4); assert.deepEqual(read.areas.sort(), ['Faculdade', 'Vagas']);
  assert.match(read.cards.find(card => card.id === page.id).html, /caracteres/);
  assert.equal((await call('canvas_read', { area: 'faculdade' })).cards.length, 1, 'areas match without case');

  // Moving, resizing and renaming; the person moves and tidies in the app.
  const moved = await call('canvas_update', { id: note.id, x: 5000, y: 5000, w: 600, title: 'Resumo' });
  assert.deepEqual([moved.x, moved.y, moved.w, moved.title], [5000, 5000, 600, 'Resumo']);
  await app.rpc('canvas.move', { id: note.id, x: 10, y: 20 });
  assert.equal((await app.rpc('canvas.state')).cards.find(card => card.id === note.id).x, 10);
  await app.rpc('canvas.tidy');
  const tidy = (await app.rpc('canvas.state')).cards;
  for (const a of tidy) for (const b of tidy) if (a !== b) assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'tidy leaves no card over another');

  // The person's own note: on the canvas as a sticky, read by the bots as written by the owner, and only the person changes it.
  const sticky = await app.rpc('canvas.note', { text: 'Priorizar vagas remotas.', x: 9000, y: 9000 });
  const mine = (await app.rpc('canvas.state')).cards.find(card => card.id === sticky.id);
  assert.equal(mine.sticky, true); assert.equal(mine.botId, null); assert.equal(mine.x, 9000);
  assert.match((await call('canvas_read')).cards.find(card => card.id === sticky.id).by, /pessoa/);
  await assert.rejects(() => call('canvas_update', { id: sticky.id, text: 'outra coisa' }), /é da pessoa/);
  await app.rpc('canvas.note', { id: sticky.id, text: 'Priorizar remotas acima de 9 mil.' });
  assert.equal((await app.rpc('canvas.state')).cards.find(card => card.id === sticky.id).text, 'Priorizar remotas acima de 9 mil.');
  await assert.rejects(() => app.rpc('canvas.note', { text: '  ' }), /Escreva a nota/);
  await app.rpc('canvas.remove', { id: sticky.id });
  for (const method of ['canvas.state', 'canvas.move', 'canvas.remove', 'canvas.tidy', 'canvas.browserImage', 'canvas.note']) assert.ok(DESKTOP_METHODS.includes(method), `a janela do PC pode pedir ${method}`);

  // Removing a card takes its links with it.
  await call('canvas_remove', { id: table.id });
  const after = await app.rpc('canvas.state');
  assert.equal(after.cards.length, 3); assert.equal(after.links.length, 0);
  assert.ok(app.db.all("SELECT * FROM changes WHERE tbl='canvas_items'").length >= 4, 'the canvas syncs with the other device');
});

test('the canvas refuses what is wrong and keeps the rules of tables and files', async t => {
  const { app, vagas, outro, runAs } = await setup(t);
  const call = runAs(vagas.id);
  await assert.rejects(call('canvas_add', { kind: 'note' }), /precisa de text/);
  await assert.rejects(call('canvas_add', { kind: 'chart', chart: { type: 'radar', labels: ['a'], series: [{ name: 'x', data: [1] }] } }), /bar, line ou pie/);
  await assert.rejects(call('canvas_add', { kind: 'chart', chart: { type: 'bar', labels: ['a', 'b'], series: [{ name: 'x', data: [1] }] } }), /um número para cada label/);
  await assert.rejects(call('canvas_add', { kind: 'table', table: 'nao-existe' }), /não existe/);
  await assert.rejects(call('canvas_add', { kind: 'image', file: randomUUID() }), /não encontrado/);
  await assert.rejects(call('canvas_add', { kind: 'browser' }), /aparece sozinho/);
  await assert.rejects(call('canvas_update', { id: 'nada-disso' }), /não encontrado/);
  // A table the person closed to this bot cannot be shown by it on the canvas either.
  await runAs(outro.id)('table_add', { table: 'gastos', row: { item: 'Livro', valor: 30 } });
  await app.rpc('table.access', { table: 'gastos', read: [outro.id], write: [outro.id] });
  await assert.rejects(call('canvas_add', { kind: 'table', table: 'gastos' }), /não liberou/);
  // A picture is one of the bot's own files.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  const file = app.tools.attachments.store(vagas.id, { name: 'print.png', mime: 'image/png', bytes: png });
  const card = await call('canvas_add', { kind: 'image', file: file.id, area: 'Testes' });
  assert.equal((await app.rpc('canvas.state')).cards.find(item => item.id === card.id).file.name, 'print.png');
  await assert.rejects(runAs(outro.id)('canvas_add', { kind: 'image', file: file.id }), /não encontrado/, 'another bot cannot show a file that is not its own');
  assert.throws(() => toolArguments('canvas.add', { kind: 'note', text: 'x', script: 1 }), /não aceita "script"/);
  assert.deepEqual(toolArguments('browser.viewport', { size: 'celular' }), { size: 'celular' });
  assert.throws(() => toolArguments('browser.viewport', { size: 'relogio' }), /celular, tablet ou computador/);
  assert.throws(() => toolArguments('browser.viewport', { width: 100, height: 400 }));
});

test('the canvas geometry: areas, links, bots, fitting, zoom and touches', () => {
  const cards = [{ id: 'a', x: 0, y: 0, w: 300, h: 200, area: 'Vagas' }, { id: 'b', x: 400, y: 0, w: 300, h: 200, area: 'Vagas' }, { id: 'c', x: 0, y: 600, w: 200, h: 100 }];
  const [area] = areaBoxes(cards);
  assert.equal(area.name, 'Vagas'); assert.ok(area.x < 0 && area.x + area.w > 700 && area.y < 0 && area.y + area.h > 200);
  const line = linkLine(cards[0], cards[1]);
  assert.deepEqual([line.x1, line.y1, line.x2, line.y2], [300, 100, 400, 100], 'a link goes from border to border');
  const spots = botSpots([{ id: 'x' }, { id: 'y' }, { id: 'z' }], cards, { x: { card: 'b' }, y: { card: 'b' } });
  assert.equal(spots.x.card, 'b'); assert.ok(spots.y.x > spots.x.x, 'two bots on one card stand side by side'); assert.equal(spots.z.card, null); assert.ok(spots.z.x < 0);
  const view = fitView(bounds(cards, spots), 400, 700);
  assert.ok(view.k > 0.15 && view.k <= 1);
  const zoomed = zoomAround(view, 200, 300, 2);
  assert.ok(Math.abs((200 - zoomed.x) / zoomed.k - (200 - view.x) / view.k) < 1e-9, 'zoom keeps the point under the finger');
  const plain = { k: 1, x: 0, y: 0 };
  assert.equal(hit(plain, 50, 10, cards).kind, 'header'); assert.equal(hit(plain, 50, 100, cards).kind, 'body'); assert.equal(hit(plain, 295, 195, cards).kind, 'resize');
  assert.equal(hit(plain, 350, 100, cards), null); assert.equal(hit(plain, spots.x.x + 5, spots.x.y + 5, cards, spots).kind, 'bot');
  // The team on the canvas: the Chefe is the hub, a bot stands above the card it touched last, the others ring the Chefe; every bot is tied to the Chefe and to what it made.
  const team = [{ id: 'chefe' }, { id: 'x' }, { id: 'y' }, { id: 'z' }], owned = cards.map((card, index) => ({ ...card, botId: index === 2 ? 'y' : 'x' }));
  const places = teamSpots(team, owned, { x: { card: 'b' } }, 'chefe');
  assert.equal(places.x.card, 'b'); assert.ok(places.x.y < 0, 'above its card'); assert.equal(places.y.card, 'c', 'a bot that made a card and touched none stands on its own');
  assert.equal(places.chefe.hub, true); assert.ok(places.chefe.x + NODE_W < 0, 'the hub is left of the cards'); assert.equal(places.z.card, null);
  const lines = teamCords(team, owned, places, { x: { card: 'b' } }, 'chefe');
  assert.equal(lines.filter(line => line.kind === 'team').length, 3); assert.equal(lines.filter(line => line.kind === 'owns').length, 3);
  assert.equal(lines.find(line => line.kind === 'owns' && line.live).key, 'oxb'); assert.match(cord(cards[0], cards[1]).d, /^M300,100 C/);
  const alone = teamSpots(team, [], {}, 'chefe');
  assert.deepEqual([alone.chefe.x + NODE_W / 2, alone.chefe.y + NODE_H / 2], [0, 0], 'with nothing on the canvas the Chefe is the centre');
  assert.equal(hit(plain, places.z.x + NODE_W - 4, places.z.y + NODE_H - 4, cards, places).kind, 'bot', 'the whole plate is the bot');
  const html = sandboxed('<img src="https://example.com/x.png">');
  assert.ok(html.includes(HTML_POLICY) && HTML_POLICY.includes("default-src 'none'") && !HTML_POLICY.includes('http'), 'a page of a bot has no network');
});
