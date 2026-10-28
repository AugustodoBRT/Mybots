import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { checkOffer, pricesIn } from '../supervisor/negotiation.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); } assert.fail('Estado esperado não chegou.'); }
const DAY = 24 * 3600 * 1000;

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-negotiation-'));
  const script = []; const clock = { now: Date.now() };
  // The fake IA calls MyBots tools over MCP, like Claude Code does, following the script for each turn.
  const execute = async (bot, prompt, { tools }) => {
    const call = async (body, session) => { const response = await fetch(tools.endpoint + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(body) }); return { session: response.headers.get('mcp-session-id'), body: await response.json() }; };
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const out = [];
    for (const [name, args] of script.shift() || []) { const answer = (await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, init.session)).body.result; out.push(answer.isError ? 'ERRO: ' + answer.content[0].text : answer.content[0].text); }
    return { text: out.join('\n---\n') || 'ok', ...selection, codexSessionId: randomUUID() };
  };
  const app = await createSupervisor({ directory, port: 0, codex, execute, approvalMs: 8000, clock: () => clock.now, notify: async () => ({ notified: true }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { app, script, clock };
}
async function say(app, bot, text = 'negocia') { const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text }); await until(() => ['done', 'failed'].includes(app.db.task(sent.taskId).state)); return app.db.messages(bot.id).filter(message => message.role !== 'user').at(-1).text; }
const mandate = (bot, clock, extra = {}) => ({ botId: bot.id, objective: 'Comprar a bicicleta aro 29', side: 'buy', target: 800, limit: 900, canClose: true, deadline: new Date(clock.now + 3 * DAY).toISOString(), channels: ['whatsapp', 'olx'], tone: 'friendly', introduce: true, ...extra });

test('the limits are pure: the ceiling of a purchase, the floor of a sale, the channel and the deadline', () => {
  const buy = { status: 'active', side: 'buy', limit: 90000, channels: ['whatsapp'], deadline: '2026-11-01T00:00:00Z' }; const at = Date.parse('2026-10-30T00:00:00Z');
  checkOffer(buy, { amount: 90000, channel: 'whatsapp' }, at);
  assert.throws(() => checkOffer(buy, { amount: 90001, channel: 'whatsapp' }, at), /acima do teto/);
  assert.throws(() => checkOffer(buy, { amount: 80000, channel: 'olx' }, at), /não está no mandato/);
  assert.throws(() => checkOffer(buy, { amount: 80000, channel: 'whatsapp' }, Date.parse('2026-11-02T00:00:00Z')), /prazo/);
  assert.throws(() => checkOffer({ ...buy, status: 'closed' }, { amount: 80000, channel: 'whatsapp' }, at), /encerrado/);
  const sell = { ...buy, side: 'sell', limit: 60000 };
  checkOffer(sell, { amount: 60000, channel: 'whatsapp' }, at);
  assert.throws(() => checkOffer(sell, { amount: 59999, channel: 'whatsapp' }, at), /abaixo do mínimo/);
  assert.deepEqual(pricesIn('Posso pagar R$ 1.200,50 ou 900 reais, ok? R$850').sort((a, b) => a - b), [85000, 90000, 120050]);
  assert.deepEqual([...pricesIn('Fecho por R$ 850 hoje')], [85000]);
});

test('an offer above the ceiling is blocked by the supervisor, and so is a text that carries another price', async t => {
  const { app, script, clock } = await setup(t);
  const bot = await app.rpc('bot.create', { name: 'Comprador', ...selection, access: 'full' });
  const created = await app.rpc('negotiation.save', mandate(bot, clock));
  script.push([['negotiation_offer', { channel: 'whatsapp', to: 'Vendedor', amount: 1100, text: 'Pago R$ 1.100 hoje.' }], ['negotiation_offer', { channel: 'whatsapp', to: 'Vendedor', amount: 850, text: 'Pago R$ 1.100 hoje.' }], ['negotiation_offer', { channel: 'olx', to: 'Vendedor', amount: 850, text: 'Pago R$ 850.' }], ['negotiation_offer', { channel: 'whatsapp', to: 'Vendedor', amount: 850, text: 'Olá! Pago R$ 850 hoje.' }]]);
  const reply = (await say(app, bot)).split('\n---\n');
  assert.match(reply[0], /^ERRO: Oferta acima do teto.*R\$ 900,00/);
  assert.match(reply[1], /^ERRO: .*R\$ 1\.100,00.*R\$ 850,00/);
  assert.equal(reply[2].startsWith('ERRO'), false, 'olx is in the mandate');
  assert.equal(JSON.parse(reply[3]).approved, true);
  const view = app.state().negotiations.find(item => item.id === created.id);
  assert.deepEqual(view.offers.map(item => item.state), ['blocked', 'blocked', 'sent', 'sent']);
  assert.equal(view.lastOffer.amount, 85000);
  assert.ok(app.db.all("SELECT * FROM activity WHERE kind='negotiation_blocked'").length >= 2);
});

test('an expired mandate ends the negotiation: no offer goes out and a waiting proposal is refused', async t => {
  const { app, script, clock } = await setup(t);
  const bot = await app.rpc('bot.create', { name: 'Comprador', ...selection, access: 'full' });
  const created = await app.rpc('negotiation.save', mandate(bot, clock, { canClose: false }));
  script.push([['negotiation_close', { channel: 'whatsapp', to: 'Vendedor', amount: 880, summary: 'Aceita 880.' }]]);
  await say(app, bot);
  assert.equal(app.state().negotiations[0].status, 'awaiting_you');
  clock.now += 4 * DAY;
  script.push([['negotiation_offer', { channel: 'whatsapp', to: 'Vendedor', amount: 800, text: 'R$ 800?' }], ['negotiation_status', {}]]);
  const reply = (await say(app, bot)).split('\n---\n');
  assert.match(reply[0], /^ERRO: O prazo do mandato acabou/);
  script.push([['negotiation_offer', { negotiation: created.id, channel: 'whatsapp', to: 'Vendedor', amount: 800, text: 'R$ 800?' }]]);
  assert.match(await say(app, bot), /ERRO: O prazo desse mandato acabou/);
  const view = app.state().negotiations.find(item => item.id === created.id);
  assert.equal(view.status, 'expired'); assert.equal(view.proposal, null); assert.equal(view.offers.at(-1).state, 'refused');
  assert.equal(JSON.parse(reply[1]).mandates[0].status, 'expired');
  await assert.rejects(app.rpc('negotiation.respond', { offerId: view.offers.at(-1).id, accept: true }), /já foi respondida|prazo/);
});

test('closing without permission makes an Aceitar/Recusar card; accepting closes, refusing reopens, and the bot hears the answer', async t => {
  const { app, script, clock } = await setup(t);
  const bot = await app.rpc('bot.create', { name: 'Comprador', ...selection, access: 'full' });
  const created = await app.rpc('negotiation.save', mandate(bot, clock, { canClose: false }));
  script.push([['negotiation_close', { channel: 'whatsapp', to: 'Vendedor', amount: 880, summary: 'Ele aceita 880 com entrega.' }], ['negotiation_offer', { channel: 'whatsapp', to: 'Vendedor', amount: 800, text: 'R$ 800?' }]]);
  const first = (await say(app, bot)).split('\n---\n');
  assert.equal(JSON.parse(first[0]).waitingForPerson, true);
  assert.match(first[1], /^ERRO: .*esperando a decisão/);
  const card = app.state().negotiations.find(item => item.id === created.id).proposal;
  assert.equal(card.state, 'proposed'); assert.equal(card.amount, 88000);
  const approvals = app.state().approvals;
  assert.equal(approvals.length, 1); assert.equal(approvals[0].kind, 'negotiation'); assert.equal(approvals[0].offerId, card.id);
  assert.match(approvals[0].title, /fechar a compra por R\$ 880,00/); assert.match(approvals[0].summary, /não pode fechar sozinho/); assert.equal(approvals[0].canAlways, false);
  // Refuse: the mandate reopens and the bot is told.
  await app.rpc('negotiation.respond', { offerId: card.id, accept: false });
  await until(() => app.db.messages(bot.id).some(message => /RECUSOU/.test(message.text || '')));
  assert.equal(app.state().negotiations[0].status, 'active');
  await until(() => !app.db.tasks().some(task => ['queued', 'running'].includes(task.state)));
  // Close again, accept: closed, and the bot is told to confirm.
  script.push([['negotiation_close', { channel: 'whatsapp', to: 'Vendedor', amount: 890, summary: 'Aceita 890.' }]]);
  await say(app, bot);
  const second = app.state().negotiations[0].proposal;
  await app.rpc('negotiation.respond', { offerId: second.id, accept: true });
  await until(() => app.db.messages(bot.id).some(message => /ACEITOU/.test(message.text || '')));
  assert.equal(app.state().negotiations[0].status, 'closed');
  assert.equal(app.state().approvals.length, 0);
  await assert.rejects(app.rpc('negotiation.respond', { offerId: second.id, accept: false }), /já foi respondida/);
});

test('a price outside the mandate always goes to the person, even when the bot may close; inside, with permission, it closes by itself', async t => {
  const { app, script, clock } = await setup(t);
  const bot = await app.rpc('bot.create', { name: 'Comprador', ...selection, access: 'full' });
  const created = await app.rpc('negotiation.save', mandate(bot, clock));
  script.push([['negotiation_close', { channel: 'whatsapp', to: 'Vendedor', amount: 1000, summary: 'Só fecha em 1000.' }]]);
  assert.equal(JSON.parse(await say(app, bot)).waitingForPerson, true);
  const outside = app.state().negotiations.find(item => item.id === created.id);
  assert.equal(outside.proposal.outside, true);
  assert.equal(app.state().negotiations.find(item => item.id === created.id).status, 'awaiting_you');
  await app.rpc('negotiation.respond', { offerId: outside.proposal.id, accept: false });
  await until(() => !app.db.tasks().some(task => ['queued', 'running'].includes(task.state)));
  script.push([['negotiation_close', { channel: 'whatsapp', to: 'Vendedor', amount: 870, summary: 'Fechado em 870.' }]]);
  const done = JSON.parse(await say(app, bot));
  assert.equal(done.closed, true);
  assert.equal(app.state().negotiations.find(item => item.id === created.id).status, 'closed');
});

test('a bot cannot use another bot\'s mandate, a bot without one cannot negotiate, and only the app sets mandates', async t => {
  const { app, script, clock } = await setup(t);
  const owner = await app.rpc('bot.create', { name: 'Dono', ...selection, access: 'full' });
  const other = await app.rpc('bot.create', { name: 'Outro', ...selection, access: 'full' });
  const created = await app.rpc('negotiation.save', mandate(owner, clock));
  script.push([['negotiation_offer', { channel: 'whatsapp', to: 'V', amount: 800, text: 'R$ 800?' }], ['negotiation_offer', { channel: 'whatsapp', to: 'V', amount: 800, text: 'R$ 800?', negotiation: created.id }]]);
  const reply = (await say(app, other)).split('\n---\n');
  assert.match(reply[0], /não tem mandato/); assert.match(reply[1], /Não há mandato aberto com esse id/);
  assert.equal(app.state().negotiations.find(item => item.id === created.id).offers.length, 0);
  await assert.rejects(app.rpc('negotiation.save', mandate(owner, clock, { target: 950 })), /não pode passar do teto/);
  await assert.rejects(app.rpc('negotiation.save', mandate(owner, clock, { deadline: new Date(clock.now - 1000).toISOString() })), /prazo no futuro/);
  await assert.rejects(app.rpc('negotiation.save', mandate(owner, clock, { channels: ['telegram'] })), /canal/);
  assert.equal((await app.rpc('negotiation.cancel', { id: created.id })).cancelled, true);
  script.push([['negotiation_offer', { channel: 'whatsapp', to: 'V', amount: 800, text: 'R$ 800?' }]]);
  assert.match(await say(app, owner), /ERRO: Este bot não tem mandato/);
});

test('the status tells the bot how to write: the person\'s tone and whether it introduces itself as an assistant', async t => {
  const { app, script, clock } = await setup(t);
  const bot = await app.rpc('bot.create', { name: 'Vendedor', ...selection, access: 'full' });
  await app.rpc('person.update', { name: 'Ana' });
  await app.rpc('negotiation.save', mandate(bot, clock, { side: 'sell', target: 700, limit: 600, tone: 'formal', introduce: false }));
  script.push([['negotiation_status', {}]]);
  const status = JSON.parse(await say(app, bot)).mandates[0];
  assert.match(status.how_to_write, /Ana/); assert.match(status.how_to_write, /formal/); assert.match(status.how_to_write, /nunca negue ser um assistente/);
  assert.equal(status.limit, 'R$ 600,00');
});
