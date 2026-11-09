import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const root = await mkdtemp(join(tmpdir(), 'mybots-accounts-pc-'));
process.env.MYBOTS_ACCOUNTS = root;
const { accounts } = await import('../lib/accounts.mjs');
const { createNode } = await import('../pc/server.mjs');
const { createRelay } = await import('../relay/server.mjs');
const { SupervisorClient } = await import('../mobile/supervisor-client.js');
const { pairWithComputer, remoteSocketClass } = await import('../mobile/pc-client.js');
const { WebSocket } = await import('../supervisor/node_modules/ws/wrapper.mjs');
test.after(() => rm(root, { recursive: true, force: true }));

const selection = { model: 'test', reasoningEffort: 'low' };
const model = { ...selection, provider: 'codex', displayName: 'Teste', efforts: ['low'], defaultEffort: 'low' };
const until = async (check, ms = 15000) => { const end = Date.now() + ms; while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(r => setTimeout(r, 25)); } assert.fail('Estado esperado não chegou.'); };

test('the app adds, sees and removes an IA account on the computer, through the computer\'s node', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-acc-pc-'));
  const hub = createRelay({ port: 0, host: '127.0.0.1' }); const url = `ws://127.0.0.1:${await hub.listen()}`;
  // What the node reports: the IA's own login plus the extra accounts the registry holds (never logged in here).
  const status = async () => ({ connections: { codex: { available: true, loggedIn: true, message: '' } }, models: [model],
    accounts: { codex: [{ id: 'default', label: 'Conta principal', loggedIn: true, default: true }, ...accounts.list('codex').map(item => ({ id: item.id, label: item.label, loggedIn: false }))] } });
  const node = await createNode({ directory: join(directory, 'pc'), projects: join(directory, 'projects'), port: 0, uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], discoveryPort: 0, relay: { url }, execute: async () => ({ text: 'ok', ...selection }), status,
    desktop: { indicate: async () => async () => {}, command: async () => ({}) }, browser: { command: async () => ({}), configure() {}, close: async () => {} }, local: { port: 0, env: { PATH: '/nonexistent' } }, log: () => {} });
  await node.local().ready();
  const phone = { id: 'tel-' + randomUUID().slice(0, 8), name: 'Meu celular' }; let client;
  t.after(async () => { client?.close(); await node.close(); await hub.close(); await rm(directory, { recursive: true, force: true }); });
  const { target } = await pairWithComputer(WebSocket, node.pairing().link, phone);
  client = new SupervisorClient({ WebSocketClass: remoteSocketClass(WebSocket, () => ({ target, phone })) });
  await until(async () => { try { await client.connect({ port: 0, token: 'canal' }); return true; } catch { return false; } });
  // The state already shows the computer's accounts (it reaches the supervisor with the node's status).
  const first = await until(async () => { const state = await client.call('state.get'); return state.aiAccounts?.computer?.accounts?.codex && state; });
  assert.equal(first.deviceKind, 'computer');   // the computer's supervisor knows it is the computer's (it was not told, once)
  assert.equal(first.aiAccounts.here, null);   // the computer's own supervisor has no IA of its own: the node runs them
  assert.deepEqual(first.aiAccounts.computer.accounts.codex.map(item => item.id), ['default']);
  const added = await client.call('ai.accounts', { op: 'add', provider: 'codex', label: 'Casa' });
  assert.equal(added.account.id, 'casa'); assert.match(added.command, /^CODEX_HOME=".+" codex login$/);
  assert.deepEqual(added.accounts.codex.map(item => item.id), ['default', 'casa']);
  const seen = await until(async () => { const state = await client.call('state.get'); return state.aiAccounts.computer.accounts.codex.some(item => item.id === 'casa') && state; });
  assert.equal(seen.aiAccounts.computer.accounts.codex.find(item => item.id === 'casa').loggedIn, false);
  await assert.rejects(client.call('ai.accounts', { op: 'add', provider: 'codex', label: 'casa' }), /Já existe/);
  assert.match((await client.call('ai.accounts', { op: 'command', provider: 'codex', id: 'casa' })).command, /codex login$/);
  await client.call('ai.accounts', { op: 'remove', provider: 'codex', id: 'casa' });
  assert.equal(existsSync(accounts.dir('codex', 'casa')), false);
  await until(async () => (await client.call('state.get')).aiAccounts.computer.accounts.codex.length === 1);
});

test('the app asks the computer to update itself, through the computer\'s node; without its window open the answer says so', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-acc-pc-'));
  const hub = createRelay({ port: 0, host: '127.0.0.1' }); const url = `ws://127.0.0.1:${await hub.listen()}`;
  // What the node reports: the IA's own login plus the extra accounts the registry holds (never logged in here).
  const status = async () => ({ connections: { codex: { available: true, loggedIn: true, message: '' } }, models: [model],
    accounts: { codex: [{ id: 'default', label: 'Conta principal', loggedIn: true, default: true }, ...accounts.list('codex').map(item => ({ id: item.id, label: item.label, loggedIn: false }))] } });
  const node = await createNode({ directory: join(directory, 'pc'), projects: join(directory, 'projects'), port: 0, uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], discoveryPort: 0, relay: { url }, execute: async () => ({ text: 'ok', ...selection }), status,
    desktop: { indicate: async () => async () => {}, command: async () => ({}) }, browser: { command: async () => ({}), configure() {}, close: async () => {} }, local: { port: 0, env: { PATH: '/nonexistent' } }, log: () => {} });
  await node.local().ready();
  const phone = { id: 'tel-' + randomUUID().slice(0, 8), name: 'Meu celular' }; let client;
  t.after(async () => { client?.close(); await node.close(); await hub.close(); await rm(directory, { recursive: true, force: true }); });
  const { target } = await pairWithComputer(WebSocket, node.pairing().link, phone);
  client = new SupervisorClient({ WebSocketClass: remoteSocketClass(WebSocket, () => ({ target, phone })) });
  await until(async () => { try { await client.connect({ port: 0, token: 'canal' }); return true; } catch { return false; } });
  await until(async () => (await client.call('state.get')).nodes?.some(node => node.online));
  await assert.rejects(client.call('pc.update', { op: 'check' }), /janela do MyBots não está aberta/);
  await assert.rejects(client.call('pc.update', { op: 'apagar' }), /Pedido inválido/);
});
