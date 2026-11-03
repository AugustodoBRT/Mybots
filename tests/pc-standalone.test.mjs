import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocket } from '../supervisor/node_modules/ws/wrapper.mjs';
import { createNode } from '../pc/server.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const model = { ...selection, provider: 'codex', displayName: 'Teste', efforts: ['low'], defaultEffort: 'low' };
async function until(check, ms = 20000) { const end = Date.now() + ms; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 25)); } assert.fail('Estado esperado não chegou.'); }

/** A window of the computer: the page's connection to the node (port and token), like the one the app opens. */
async function windowOf(node, directory) {
  const token = (await readFile(join(directory, 'ui-token'), 'utf8')).trim();
  const ws = new WebSocket(`ws://127.0.0.1:${node.uiPort}`, { origin: `http://127.0.0.1:${node.uiPort}` });
  const waiting = new Map(), events = [];
  ws.on('message', raw => { const message = JSON.parse(raw.toString()); if (message.event) events.push(message); else waiting.get(message.id)?.(message); });
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = randomUUID(); waiting.set(id, message => message.error ? reject(new Error(message.error)) : resolve(message.result)); ws.send(JSON.stringify({ id, method, params }));
  });
  await call('auth', { token });
  return { call, events, ws, close: () => ws.terminate() };
}

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-standalone-'));
  const turns = [], windows = [], nodes = [];
  const execute = async (bot, prompt) => { turns.push({ bot: bot.name, prompt }); return { text: 'Olá do computador', ...selection }; };
  const make = async () => {
    const node = await createNode({ directory: join(directory, 'pc'), projects: join(directory, 'projects'), port: 0, uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], discoveryPort: 0, execute,
      status: async () => ({ connections: { codex: { available: true, loggedIn: true, message: '' } }, models: [model] }),
      desktop: { indicate: async () => async () => {}, command: async () => ({}) }, browser: { command: async () => ({}), configure() {}, close: async () => {} },
      local: { port: 3300 + Math.floor(Math.random() * 600), env: { PATH: '/nonexistent' } }, log: () => {} });
    nodes.push(node); return node;
  };
  const node = await make();
  t.after(async () => { for (const item of windows) item.close(); for (const item of nodes) await item.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  return { directory, node, make, turns, open: async current => { const item = await windowOf(current || node, join(directory, 'pc')); windows.push(item); return item; } };
}

test('the computer works on its own: bots, conversation and replies without any phone', async t => {
  const f = await setup(t);
  await f.node.local().ready();
  // The supervisor paired with this node over loopback and is online as its executor, without being listed as a phone.
  const window = await until(async () => { try { const item = await f.open(); const state = await item.call('state.get'); return state.computer?.state === 'online' ? { item, state } : (item.close(), null); } catch { return null; } });
  assert.equal(window.state.source, 'local'); assert.equal(window.state.localAvailable, true);
  assert.deepEqual(f.node.phones(), []);
  assert.ok(existsSync(join(f.directory, 'pc', 'supervisor', 'mybots.db')));
  const bot = await window.item.call('bot.create', { name: 'Sozinho', instructions: 'Ajuda.', home: 'pc', access: 'ask', ...selection });
  const sent = await window.item.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'oi' });
  const chat = await until(async () => { const page = await window.item.call('chat.page', { botId: bot.id }); return page.messages?.some(message => message.role === 'assistant' && message.status === 'complete') ? page : null; });
  assert.equal(chat.messages.at(-1).text, 'Olá do computador'); assert.ok(sent.taskId);
  assert.equal(f.turns.length, 1);
  const status = await window.item.call('desktop.status');
  assert.equal(status.source, 'local'); assert.equal(status.phone, false);
});

test('methods outside the window list and the Livre level are refused; the choice of source is kept and windows reconnect', async t => {
  const f = await setup(t);
  await f.node.local().ready();
  const first = await until(async () => { try { const item = await f.open(); await item.call('state.get'); return item; } catch { return null; } });
  await assert.rejects(first.call('vault.status'), /só pode ser feito no celular/);
  await assert.rejects(first.call('bot.create', { name: 'Livre', access: 'free', ...selection }), /Livre só se escolhe no app do celular/);
  await assert.rejects(first.call('desktop.source', { source: 'nada' }), /Escolha/);
  const closed = new Promise(resolve => first.ws.once('close', resolve));
  assert.deepEqual(await first.call('desktop.source', { source: 'phone' }), { source: 'phone' }); await closed;
  const second = await f.open();
  assert.equal((await second.call('desktop.status')).source, 'phone');
  await assert.rejects(second.call('state.get'), /celular está fora de alcance/);
  await second.call('desktop.source', { source: 'local' });
  assert.equal(JSON.parse(await readFile(join(f.directory, 'pc', 'ui-source.json'), 'utf8')).source, 'local');
});

test('the computer\'s own supervisor keeps its data and pairing when the node restarts', async t => {
  const f = await setup(t);
  await f.node.local().ready();
  const online = async node => until(async () => { try { const item = await f.open(node); const state = await item.call('state.get'); return state.computer?.state === 'online' ? { item, state } : (item.close(), null); } catch { return null; } });
  const first = await online(f.node);
  const bot = await first.item.call('bot.create', { name: 'Fica', instructions: '', home: 'pc', access: 'ask', ...selection });
  await f.node.close();
  const again = await f.make(); await again.local().ready();
  const second = await online(again);
  assert.ok(second.state.bots.some(item => item.id === bot.id && item.name === 'Fica'));
  assert.equal(JSON.parse(await readFile(join(f.directory, 'pc', 'local-link.json'), 'utf8')).id, again.id);
  assert.deepEqual(again.phones(), []);
});
