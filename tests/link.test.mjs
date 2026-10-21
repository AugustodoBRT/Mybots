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
  const options = { directory: pcDir, port, uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], execute: computerIA, status: async () => ({ connections: { codex: { available: true, loggedIn: true }, claude: { loggedIn: false } }, models: [] }) };
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

test('a turn on the computer tells the IA it runs there; without the permission it never claims to save there', async () => {
  const { default: claude } = await import('../lib/claude-runner.cjs');
  const { default: codex } = await import('../lib/codex-runner.cjs');
  const tools = { endpoint: 'http://127.0.0.1:1', token: 'x', entry: '/tmp/entry.mjs', device: 'augusto' };
  const claudeArgs = claude.claudeArguments({ model: 'haiku' }, randomUUID(), tools);
  assert.match(claudeArgs[claudeArgs.indexOf('--append-system-prompt') + 1], /computador "augusto".*Nunca diga que salvou algo numa pasta/);
  assert.match(codex.chatArguments('/tmp/out', { model: 'test' }, tools).join(' '), /computador \\"augusto\\"/);
  assert.doesNotMatch(claude.claudeArguments({ model: 'haiku' }, randomUUID(), { ...tools, device: undefined }).join(' '), /computador "/);
});

test('"Mexer no computador": the bot works in ~/MyBots/<name>; keys stay out; commands follow the level; risky ones always ask', async t => {
  const phoneDir = await mkdtemp(join(tmpdir(), 'mybots-phone-')); const pcDir = await mkdtemp(join(tmpdir(), 'mybots-pc-')); const projects = join(pcDir, 'MyBots');
  const seen = []; let script = [];
  const execute = async (bot, prompt, { tools, onSession }) => {
    seen.push({ computer: tools.computer, workspace: tools.computer?.workspace });
    const call = async (body, session) => { const response = await fetch(tools.endpoint + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(body) }); return { session: response.headers.get('mcp-session-id'), body: await response.json() }; };
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    const answers = [];
    for (const [name, input] of script) answers.push(JSON.parse((await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'permission', arguments: { tool_name: name, input } } }, init.session)).body.result.content[0].text).behavior);
    const id = randomUUID(); await onSession(id);
    return { text: answers.join(','), ...selection, codexSessionId: id };
  };
  const app = await createSupervisor({ directory: phoneDir, port: 0, codex, approvalMs: 5000, execute: async () => { throw new Error('não roda no celular'); } });
  const node = await createNode({ directory: pcDir, port: await freePort(), uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], projects, execute, status: async () => ({ connections: { codex: { loggedIn: true } }, models: [] }) });
  t.after(async () => { await app.close(); await node.close(); await rm(phoneDir, { recursive: true, force: true }); await rm(pcDir, { recursive: true, force: true }); });
  await app.rpc('computer.pair', { link: node.pairing().link });
  const ask = async (bot, steps) => { script = steps; const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'faz' }); await until(() => ['done', 'failed'].includes(app.db.task(sent.taskId).state)); return app.db.bot(bot.id).messages.at(-1).text; };

  const full = await app.rpc('bot.create', { name: 'Dev/Total', ...selection, home: 'pc', access: 'full' });
  assert.equal(await ask(full, [['Bash', { command: 'npm test' }], ['Read', { file_path: '/home/a/.ssh/id_ed25519' }], ['Bash', { command: 'cat ~/.ssh/id_rsa' }], ['Write', { file_path: '/home/a/nota.txt', content: 'oi' }]]), 'allow,deny,deny,allow');
  assert.equal(seen.at(-1).workspace, join(projects, 'Dev Total'));
  // A risky command asks even on Acesso total, without "Sempre permitir".
  script = [['Bash', { command: 'sudo pacman -Syu' }]];
  let sent = await app.rpc('chat.send', { botId: full.id, requestId: randomUUID(), text: 'atualiza' });
  await until(() => app.state().approvals.length === 1);
  const approval = app.state().approvals[0];
  assert.equal(approval.title, 'Rodar um comando no computador'); assert.match(approval.summary, /sudo pacman -Syu/); assert.equal(approval.canAlways, false);
  await app.rpc('approval.respond', { approvalId: approval.id, actionHash: approval.actionHash, approved: false });
  await until(() => app.db.task(sent.taskId).state === 'done');
  assert.equal(app.db.bot(full.id).messages.at(-1).text, 'deny');

  // Médio: the first command asks; "Sempre permitir" covers the next ones, not file writes.
  const ask2 = await app.rpc('bot.create', { name: 'Dev', ...selection, home: 'pc', access: 'ask' });
  script = [['Bash', { command: 'ls' }], ['Bash', { command: 'python3 x.py' }], ['Edit', { file_path: '/etc/hosts' }]];
  sent = await app.rpc('chat.send', { botId: ask2.id, requestId: randomUUID(), text: 'roda' });
  await until(() => app.state().approvals.length === 1);
  let card = app.state().approvals[0]; assert.equal(card.canAlways, true);
  await app.rpc('approval.respond', { approvalId: card.id, actionHash: card.actionHash, approved: true, always: true });
  await until(() => app.state().approvals.length === 1 && app.state().approvals[0].id !== card.id);
  card = app.state().approvals[0]; assert.equal(card.title, 'Mexer num arquivo fora da pasta do bot');
  await app.rpc('approval.respond', { approvalId: card.id, actionHash: card.actionHash, approved: false });
  await until(() => app.db.task(sent.taskId).state === 'done');
  assert.equal(app.db.bot(ask2.id).messages.at(-1).text, 'allow,allow,deny');

  // Pouco acesso: the computer stays closed (and the IA is told so).
  const basic = await app.rpc('bot.create', { name: 'Leitor', ...selection, home: 'pc', access: 'basic' });
  assert.equal(await ask(basic, [['Bash', { command: 'ls' }]]), 'deny');
  assert.equal(seen.at(-1).computer, false);
});

test('the MyBots window on the computer: page only on localhost, checked origin, the phone answers its methods and events, files land in Downloads', async t => {
  const { SupervisorClient } = await import('../mobile/supervisor-client.js');
  const { default: WS } = await import('../supervisor/node_modules/ws/index.js');
  const { writeFileSync, mkdirSync, readFileSync } = await import('node:fs');
  const phoneDir = await mkdtemp(join(tmpdir(), 'mybots-phone-')); const pcDir = await mkdtemp(join(tmpdir(), 'mybots-pc-'));
  const uiRoot = join(pcDir, 'ui'); mkdirSync(uiRoot); writeFileSync(join(uiRoot, 'index.html'), '<html><head><title>MyBots</title></head><body></body></html>');
  const app = await createSupervisor({ directory: phoneDir, port: 0, codex, execute: async bot => ({ text: 'oi', ...selection, codexSessionId: randomUUID() }) });
  const node = await createNode({ directory: pcDir, port: await freePort(), uiPort: 0, uiRoot, downloads: join(pcDir, 'Downloads'), host: '127.0.0.1', advertise: () => ['127.0.0.1'], status: async () => ({ connections: {}, models: [] }) });
  let client;
  t.after(async () => { client?.close(); await app.close(); await node.close(); await rm(phoneDir, { recursive: true, force: true }); await rm(pcDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${node.uiPort}`;
  assert.equal((await fetch(base + '/health').then(r => r.json())).phone, false);
  const page = await fetch(base + '/').then(r => r.text());
  const desktop = JSON.parse(/window\.MYBOTS_DESKTOP=(\{.*?\})<\/script>/.exec(page)[1]);
  assert.equal(desktop.port, node.uiPort);
  // A site that rebinds its name to 127.0.0.1 sends another Host: refused.
  const { request } = await import('node:http');
  const status = await new Promise(resolve => request({ host: '127.0.0.1', port: node.uiPort, path: '/', headers: { Host: 'evil.example:' + node.uiPort } }, response => resolve(response.statusCode)).end());
  assert.equal(status, 403);
  // A page from elsewhere (other Origin) cannot open the socket.
  const rejected = await new Promise(resolve => { const ws = new WS(`ws://127.0.0.1:${node.uiPort}`, { origin: 'https://evil.example' }); ws.on('close', code => resolve(code)); ws.on('error', () => resolve('error')); });
  assert.equal(rejected, 1008);

  class Origin extends WS { constructor(url) { super(url, { origin: base }); } }
  const events = [];
  client = new SupervisorClient({ WebSocketClass: Origin, onEvent: event => events.push(event) });
  await client.connect({ port: node.uiPort, token: desktop.token });
  await assert.rejects(client.call('bots.list'), /fora de alcance/);
  await app.rpc('computer.pair', { link: node.pairing().link });
  await until(async () => (await client.call('desktop.status')).phone);
  const bot = await client.call('bot.create', { name: 'Pelo PC', ...selection });
  assert.ok((await client.call('bots.list')).some(item => item.id === bot.id));
  await until(() => events.includes('activity.new'));
  await assert.rejects(client.call('backup.export'), /só pode ser feito no celular/);
  await assert.rejects(client.call('secrets.unlock', { key: 'x' }), /só pode ser feito no celular/);
  const sent = await client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi do computador' });
  await until(() => app.db.task(sent.taskId).state === 'done');

  const file = app.tools.attachments.store(bot.id, { name: 'nota.txt', mime: 'text/plain', bytes: Buffer.from('feito no celular') });
  const saved = await client.call('desktop.file', { id: file.id, name: 'nota.txt', action: 'save' });
  assert.equal(saved.path, join(pcDir, 'Downloads', 'nota.txt')); assert.equal(readFileSync(saved.path, 'utf8'), 'feito no celular');
  assert.equal((await client.call('desktop.file', { id: file.id, name: 'nota.txt', action: 'save' })).path, join(pcDir, 'Downloads', 'nota (2).txt'));
});
