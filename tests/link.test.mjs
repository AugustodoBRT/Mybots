import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createSupervisor } from '../supervisor/index.mjs';
import { createNode } from '../pc/server.mjs';
import { parsePairing } from '../supervisor/link.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check, ms = 8000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); } assert.fail('Estado esperado não chegou.'); }
const freePort = () => new Promise(resolve => { const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

// What the computer's IA does here: calls a tool of the bot through the link (MCP over HTTP, like Claude Code).
async function computerIA(bot, prompt, { tools, onSession, signal }) {
  const call = async (body, session) => {
    const response = await fetch(tools.endpoint + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(body) });
    return { session: response.headers.get('mcp-session-id'), body: await response.json() };
  };
  const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'memory_write', arguments: { key: 'onde', text: 'escrito no computador' } } }, init.session);
  if (/espera/.test(prompt)) await new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new Error('parado')), { once: true }));
  const id = bot.codexSessionId || randomUUID(); await onSession(id);
  return { text: `${bot.name} no computador`, ...selection, codexSessionId: id };
}

async function setup(t) {
  const phoneDir = await mkdtemp(join(tmpdir(), 'mybots-phone-')); const pcDir = await mkdtemp(join(tmpdir(), 'mybots-pc-'));
  const port = await freePort();
  const app = await createSupervisor({ directory: phoneDir, port: 0, codex, execute: async bot => ({ text: `${bot.name} no celular`, ...selection, codexSessionId: randomUUID() }) });
  const options = { directory: pcDir, port, host: '127.0.0.1', advertise: () => ['127.0.0.1'], execute: computerIA, status: async () => ({ connections: { codex: { available: true, loggedIn: true }, claude: { loggedIn: false } }, models: [] }) };
  let node = await createNode(options);
  t.after(async () => { await app.close(); await node.close(); await rm(phoneDir, { recursive: true, force: true }); await rm(pcDir, { recursive: true, force: true }); });
  return { app, options, get node() { return node; }, async restartNode() { await node.close(); node = await createNode(options); return node; } };
}

test('pairing by QR: the phone checks the certificate, the code is used once, and a computer bot answers there with its phone tools', async t => {
  const f = await setup(t);
  const { link } = f.node.pairing();
  assert.equal(parsePairing(link).addresses[0], '127.0.0.1');
  // Another machine answering on the address (different certificate) is refused before anything is sent.
  const forged = link.replace(/f=(.)/, (all, first) => 'f=' + (first === 'A' ? 'B' : 'A'));
  await assert.rejects(f.app.rpc('computer.pair', { link: forged }), /Outro aparelho/);
  assert.deepEqual(await f.app.rpc('computer.pair', { link }), { name: f.node.name });
  await assert.rejects(f.app.rpc('computer.pair', { link }), /inválido ou vencido/);
  await until(() => f.app.state().computer.state === 'online');
  assert.equal(f.node.phones().length, 1); assert.equal(f.node.phones()[0].secret, undefined);
  assert.equal(f.app.state().nodes[0].connections.codex.loggedIn, true);

  const bot = await f.app.rpc('bot.create', { name: 'Programador', ...selection, home: 'pc', access: 'full' });
  const sent = await f.app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi' });
  await until(() => f.app.db.task(sent.taskId).state === 'done');
  assert.equal(f.app.db.bot(bot.id).messages.at(-1).text, 'Programador no computador');
  assert.match(f.app.db.get('SELECT body FROM memory WHERE bot_id=?', bot.id).body, /escrito no computador/);
  assert.ok(f.app.db.bot(bot.id).codexSessionId);
  // An "any" bot answers on the phone without a computer session, and moves to a new session on the computer.
  const any = await f.app.rpc('bot.create', { name: 'Pesquisa', ...selection, home: 'any', access: 'full' });
  const there = await f.app.rpc('chat.send', { botId: any.id, requestId: randomUUID(), text: 'Oi' });
  await until(() => f.app.db.task(there.taskId).state === 'done');
  assert.equal(f.app.db.bot(any.id).messages.at(-1).text, 'Pesquisa no computador');
});

test('the link comes back by itself after the computer restarts; cancelling stops the turn on the computer; a stop mid-answer is an interruption', async t => {
  const f = await setup(t);
  await f.app.rpc('computer.pair', { link: f.node.pairing().link });
  await until(() => f.app.state().computer.state === 'online');
  const bot = await f.app.rpc('bot.create', { name: 'Programador', ...selection, home: 'pc', access: 'full' });

  const cancelled = await f.app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'espera' });
  await until(() => f.app.db.task(cancelled.taskId).state === 'running');
  await f.app.rpc('task.cancel', { taskId: cancelled.taskId });
  assert.equal(f.app.db.task(cancelled.taskId).state, 'cancelled');

  const interrupted = await f.app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'espera de novo' });
  await until(() => f.app.db.task(interrupted.taskId).state === 'running');
  await f.node.close();
  await until(() => f.app.db.task(interrupted.taskId).state === 'failed');
  assert.match(f.app.db.task(interrupted.taskId).error, /computador desconectou/);
  await until(() => f.app.state().presence[bot.id].online === false);

  const waiting = await f.app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi' });
  await f.restartNode();
  await until(() => f.app.db.task(waiting.taskId).state === 'done', 15000);
  assert.equal(f.app.state().presence[bot.id].online, true);

  // Forgetting the computer: its bots sleep again and the link does not come back.
  await f.app.rpc('computer.forget', {});
  assert.equal(f.app.state().computer.paired, false);
  await until(() => f.app.state().presence[bot.id].online === false);
});

test('a phone the computer does not know is refused', async t => {
  const f = await setup(t);
  await f.app.rpc('computer.pair', { link: f.node.pairing().link });
  await until(() => f.app.state().computer.state === 'online');
  // The computer forgets the phone (its list is cleared): the saved secret no longer opens the link.
  await f.node.close();
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(f.options.directory, 'phones.json'), '[]');
  await f.restartNode();
  await until(() => /não está pareado/.test(f.app.state().computer.error || ''), 15000);
  assert.equal(f.app.state().nodes[0].online, false);
});
