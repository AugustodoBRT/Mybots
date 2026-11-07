import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { Database, SCHEMA } from '../supervisor/database.mjs';
import { Tools } from '../supervisor/tools.mjs';
import { createSupervisor } from '../supervisor/index.mjs';
import runner from '../lib/codex-runner.cjs';
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }
async function setup(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-tools-')); const db = new Database(directory);
  const notifications = []; const tools = new Tools(db, { notify: async args => { notifications.push(args); return { notified: true }; }, ...options });
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = db.create({ name: 'Lua', autonomy: 'local' }, selection);
  const task = db.start(db.enqueue(bot.id, randomUUID(), 'Oi', selection).id);
  const controller = new AbortController(); const capability = tools.open(task, controller.signal); const bridgeId = randomUUID(); tools.context(capability.token, bridgeId, true);
  const call = (tool, args, callId = randomUUID()) => tools.call(capability.token, { bridgeId, callId, tool, args });
  t.after(() => capability.close());
  return { directory, db, tools, bot, task, controller, capability, bridgeId, call, notifications };
}

test('same tool grants differ by bot, memory is private, paths/identity overrides are rejected', async t => {
  const f = await setup(t); const second = f.db.create({ name: 'Outro' }, selection);
  f.tools.grant(f.bot.id, 'memory.read', true); f.tools.grant(f.bot.id, 'memory.write', true);
  await f.call('memory.write', { key: 'aula', text: 'Matemática' });
  assert.equal((await f.call('memory.read', {})).memories[0].text, 'Matemática');
  const task = f.db.start(f.db.enqueue(second.id, randomUUID(), 'Oi', selection).id); const cap = f.tools.open(task); const bridgeId = randomUUID(); f.tools.context(cap.token, bridgeId, true);
  assert.deepEqual((await f.tools.call(cap.token, { bridgeId, callId: randomUUID(), tool: 'memory.read', args: {} })).memories, []);
  f.tools.grant(second.id, 'memory.read', true);
  assert.deepEqual((await f.tools.call(cap.token, { bridgeId, callId: randomUUID(), tool: 'memory.read', args: {} })).memories, []);
  await assert.rejects(f.call('memory.read', { botId: f.bot.id }), /argumento/);
  await assert.rejects(f.call('file.read', { path: '../secrets/token' }), /permitido/); cap.close();
});

test('mandate and code approvals still verify the action hash and can be consumed only once', async t => {
  const f = await setup(t); const run = [...f.tools.runs.values()][0];
  const waiting = f.tools.ask(run, 'phone.fill_code', { summary: 'Código sem identificação do site' }, 'action-hash', null, null);
  const approval = f.db.get("SELECT * FROM approvals WHERE state='pending'");
  assert.throws(() => f.tools.respond(approval.id, true, 'changed'), /mudou/);
  f.tools.respond(approval.id, false, approval.action_hash);
  assert.equal(await waiting, false);
  assert.throws(() => f.tools.respond(approval.id, true, approval.action_hash), /expirou/);
  const id = randomUUID(); await f.call('memory.write', { key: 'a', text: 'b' }, id);
  await f.call('memory.write', { key: 'a', text: 'b' }, id);
  assert.equal(f.db.all('SELECT * FROM memory').length, 1);
  await assert.rejects(f.call('memory.write', { key: 'a', text: 'c' }, id), /argumentos/);
});

test('approval timeout and cancelling a run resolve pending requests without executing them', async t => {
  const f = await setup(t, { approvalMs: 30 }); const run = [...f.tools.runs.values()][0];
  assert.throws(() => f.db.configure(f.bot.id, selection, {}), /Aguarde/);
  assert.equal(await f.tools.ask(run, 'phone.fill_code', { summary: 'Código' }, 'first', null, null), false);
  const pending = f.tools.ask(run, 'phone.fill_code', { summary: 'Código' }, 'second', null, null);
  f.controller.abort(); assert.equal(await pending, false);
  assert.equal(f.db.all("SELECT * FROM approvals WHERE state='pending'").length, 0);
  await assert.rejects(f.call('memory.write', { key: 'a', text: 'b' }), /encerrada/);
});

test('run token is single-connection, revoked at completion, never exposes secrets or host tools', async t => {
  const f = await setup(t); await writeFile(join(f.directory, 'secrets', 'password'), 'VERY_PRIVATE');
  assert.throws(() => f.tools.context(f.capability.token, randomUUID(), true), /já foi usada/);
  f.tools.grant(f.bot.id, 'memory.read', true);
  const result = await f.call('memory.read', { key: '../../secrets/password' }); assert.deepEqual(result.memories, []);
  const args = runner.chatArguments('/tmp/output', selection, { entry: '/runtime/mcp/index.mjs' });
  for (const flag of ['shell_tool','unified_exec','apps','plugins','hooks','browser_use','computer_use','view_image','multi_agent']) assert.ok(args.some((item, i) => item === '--disable' && args[i + 1] === flag));
  assert.ok(!JSON.stringify(args).includes(f.capability.token)); assert.ok(!JSON.stringify(f.db.snapshot()).includes('VERY_PRIVATE'));
  f.capability.close(); await assert.rejects(f.call('memory.read', {}), /encerrada/);
});

test('memory, local items, grants and avatars survive backup restore and database version upgrade', async t => {
  const f = await setup(t); f.tools.grant(f.bot.id, 'memory.write', true); f.tools.grant(f.bot.id, 'task.create_item', true);
  await f.call('memory.write', { key: 'nome', text: 'Augusto' }); await f.call('task.create_item', { title: 'Estudar', details: 'Capítulo 2' });
  f.capability.close(); f.db.finish(f.task.id, 'cancelled');
  f.db.configure(f.bot.id, selection, { avatar: 'cat', autonomy: 'ask' });
  const snapshot = f.db.snapshot(); const file = f.db.backup();
  const invalid = structuredClone(snapshot); invalid.toolsState.grants[0].bot_id = randomUUID(); assert.throws(() => f.db.restore(invalid));
  f.db.run('DELETE FROM memory'); f.db.run('DELETE FROM pending_items'); f.db.restore(JSON.parse(await readFile(file.path, 'utf8')));
  assert.equal(f.db.all('SELECT * FROM memory').length, 1); assert.equal(f.db.all('SELECT * FROM pending_items').length, 1); assert.equal(f.db.bot(f.bot.id).avatar, 'cat'); assert.equal(f.db.get("PRAGMA user_version").user_version, SCHEMA);
});

test('real stdio MCP handshake routes through HTTP and UI approval response without blocking state reads', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-mcp-')); const app = await createSupervisor({ directory, port: 0, codex });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = app.db.create({ name: 'MCP' }, selection); app.tools.grant(bot.id, 'task.create_item', true);
  const task = app.db.start(app.db.enqueue(bot.id, randomUUID(), 'Criar', selection).id); const cap = app.tools.open(task);
  const child = spawn(process.execPath, [new URL('../supervisor/mcp/index.mjs', import.meta.url).pathname], { env: { ...process.env, MYBOTS_RUN_TOKEN: cap.token, MYBOTS_RUN_ENDPOINT: `http://127.0.0.1:${app.port}` }, stdio: ['pipe','pipe','pipe'] });
  t.after(() => { cap.close(); child.kill(); }); child.stdout.setEncoding('utf8'); let buffer = ''; const replies = [];
  child.stdout.on('data', chunk => { buffer += chunk; let i; while ((i = buffer.indexOf('\n')) >= 0) { replies.push(JSON.parse(buffer.slice(0, i))); buffer = buffer.slice(i + 1); } });
  const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  send(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1' } }); await until(() => replies.some(r => r.id === 1)); assert.equal(replies[0].result.serverInfo.name, 'mybots-tools');
  send(2, 'tools/list'); await until(() => replies.some(r => r.id === 2)); assert.equal(replies.find(r => r.id === 2).result.tools.length, 52);
  send(3, 'tools/call', { name: 'task_create_item', arguments: { title: 'Estudar' } });
  await until(() => replies.some(r => r.id === 3)); assert.equal(replies.find(r => r.id === 3).result.isError, undefined); assert.equal(app.db.all('SELECT * FROM pending_items').length, 1);
  assert.ok(!JSON.stringify(app.state()).includes(cap.token));
});

test('only features known to the installed Codex are disabled, and a Codex that cannot disable the shell is refused', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-features-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const args = runner.chatArguments('/tmp/output', selection, undefined, new Set(['shell_tool', 'apps']));
  assert.ok(args.includes('shell_tool') && args.includes('apps') && !args.includes('unified_exec') && !args.includes('skip_host_skill_discovery'));
  const old = join(directory, 'codex-old');
  await writeFile(old, `#!${process.execPath}\nif(process.argv[2]==='features'){console.log('apps stable true');process.exit(0);}process.exit(1);`, { mode: 0o700 });
  await assert.rejects(runner.runReply(selection, 'Oi', { binary: old }), /desligar o terminal/);
});

test('changing a grant starts a new model session so the bot learns about its new access', async t => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { createSupervisor } = await import('../supervisor/index.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'mybots-grant-session-'));
  const app = await createSupervisor({ directory, port: 0, codex: { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ model: 'test', displayName: 'T', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = app.db.create({ name: 'Lua' }, { model: 'test', reasoningEffort: 'low' });
  const session = randomUUID(); app.db.session(bot.id, session);
  app.tools.grant(bot.id, 'memory.read', false);
  assert.equal(app.db.bot(bot.id).codexSessionId, session, 'sem mudança real, a sessão continua');
  app.tools.grant(bot.id, 'memory.read', true);
  assert.equal(app.db.bot(bot.id).codexSessionId, undefined);
});

test('a message sent while the bot works reaches the running turn with its next tool result, once, and is not left waiting', async t => {
  const f = await setup(t);
  const messageOf = id => f.db.message(f.db.task(id).message_id);
  // The person writes twice while the turn runs (the app marks them live), the second with a file.
  const one = f.db.enqueue(f.bot.id, randomUUID(), 'Pula essa vaga e vai para a próxima', selection, { live: true });
  const two = f.db.enqueue(f.bot.id, randomUUID(), 'Use o currículo novo', selection, { live: true, attachments: [{ id: randomUUID(), name: 'curriculo.pdf', mime: 'application/pdf', size: 10 }] });
  assert.equal(messageOf(one.id).status, 'pending');
  const first = f.tools.withLive(f.capability.token, { ok: true });
  assert.equal(first.ok, true);
  assert.match(first.mensagem_da_pessoa, /MENSAGEM DA PESSOA.*"Pula essa vaga e vai para a próxima".*"Use o currículo novo".*curriculo\.pdf/s);
  assert.match(first.mensagem_da_pessoa, /responda a ela no final/);
  for (const task of [one, two]) { assert.equal(f.db.task(task.id).state, 'done'); assert.equal(messageOf(task.id).status, 'complete'); assert.equal(messageOf(task.id).delivered, 'live'); }
  // Nothing is delivered twice, and a picture result keeps its picture and gets the note after it.
  assert.deepEqual(f.tools.withLive(f.capability.token, { ok: true }), { ok: true });
  const three = f.db.enqueue(f.bot.id, randomUUID(), 'E também confira o prazo', selection, { live: true });
  const picture = f.tools.withLive(f.capability.token, { mcpContent: [{ type: 'text', text: 'tela' }, { type: 'image', data: 'AA==', mimeType: 'image/jpeg' }] });
  assert.equal(picture.mcpContent.length, 3); assert.match(picture.mcpContent[2].text, /confira o prazo/); assert.equal(f.db.task(three.id).state, 'done');
  // A message that was not sent live (the bot was idle) keeps waiting for its own turn; a turn of another bot never receives it.
  const normal = f.db.enqueue(f.bot.id, randomUUID(), 'Mensagem normal', selection);
  assert.deepEqual(f.tools.withLive(f.capability.token, { ok: 1 }), { ok: 1 }); assert.equal(f.db.task(normal.id).state, 'queued');
  assert.deepEqual(f.db.takeLive(f.bot.id, randomUUID()), [], 'an unknown or finished turn takes nothing');
  assert.ok(f.db.all("SELECT 1 FROM activity WHERE kind='live_message'").length >= 2);
});

test('chat.send marks a message live only while a private turn of that bot is running; an idle bot takes it as a normal turn', async t => {
  const { SupervisorClient } = await import('../mobile/supervisor-client.js');
  const { default: WS } = await import('../supervisor/node_modules/ws/wrapper.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'mybots-live-')); let release; const gate = new Promise(resolve => { release = resolve; });
  const app = await createSupervisor({ directory, port: 0, codex, execute: async bot => { await gate; return { text: 'pronto', codexSessionId: bot.codexSessionId || randomUUID(), ...selection }; } });
  const client = new SupervisorClient({ WebSocketClass: WS }); await client.connect({ port: app.port, token: app.token });
  t.after(async () => { release(); client.close(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await client.call('bot.create', { name: 'Vivo', ...selection });
  const first = await client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'primeira' });
  assert.equal(app.db.message(first.messageId).live, undefined, 'the bot was idle: a normal turn');
  await until(() => app.db.task(first.taskId).state === 'running');
  const second = await client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'segunda, enquanto trabalha' });
  assert.equal(app.db.message(second.messageId).live, true);
  assert.equal(app.db.task(second.taskId).state, 'queued', 'waits only if the turn ends before a tool result carries it');
  release();
  await until(() => app.db.task(first.taskId).state === 'done');
  await until(() => app.db.task(second.taskId).state === 'done');
});

test('an argument a tool does not take is named in the error, with the ones it does take, and is not mistaken for a missing permission', async t => {
  const f = await setup(t);
  await assert.rejects(f.call('team.create_bot', { name: 'Caça', instructions: 'x', model: 'gpt', personality: 'y' }), error => /não aceita "model", "personality"/.test(error.message) && /aceitos são: name, instructions, color, avatar, access, home/.test(error.message) && /Não é falta de permissão/.test(error.message));
  await assert.rejects(f.call('memory.read', { botId: f.bot.id }), /argumento/);
  await assert.rejects(f.call('coisa.inexistente', {}), /^Error: Ferramenta ou argumento não permitido\.$/);
});

test('a bot can delete its own memories that became useless, only its own, and learns when there was nothing to delete', async t => {
  const f = await setup(t); const other = f.db.create({ name: 'Outro' }, selection);
  f.tools.grant(f.bot.id, 'memory.read', true); f.tools.grant(f.bot.id, 'memory.write', true);
  await f.call('memory.write', { key: 'velha', text: 'não serve mais' }); await f.call('memory.write', { key: 'boa', text: 'vale' });
  // Memory of another bot with the same key stays.
  f.db.run('INSERT INTO memory VALUES(?,?,?,?)', other.id + ':velha', other.id, JSON.stringify({ key: 'velha', text: 'do outro' }), new Date().toISOString());
  // Deleting needs no grant of its own (it is on by default, like updating the pending items).
  assert.deepEqual(await f.call('memory.delete', { key: 'velha' }), { deleted: true, key: 'velha' });
  assert.deepEqual((await f.call('memory.read', {})).memories.map(item => item.key), ['boa']);
  const missing = await f.call('memory.delete', { key: 'velha' });
  assert.equal(missing.deleted, false); assert.match(missing.message, /memory_read/);
  assert.equal(f.db.get('SELECT count(*) AS n FROM memory WHERE bot_id=?', other.id).n, 1, 'the other bot keeps its own');
  await assert.rejects(f.call('memory.delete', { key: 'boa', botId: other.id }), /argumento/);
  await assert.rejects(f.call('memory.delete', {}), /Preencha/);
});

test('new session: the IA session is forgotten, the conversation and memories stay, a line says where it began, and the next prompt is the short one', async t => {
  const f = await setup(t);
  const session = randomUUID(); f.db.session(f.bot.id, session);
  assert.equal(f.db.requireBot(f.bot.id).codexSessionId, session);
  f.db.run('INSERT INTO memory VALUES(?,?,?,?)', f.bot.id + ':fica', f.bot.id, JSON.stringify({ key: 'fica', text: 'vale' }), new Date().toISOString());
  f.db.newSession(f.bot.id, 'Nova sessão da IA iniciada a pedido da pessoa.');
  assert.equal(f.db.requireBot(f.bot.id).codexSessionId, undefined);
  assert.equal(f.db.get('SELECT count(*) AS n FROM codex_sessions WHERE bot_id=?', f.bot.id).n, 0);
  assert.equal(f.db.get('SELECT count(*) AS n FROM memory WHERE bot_id=?', f.bot.id).n, 1);
  const last = f.db.page({ botId: f.bot.id, limit: 5 }).messages.at(-1);
  assert.equal(last.role, 'system'); assert.match(last.text, /Nova sessão/);
  assert.ok(f.db.get('SELECT 1 FROM metadata WHERE key=?', 'session.compact.' + f.bot.id));
  const { promptFor } = await import('../mobile/local.js');
  const withoutSession = { ...f.db.requireBot(f.bot.id), messages: f.db.page({ botId: f.bot.id, limit: 50 }).messages };
  const short = promptFor(withoutSession, f.db.page({ botId: f.bot.id, limit: 50 }).messages.find(item => item.role === 'user').id, { tools: true, maxChars: 24000 });
  assert.match(short, /sessão nova.*memory_read/s); assert.doesNotMatch(short, /Nova sessão da IA iniciada/, 'the line is not part of what the person said');
});

test('context estimate: tokens of the last turn over its calls, and the answers since the session began', async t => {
  const f = await setup(t);
  assert.deepEqual(f.db.contextLoad(f.bot.id), { estimate: 0, turns: 0 });
  // A turn of 5 model calls (4 tools) that counted 1,000,000 tokens: about 200,000 per call, 260,000 with the growth.
  for (let index = 0; index < 4; index++) f.db.record('tool_done', 'Navegador: ler página: concluído.', f.bot.id, f.task.id);
  f.db.run('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)', randomUUID(), f.bot.id, f.task.id, 'codex', 'm', 100000, 900000, 5000, new Date().toISOString());
  const load = f.db.contextLoad(f.bot.id);
  assert.equal(load.estimate, 260000); assert.equal(load.turns, 1);
  f.db.newSession(f.bot.id, 'x');
  assert.equal(f.db.contextLoad(f.bot.id).turns, 0, 'the count starts again with the new session');
});

test('a session that grew too much is replaced before the next turn, and /clear-style new session is refused while the bot works', async t => {
  const { SupervisorClient } = await import('../mobile/supervisor-client.js');
  const { default: WS } = await import('../supervisor/node_modules/ws/wrapper.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'mybots-rotate-')); const seen = []; let release = null;
  const app = await createSupervisor({ directory, port: 0, codex, execute: async (bot, prompt) => { seen.push({ session: bot.codexSessionId, prompt }); if (release) await release; return { text: 'ok', codexSessionId: randomUUID(), ...selection }; } });
  const client = new SupervisorClient({ WebSocketClass: WS }); await client.connect({ port: app.port, token: app.token });
  t.after(async () => { client.close(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await client.call('bot.create', { name: 'Longa', ...selection });
  const done = async text => { const sent = await client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text }); await until(() => app.db.task(sent.taskId).state === 'done'); return sent; };
  await done('primeira'); await done('segunda');
  assert.equal(seen[1].session, app.db.requireBot(bot.id).codexSessionId ? seen[1].session : undefined); assert.ok(seen[1].session, 'the second turn resumes the first session');
  // The last turn looked huge: the next one starts a new session, short prompt, and says so in the chat.
  const lastTask = app.db.all('SELECT id FROM tasks WHERE bot_id=? ORDER BY created_at DESC, rowid DESC', bot.id)[0].id;
  app.db.run('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)', randomUUID(), bot.id, lastTask, 'codex', 'test', 100000, 400000, 100, new Date().toISOString());
  await done('terceira');
  assert.equal(seen[2].session, undefined, 'the session was replaced'); assert.match(seen[2].prompt, /sessão nova/);
  assert.ok(app.db.page({ botId: bot.id, limit: 30 }).messages.some(item => item.role === 'system' && /iniciada sozinha para economizar contexto/.test(item.text)));
  await done('quarta'); assert.ok(seen[3].session, 'and the new one is resumed again');
  // While the bot works the command is refused; after, it starts a new session.
  let open; release = new Promise(resolve => { open = resolve; });
  const busy = await client.call('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'devagar' }); await until(() => app.db.task(busy.taskId).state === 'running');
  await assert.rejects(client.call('bot.newSession', { botId: bot.id }), /Espere o bot terminar/);
  open(); await until(() => app.db.task(busy.taskId).state === 'done'); release = null;
  await client.call('bot.newSession', { botId: bot.id });
  await done('depois do clear'); assert.equal(seen.at(-1).session, undefined);
});
