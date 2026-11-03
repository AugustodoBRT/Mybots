import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';
import { WebSocket } from '../supervisor/node_modules/ws/wrapper.mjs';
import { createNode } from '../pc/server.mjs';
import { createRelay } from '../relay/server.mjs';
import { roomFor } from '../supervisor/relay.mjs';
import { SupervisorClient } from '../mobile/supervisor-client.js';
import { parseQr, pairWithComputer, connectToComputer, remoteSocketClass, relayRoom, secureRelay } from '../mobile/pc-client.js';

const selection = { model: 'test', reasoningEffort: 'low' };
const model = { ...selection, provider: 'codex', displayName: 'Teste', efforts: ['low'], defaultEffort: 'low' };
async function until(check, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 25)); } assert.fail('Estado esperado não chegou.'); }

async function setup(t, { relay = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-app-'));
  const hub = relay ? createRelay({ port: 0, host: '127.0.0.1' }) : null; const url = hub ? `ws://127.0.0.1:${await hub.listen()}` : null;
  const turns = [];
  const node = await createNode({ directory: join(directory, 'pc'), projects: join(directory, 'projects'), port: 0, uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], discoveryPort: 0, relay: url, sync: false,
    execute: async (bot, prompt) => { turns.push(prompt); return { text: `${bot.name} respondeu pelo computador`, ...selection }; },
    status: async () => ({ connections: { codex: { available: true, loggedIn: true, message: '' } }, models: [model] }),
    desktop: { indicate: async () => async () => {}, command: async () => ({}) }, browser: { command: async () => ({}), configure() {}, close: async () => {} },
    local: { port: 0, env: { PATH: '/nonexistent' } }, log: () => {} });
  await node.local().ready();
  const clients = [];
  t.after(async () => { for (const item of clients) item.close(); await node.close(); await hub?.close(); await rm(directory, { recursive: true, force: true }); });
  const phone = { id: 'tel-' + randomUUID().slice(0, 8), name: 'Meu celular' };
  const app = async target => { const events = []; const RemoteSocket = remoteSocketClass(WebSocket, () => ({ target, phone }));
    const client = new SupervisorClient({ WebSocketClass: RemoteSocket, onEvent: (event, data) => events.push([event, data]) }); clients.push(client);
    await until(async () => { try { await client.connect({ port: 0, token: 'canal' }); return true; } catch { return false; } }); return { client, events }; };
  return { directory, node, hub, url, turns, phone, app, pair: () => pairWithComputer(WebSocket, node.pairing().link, phone) };
}

test('the app never uses the old cleartext relay address: it is moved to the wss:// name', () => {
  assert.equal(secureRelay('ws://136.248.104.150:3240'), 'wss://mybots-rele.duckdns.org');
  assert.equal(secureRelay('wss://mybots-rele.duckdns.org'), 'wss://mybots-rele.duckdns.org'); assert.equal(secureRelay('ws://127.0.0.1:9'), 'ws://127.0.0.1:9');
});

test('the QR is read the way the computer wrote it, and rooms match the relay\'s', () => {
  const qr = 'mybots://computador?v=1&id=abc123&n=Meu+PC&p=3230&f=' + 'A'.repeat(43) + '&c=codigo-12345&a=192.168.0.2%2C100.70.1.2&r=ws%3A%2F%2F136.248.104.150%3A3240';
  assert.deepEqual(parseQr(qr), { id: 'abc123', name: 'Meu PC', port: 3230, addresses: ['192.168.0.2', '100.70.1.2'], code: 'codigo-12345', relay: 'ws://136.248.104.150:3240' });
  for (const bad of ['', 'http://x', 'mybots://computador?v=2&id=a&p=1&c=12345678&a=1.1.1.1', 'mybots://computador?v=1&id=a&p=99999&c=12345678&a=1.1.1.1', 'mybots://computador?v=1&id=a&p=1&c=curto&a=1.1.1.1', 'mybots://computador?v=1&id=a&p=1&c=12345678&a=']) assert.throws(() => parseQr(bad), /QR/, bad);
  assert.equal(parseQr(qr.replace('ws%3A%2F%2F136.248.104.150%3A3240', 'ftp%3A%2F%2Fx')).relay, undefined);
  for (const secret of ['abc', randomBytes(32).toString('base64url')]) assert.equal(relayRoom(secret), roomFor(secret));
});

test('a phone with no Termux pairs by the QR, then the real app client reads and writes the computer\'s MyBots', async t => {
  const f = await setup(t);
  const { target } = await f.pair();
  assert.equal(target.id, f.node.id); assert.ok(target.secret); assert.equal(target.relay, f.url);
  assert.deepEqual(f.node.apps().map(item => item.id), [f.phone.id]); assert.deepEqual(f.node.phones(), []);
  const raw = JSON.parse(await readFile(join(f.directory, 'pc', 'apps.json'), 'utf8')); assert.equal(raw[0].secret, target.secret);
  const { client, events } = await f.app(target);
  const state = await client.call('state.get');
  assert.equal(state.source, 'local'); assert.equal(state.models.length > 0, true);
  const bot = await client.call('bot.create', { name: 'Do celular sem Termux', instructions: 'Ajuda.', access: 'ask', ...selection });
  const sent = await client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'oi do celular' });
  const page = await until(async () => { const found = await client.call('chat.page', { botId: bot.id }); return found.messages.some(message => message.role === 'assistant' && message.status === 'complete') ? found : null; });
  assert.equal(page.messages.at(-1).text, 'Do celular sem Termux respondeu pelo computador'); assert.ok(sent.taskId); assert.equal(f.turns.length, 1);
  assert.ok(events.some(([event]) => event === 'message.added'), 'the events of the computer arrive');
});

test('pairing also works through the relay, in a room named from the QR\'s code, and that room goes away with the code', async t => {
  const f = await setup(t);
  const link = f.node.pairing().link; await until(() => f.node.relay().online() === 1);   // no phone is paired yet: the only room is the QR's
  const qr = { ...parseQr(link), port: 1 };                                             // the address does not work: only the relay can
  const { target, channel } = await pairWithComputer(WebSocket, qr, f.phone);
  assert.equal(channel.via, 'relay'); assert.ok(target.secret); channel.close();
  assert.deepEqual(f.node.apps().map(item => item.id), [f.phone.id]);
  // The code is spent: its room is dropped at the next sync, and a second phone cannot use the same QR.
  f.node.relay().sync(); await until(() => f.node.relay().rooms().length === 1);
  await assert.rejects(pairWithComputer(WebSocket, { ...qr }, { id: 'intruso', name: 'x' }), /inválido ou vencido|fora do ar|Conexão encerrada|Sem resposta|Não consegui conectar/);
  assert.equal(f.node.apps().length, 1);
});

test('the same phone reaches the computer through the relay when its addresses do not work, and uses only what the window may', async t => {
  const f = await setup(t);
  const { target } = await f.pair();
  const away = { ...target, addresses: ['127.0.0.1'], port: 1 };
  const channel = await connectToComputer(WebSocket, away, f.phone); assert.equal(channel.via, 'relay'); channel.close();
  const { client } = await f.app(away);
  assert.equal((await client.call('state.get')).source, 'local');
  // What belongs to the computer's own screen is refused for a phone, and the window's list still applies.
  for (const method of ['desktop.file', 'desktop.dictate', 'desktop.pair', 'desktop.source', 'desktop.sync']) await assert.rejects(client.call(method, {}), /só pode ser feito no computador/, method);
  await assert.rejects(client.call('sync.apply', { changes: [] }), /só pode ser feito pelo MyBots/);
  await assert.rejects(client.call('vault.status', {}), /só pode ser feito no celular/);
  await assert.rejects(client.call('bot.create', { name: 'Livre', access: 'free', ...selection }), /Livre só se escolhe/);
  assert.deepEqual(await client.call('desktop.status'), { phone: false, remote: true, source: 'local', localAvailable: true, sync: null });
});

test('strangers get nothing: a wrong secret, an unknown phone, a spent code and a plain HTTP request', async t => {
  const f = await setup(t);
  const { target } = await f.pair();
  await assert.rejects(connectToComputer(WebSocket, { ...target, relay: undefined, secret: randomBytes(32).toString('base64url') }, f.phone), /Este não é o computador|Conexão encerrada|Sem resposta/);
  await assert.rejects(connectToComputer(WebSocket, { ...target, relay: undefined }, { id: 'desconhecido', name: 'x' }), /não está pareado|Conexão encerrada/);
  await assert.rejects(pairWithComputer(WebSocket, { ...parseQr(f.node.pairing().link), code: 'codigo-errado-123456' }, { id: 'outro', name: 'x' }), /inválido ou vencido|Conexão encerrada/);
  const link = f.node.pairing().link; await pairWithComputer(WebSocket, link, { id: 'segundo', name: 'Segundo' });
  await assert.rejects(pairWithComputer(WebSocket, link, { id: 'terceiro', name: 'Terceiro' }), /inválido ou vencido|Conexão encerrada/);
  assert.deepEqual(f.node.apps().map(item => item.id).sort(), [f.phone.id, 'segundo'].sort());
  // The port still answers the old callers: a plain GET is a WebSocket upgrade attempt that goes nowhere, and a stray byte is dropped.
  const response = await new Promise(resolve => { const socket = new WebSocket(`ws://127.0.0.1:${f.node.port}/`); socket.on('open', () => { socket.close(); resolve('aberto'); }); socket.on('error', () => resolve('erro')); });
  assert.ok(['aberto', 'erro'].includes(response));
});

test('the window and a phone app use the same computer at once, and the Termux link on the same port still works', async t => {
  const f = await setup(t);
  const { target } = await f.pair(); const { client } = await f.app(target);
  const made = await client.call('bot.create', { name: 'Compartilhado', instructions: '', access: 'ask', ...selection });
  const token = (await readFile(join(f.directory, 'pc', 'ui-token'), 'utf8')).trim();
  const ws = new WebSocket(`ws://127.0.0.1:${f.node.uiPort}`, { origin: `http://127.0.0.1:${f.node.uiPort}` }); const waiting = new Map();
  ws.on('message', raw => { const message = JSON.parse(raw.toString()); waiting.get(message.id)?.(message); });
  await new Promise(resolve => ws.once('open', resolve)); t.after(() => ws.terminate());
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = randomUUID(); waiting.set(id, m => m.error ? reject(new Error(m.error)) : resolve(m.result)); ws.send(JSON.stringify({ id, method, params })); });
  await call('auth', { token });
  assert.ok((await call('state.get')).bots.some(bot => bot.id === made.id));
  assert.equal((await call('desktop.status')).lastPaired > '2020', true);
});

test('a lost phone is forgotten from the computer: cut off at once, gone from the relay, and it cannot return without a new QR', async t => {
  const f = await setup(t);
  const { target } = await f.pair(); const { client } = await f.app(target);
  assert.equal((await client.call('state.get')).source, 'local');
  const token = (await readFile(join(f.directory, 'pc', 'ui-token'), 'utf8')).trim();
  const ws = new WebSocket(`ws://127.0.0.1:${f.node.uiPort}`, { origin: `http://127.0.0.1:${f.node.uiPort}` }); const waiting = new Map();
  ws.on('message', raw => { const message = JSON.parse(raw.toString()); waiting.get(message.id)?.(message); });
  await new Promise(resolve => ws.once('open', resolve)); t.after(() => ws.terminate());
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = randomUUID(); waiting.set(id, m => m.error ? reject(new Error(m.error)) : resolve(m.result)); ws.send(JSON.stringify({ id, method, params })); });
  await call('auth', { token });
  const listed = (await call('desktop.status')).apps; assert.deepEqual(listed.map(item => item.id), [f.phone.id]); assert.equal('secret' in listed[0], false);
  // A phone cannot forget phones (that belongs to the computer's own window).
  await assert.rejects(client.call('desktop.forgetApp', { id: f.phone.id }), /só pode ser feito no computador/);
  await call('desktop.forgetApp', { id: f.phone.id });
  assert.deepEqual(f.node.apps(), []); await until(() => f.node.relay().rooms().length === 0 || f.node.relay().rooms().length === 0);
  await assert.rejects(client.call('state.get'), /interrompida|desconectado|supervisor/);
  await assert.rejects(connectToComputer(WebSocket, { ...target, relay: undefined }, f.phone), /não está pareado|Conexão encerrada/);
});
