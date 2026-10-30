import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createSupervisor } from '../supervisor/index.mjs';
import { createNode } from '../pc/server.mjs';
import { createSocket } from 'node:dgram';
import { discover, broadcastTargets, privateAddress, tailscaleAddress } from '../supervisor/discovery.mjs';
import { discoveryHandler } from '../pc/discovery.mjs';
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
  const options = { directory: pcDir, port, uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], discoveryPort: 0, discoveryLoopback: true, execute: computerIA, status: async () => ({ connections: { codex: { available: true, loggedIn: true }, claude: { loggedIn: false } }, models: [] }) };
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
  assert.equal(f.app.db.messages(bot.id).at(-1).text, 'Programador no computador');
  assert.match(f.app.db.get('SELECT body FROM memory WHERE bot_id=?', bot.id).body, /escrito no computador/);
  assert.ok(f.app.db.bot(bot.id).codexSessionId);
  // An "any" bot answers on the phone without a computer session, and moves to a new session on the computer.
  const any = await f.app.rpc('bot.create', { name: 'Pesquisa', ...selection, home: 'any', access: 'full' });
  const there = await f.app.rpc('chat.send', { botId: any.id, requestId: randomUUID(), text: 'Oi' });
  await until(() => f.app.db.task(there.taskId).state === 'done');
  assert.equal(f.app.db.messages(any.id).at(-1).text, 'Pesquisa no computador');
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
  const ask = async (bot, steps) => { script = steps; const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'faz' }); await until(() => ['done', 'failed'].includes(app.db.task(sent.taskId).state)); return app.db.messages(bot.id).at(-1).text; };

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
  assert.equal(app.db.messages(full.id).at(-1).text, 'deny');

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
  assert.equal(app.db.messages(ask2.id).at(-1).text, 'allow,allow,deny');

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
  // The window draws the pairing QR itself; the code it carries is the one-use code the phone trades.
  const qr = await client.call('desktop.pair');
  assert.match(qr.svg, /^<svg/); assert.ok(readFileSync(join(pcDir, 'pairing.json'), 'utf8').includes('"code"'));
  const disconnected = await client.call('desktop.status');
  assert.equal(disconnected.lastPaired, null); assert.equal(disconnected.tailscale, false); assert.ok(disconnected.offlineSince);
  await app.rpc('computer.pair', { link: node.pairing().link });
  await until(async () => (await client.call('desktop.status')).phone);
  const connected = await client.call('desktop.status');
  assert.ok(connected.lastPaired); assert.equal(connected.offlineSince, null);
  const bot = await client.call('bot.create', { name: 'Pelo PC', ...selection });
  assert.ok((await client.call('bots.list')).some(item => item.id === bot.id));
  await until(() => events.includes('activity.new'));
  await assert.rejects(client.call('backup.export'), /só pode ser feito no celular/);
  await assert.rejects(client.call('secrets.unlock', { key: 'x' }), /só pode ser feito no celular/);
  const sent = await client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi do computador' });
  await until(() => app.db.task(sent.taskId).state === 'done');

  // A message sent on the phone shows up in the window live (its events come through the link).
  events.length = 0;
  const fromPhone = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi do celular' });
  await until(() => events.includes('task.done') && app.db.task(fromPhone.taskId).state === 'done');
  assert.ok((await client.call('chat.page', { botId: bot.id })).messages.some(message => message.text === 'Oi do celular'));
  // The messages themselves come with their events, so the window does not ask for the whole state for them.
  assert.ok(events.includes('message.added') && events.includes('message.updated') && events.includes('bot.updated'));
  // The window's token survives a restart of the node, so an open window just reconnects.
  assert.equal(readFileSync(join(pcDir, 'ui-token'), 'utf8'), desktop.token);

  const file = app.tools.attachments.store(bot.id, { name: 'nota.txt', mime: 'text/plain', bytes: Buffer.from('feito no celular') });
  const saved = await client.call('desktop.file', { id: file.id, name: 'nota.txt', action: 'save' });
  assert.equal(saved.path, join(pcDir, 'Downloads', 'nota.txt')); assert.equal(readFileSync(saved.path, 'utf8'), 'feito no celular');
  assert.equal((await client.call('desktop.file', { id: file.id, name: 'nota.txt', action: 'save' })).path, join(pcDir, 'Downloads', 'nota (2).txt'));
});

test('freed folders: ~ paths resolve on the computer; Claude gets --add-dir, Codex writable roots; keys and the other IA\'s login are hidden', async t => {
  const { computerFor, sandboxFor } = await import('../pc/server.mjs');
  const { default: claude } = await import('../lib/claude-runner.cjs');
  const { default: codex } = await import('../lib/codex-runner.cjs');
  const { mkdirSync } = await import('node:fs');
  const home = await mkdtemp(join(tmpdir(), 'mybots-home-')); t.after(() => rm(home, { recursive: true, force: true }));
  for (const path of ['vscodeProjects', '.ssh', '.codex', '.claude', 'MyBots/Dev']) mkdirSync(join(home, path), { recursive: true });
  const computer = computerFor({ folders: ['~/vscodeprojects', '~/nao-existe', '~/.ssh', '~'], full: false }, join(home, 'MyBots/Dev'), home);
  assert.deepEqual(computer.folders, [join(home, 'vscodeProjects')]);
  const tools = { endpoint: 'http://127.0.0.1:1', token: 'x', entry: '/tmp/e.mjs', device: 'pc', computer };
  const claudeArgs = claude.claudeArguments({ model: 'haiku' }, randomUUID(), tools);
  assert.equal(claudeArgs[claudeArgs.indexOf('--add-dir') + 1], join(home, 'vscodeProjects'));
  assert.match(claudeArgs[claudeArgs.indexOf('--append-system-prompt') + 1], /vscodeProjects.*pedem a sua aprovação|vscodeProjects/);
  const codexArgs = codex.chatArguments('/tmp/out', { model: 'test' }, tools);
  assert.ok(codexArgs.includes(`sandbox_workspace_write.writable_roots=${JSON.stringify([join(home, 'vscodeProjects')])}`));
  assert.ok(codexArgs.includes(`sandbox_workspace_write.writable_roots=${JSON.stringify([home])}`) === false);
  // Acesso total: the whole home is writable (keys stay hidden by the sandbox).
  const full = codex.chatArguments('/tmp/out', { model: 'test' }, { ...tools, computer: computerFor({ folders: [], full: true }, join(home, 'MyBots/Dev'), home) });
  assert.ok(full.includes(`sandbox_workspace_write.writable_roots=${JSON.stringify([home])}`));
  const forCodex = sandboxFor('codex', home, '/usr/bin/bwrap');
  assert.deepEqual(forCodex.slice(0, 5), ['/usr/bin/bwrap', '--dev-bind', '/', '/', '--die-with-parent']);
  assert.ok(forCodex.includes(join(home, '.ssh')) && forCodex.includes(join(home, '.claude')) && !forCodex.includes(join(home, '.codex')));
  assert.ok(sandboxFor('claude', home, '/usr/bin/bwrap').includes(join(home, '.codex')));
  assert.equal(sandboxFor('codex', home, null), null);
});

test('a bot\'s freed folders are checked on the phone: never the whole home or a folder of keys', async t => {
  const phoneDir = await mkdtemp(join(tmpdir(), 'mybots-phone-'));
  const app = await createSupervisor({ directory: phoneDir, port: 0, codex });
  t.after(async () => { await app.close(); await rm(phoneDir, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Dev', ...selection, home: 'pc' });
  assert.deepEqual((await app.rpc('bot.update', { botId: bot.id, folders: ['~/vscodeProjects'] })).folders, ['~/vscodeProjects']);
  for (const folders of [['~'], ['~/.ssh'], ['/'], ['../x'], ['relativa']]) await assert.rejects(app.rpc('bot.update', { botId: bot.id, folders }), /até 10 pastas/);
});


async function lostAddress(f) {
  const target = f.app.link.saved();
  f.app.link.drop();
  await until(() => f.app.state().nodes.every(node => !node.online));
  f.app.link.save({ ...target, port: await freePort(), addresses: ['127.0.0.2'] });
  f.app.link.discoveryTargets = ['127.0.0.1']; f.app.link.discoveryPort = f.node.discoveryPort; f.app.link.discoveryTimeout = 100;
  f.app.link.set('offline');
  return target;
}

test('local discovery restores a paired PC with an obsolete address and preserves the pinned identity', async t => {
  const f = await setup(t);
  await f.app.rpc('computer.pair', { link: f.node.pairing().link });
  await until(() => f.app.state().computer.state === 'online');
  const target = await lostAddress(f);
  await f.app.link.connect();
  await until(() => f.app.state().computer.state === 'online');
  const saved = f.app.link.saved();
  assert.equal(saved.addresses[0], '127.0.0.1'); assert.equal(saved.port, f.node.port);
  assert.equal(saved.secret, target.secret); assert.equal(saved.fingerprint, target.fingerprint);
  assert.equal(f.app.state().computer.tailscale, false);
  // Foreground discovery is throttled, and no old socket callback can overwrite the new connection.
  const last = f.app.link.lastDiscovery; f.app.link.kick(); assert.equal(f.app.link.lastDiscovery, last);
});

test('discovery only answers private senders for its identity, bounds packets and rate limits responses', async t => {
  let time = 0; const replies = [];
  const handler = discoveryHandler({ id: 'pc-test', port: 3230, addresses: () => ['192.168.1.10'], send: (...args) => replies.push(args), now: () => time });
  const question = Buffer.from(JSON.stringify({ t: 'mybots?', id: 'pc-test' }));
  for (const [bytes, address] of [[question, '8.8.8.8'], [Buffer.alloc(513), '192.168.1.20'], [Buffer.from('{'), '192.168.1.20'], [Buffer.from('{"t":"mybots?","id":"other"}'), '192.168.1.20']]) handler(bytes, { address, port: 12345 });
  assert.equal(replies.length, 0);
  handler(question, { address: '192.168.1.20', port: 12345 }); handler(question, { address: '192.168.1.20', port: 12345 });
  assert.equal(replies.length, 1); assert.deepEqual(JSON.parse(replies[0][0]), { t: 'mybots', id: 'pc-test', port: 3230, addresses: ['192.168.1.10'] });
  assert.equal(replies[0][1], 12345); assert.equal(replies[0][2], '192.168.1.20');
  time = 2000; handler(question, { address: '192.168.1.20', port: 12345 }); assert.equal(replies.length, 2);
  assert.equal(privateAddress('172.31.1.2'), true); assert.equal(privateAddress('172.32.1.2'), false);
  assert.equal(tailscaleAddress('100.64.1.2'), true); assert.equal(tailscaleAddress('100.128.1.2'), false);
  assert.deepEqual(broadcastTargets({ wlan: [{ family: 'IPv4', internal: false, address: '192.168.4.7', netmask: '255.255.255.0' }], lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1', netmask: '255.0.0.0' }] }), ['255.255.255.255', '192.168.4.255']);
  // The actual UDP socket also ignores an incorrect id.
  const f = await setup(t);
  assert.deepEqual(await discover('wrong', { port: f.node.discoveryPort, targets: ['127.0.0.1'], timeout: 80 }), []);
});

test('forged discovery is refused by TLS and never replaces saved addresses; a later correct reply still connects', async t => {
  const f = await setup(t); const other = await setup(t);
  await f.app.rpc('computer.pair', { link: f.node.pairing().link }); await until(() => f.app.state().computer.state === 'online');
  const target = await lostAddress(f);
  const socket = createSocket('udp4'); await new Promise(resolve => socket.bind(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => socket.close(resolve)));
  let forged = true;
  socket.on('message', (bytes, remote) => {
    const correct = { t: 'mybots', id: target.id, port: f.node.port, addresses: ['127.0.0.1'] };
    const bad = { ...correct, port: other.node.port };
    socket.send(JSON.stringify(forged ? bad : correct), remote.port, remote.address);
  });
  f.app.link.discoveryPort = socket.address().port;
  await f.app.link.connect();
  assert.equal(f.app.link.state, 'offline'); assert.match(f.app.link.error, /Outro aparelho/);
  assert.deepEqual(f.app.link.saved().addresses, ['127.0.0.2']);
  assert.equal(f.app.link.saved().fingerprint, target.fingerprint);
  // Retry immediately with both a forged and a genuine answer; do not wait 15 seconds.
  clearTimeout(f.app.link.timer); f.app.link.timer = null; f.app.link.lastDiscovery = -Infinity; forged = false;
  socket.removeAllListeners('message'); socket.on('message', (bytes, remote) => {
    for (const port of [other.node.port, f.node.port]) socket.send(JSON.stringify({ t: 'mybots', id: target.id, port, addresses: ['127.0.0.1'] }), remote.port, remote.address);
  });
  f.app.link.kick(); await until(() => f.app.link.state === 'online');
  assert.equal(f.app.link.saved().port, f.node.port);
});

test('missing discovery explains reachability and foreground retries are throttled without losing pairing', async t => {
  const f = await setup(t);
  await f.app.rpc('computer.pair', { link: f.node.pairing().link }); await until(() => f.app.link.state === 'online');
  await lostAddress(f);
  f.app.link.discoveryTargets = []; f.app.link.discoveryTimeout = 20;
  await f.app.link.connect();
  assert.match(f.app.link.error, /Não achei o computador neste Wi-Fi.*Tailscale/);
  const last = f.app.link.lastDiscovery;
  f.app.link.kick(); await until(() => !f.app.link.connecting);
  assert.equal(f.app.link.lastDiscovery, last); assert.equal(f.app.link.status().paired, true);
  // Closing interrupts discovery immediately and must not schedule another retry.
  clearTimeout(f.app.link.timer); f.app.link.timer = null; f.app.link.lastDiscovery = -Infinity;
  f.app.link.discoveryTimeout = 5000;
  const pending = f.app.link.connect(true); f.app.link.close(); await pending;
  assert.equal(f.app.link.timer, null);
});

test('file_send of a path on the computer: only what the bot may reach there, in parts', async () => {
  const { botFilePart, computerFor } = await import('../pc/server.mjs');
  const { mkdirSync, writeFileSync, symlinkSync } = await import('node:fs');
  const home = await mkdtemp(join(tmpdir(), 'mybots-home-')); try {
    const work = join(home, 'MyBots/Dev'); mkdirSync(work, { recursive: true }); mkdirSync(join(home, '.ssh')); mkdirSync(join(home, '.cache'));
    writeFileSync(join(work, 'capa.png'), Buffer.alloc(7 * 1024 * 1024, 3)); writeFileSync(join(home, 'fora.txt'), 'x'); writeFileSync(join(home, '.ssh/id'), 'k'); writeFileSync(join(home, '.cache/a'), 'c');
    symlinkSync(join(home, '.ssh/id'), join(work, 'atalho'));
    const mine = computerFor({ folders: [], full: false }, work, home), full = computerFor({ folders: [], full: true }, work, home);
    let part = botFilePart(mine, 'capa.png', 0), total = 0;
    while (true) { total += Buffer.from(part.chunk, 'base64').length; if (part.next === null) break; part = botFilePart(mine, join(work, 'capa.png'), part.next); }
    assert.equal(total, 7 * 1024 * 1024); assert.equal(part.name, 'capa.png');
    assert.throws(() => botFilePart(mine, join(home, 'fora.txt')), /fora do que/);
    assert.throws(() => botFilePart(mine, 'atalho'), /fora do que/);
    assert.equal(botFilePart(full, join(home, 'fora.txt')).name, 'fora.txt');
    assert.throws(() => botFilePart(full, join(home, '.ssh/id')), /fora do que/);
    assert.throws(() => botFilePart(full, join(home, '.cache/a')), /fora do que/);
    assert.throws(() => botFilePart(false, 'capa.png'), /não pode mexer/);
  } finally { await rm(home, { recursive: true, force: true }); }
});
