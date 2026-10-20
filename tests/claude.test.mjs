import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import claudeRunner from '../lib/claude-runner.cjs';
import { selectionFor } from '../lib/models.mjs';

const codexSelection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...codexSelection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
const claude = { status: async () => ({ available: true, loggedIn: true, message: 'Claude conectado' }), models: async () => claudeRunner.CLAUDE_MODELS };
async function until(check) { for (let i = 0; i < 600; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

async function fakeClaude(t, { session } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-claude-fake-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'claude');
  await writeFile(binary, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const file = ${JSON.stringify(join(directory, 'calls.json'))};
  const calls = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  calls.push({ args, input }); fs.writeFileSync(file, JSON.stringify(calls));
  const id = ${JSON.stringify(session || '')} || value('--resume') || value('--session-id');
  console.log('aviso do proot em texto puro');
  console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: id, tools: [] }));
  if (input.includes('FALHE')) { console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', session_id: id })); process.exit(1); }
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'Resposta ' + calls.length, session_id: id }));
});`, { mode: 0o700 });
  return { binary, calls: async () => JSON.parse(await readFile(join(directory, 'calls.json'), 'utf8')) };
}

test('Claude catalog and selection keep providers apart and every model offers all effort levels', () => {
  const models = [{ ...codexSelection, provider: 'codex', isDefault: true, efforts: ['low'], defaultEffort: 'low' }, ...claudeRunner.CLAUDE_MODELS];
  assert.deepEqual(selectionFor(models), { provider: 'codex', model: 'test', reasoningEffort: 'low' });
  assert.deepEqual(selectionFor(models, { provider: 'claude' }), { provider: 'claude', model: 'opus', reasoningEffort: 'medium' });
  assert.deepEqual(selectionFor(models, { provider: 'claude', model: 'sonnet', reasoningEffort: 'max' }), { provider: 'claude', model: 'sonnet', reasoningEffort: 'max' });
  assert.throws(() => selectionFor(models, { provider: 'codex', model: 'opus' }), /não aparece/);
  assert.throws(() => selectionFor(models, { provider: 'claude', model: 'haiku', reasoningEffort: 'ultra' }), /raciocínio/);
  assert.throws(() => selectionFor(models.filter(item => item.provider === 'codex'), { provider: 'claude' }), /não está conectado/);
  for (const model of claudeRunner.CLAUDE_MODELS) assert.deepEqual(model.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
});

test('Claude arguments remove every built-in tool, ignore user settings and only allow mybots-tools', () => {
  const session = randomUUID();
  const args = claudeRunner.claudeArguments({ model: 'opus', reasoningEffort: 'high' }, session, { endpoint: 'http://127.0.0.1:9', token: 'a'.repeat(64) });
  const after = flag => args[args.indexOf(flag) + 1];
  assert.equal(after('--tools'), ''); assert.equal(after('--setting-sources'), ''); assert.equal(after('--session-id'), session);
  assert.ok(args.includes('--strict-mcp-config') && args.includes('--disable-slash-commands') && !args.includes('--resume'));
  assert.equal(after('--allowedTools'), 'mcp__mybots-tools'); assert.equal(after('--permission-prompts'), 'none');
  assert.ok(!args.some(item => /bypassPermissions|dangerously/.test(item)));
  assert.deepEqual(JSON.parse(after('--mcp-config')).mcpServers['mybots-tools'].url, 'http://127.0.0.1:9/mcp');
  assert.equal(after('--model'), 'opus'); assert.equal(after('--effort'), 'high');
  assert.equal(claudeRunner.claudeArguments({ codexSessionId: session }, session)[claudeRunner.claudeArguments({ codexSessionId: session }, session).indexOf('--resume') + 1], session);
  assert.ok(!claudeRunner.claudeArguments({}, session).includes('--mcp-config'));
});

test('Claude conversation keeps one session, resumes it, and switching IA starts a clean session with history', async t => {
  const fake = await fakeClaude(t);
  const directory = await mkdtemp(join(tmpdir(), 'mybots-claude-sup-'));
  const app = await createSupervisor({ directory, port: 0, codex, claude, execute: (bot, prompt, options) => bot.provider === 'claude' ? claudeRunner.runReply(bot, prompt, { ...options, binary: fake.binary }) : Promise.resolve({ text: 'Codex', codexSessionId: randomUUID(), model: bot.model, reasoningEffort: bot.reasoningEffort }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Lua', provider: 'claude', model: 'sonnet', reasoningEffort: 'low' });
  assert.equal(bot.provider, 'claude');
  for (const text of ['Lembre abacaxi', 'Qual palavra?']) {
    const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text });
    await until(() => ['done', 'failed'].includes(app.db.task(sent.taskId).state));
    assert.equal(app.db.task(sent.taskId).state, 'done', app.db.task(sent.taskId).error);
  }
  const calls = await fake.calls(); const session = app.db.bot(bot.id).codexSessionId;
  assert.equal(calls[0].args[calls[0].args.indexOf('--session-id') + 1], session);
  assert.equal(calls[1].args[calls[1].args.indexOf('--resume') + 1], session);
  assert.equal(calls[1].input, 'Qual palavra?'); assert.match(calls[0].input, /Lembre abacaxi/);
  assert.ok(calls[0].args.includes('--mcp-config'));
  assert.equal(app.db.bot(bot.id).messages.at(-1).model, 'sonnet');
  await app.rpc('bot.update', { botId: bot.id, provider: 'codex', model: 'test', reasoningEffort: 'low' });
  assert.equal(app.db.bot(bot.id).provider, 'codex'); assert.equal(app.db.bot(bot.id).codexSessionId, undefined);
  assert.equal(app.db.bot(bot.id).messages.length, 4);
  const failed = await app.rpc('bot.update', { botId: bot.id, provider: 'claude', model: 'opus', reasoningEffort: 'max' });
  assert.equal(failed.provider, 'claude');
  const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'FALHE agora' });
  await until(() => ['done', 'failed'].includes(app.db.task(sent.taskId).state));
  assert.match(app.db.task(sent.taskId).error, /\/login/);
  // The CLI confirmed the new session before failing, so the next message resumes it.
  const last = (await fake.calls()).at(-1).args; assert.equal(app.db.bot(bot.id).codexSessionId, last[last.indexOf('--session-id') + 1]);
});

test('a different session from Claude is refused, a missing CLI is explained, and a logged-out Claude blocks sending', async t => {
  const fake = await fakeClaude(t, { session: randomUUID() });
  await assert.rejects(claudeRunner.runReply({ model: 'opus' }, 'Oi', { binary: fake.binary }), /outra sessão/);
  await assert.rejects(claudeRunner.runReply({ model: 'opus' }, 'Oi', { binary: join(tmpdir(), 'nao-existe-' + randomUUID()) }), /não foi encontrado/);
  const directory = await mkdtemp(join(tmpdir(), 'mybots-claude-out-'));
  const app = await createSupervisor({ directory, port: 0, codex, claude: { status: async () => ({ available: true, loggedIn: false, message: 'Entre no Claude pelo terminal com claude e /login.' }), models: claude.models } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Sol', provider: 'claude', model: 'haiku' });
  await assert.rejects(app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi' }), /\/login/);
  assert.equal(app.state().connection.message, 'Codex conectado');
  assert.equal(app.state().connections.claude.loggedIn, false);
});

test('HTTP MCP endpoint is bound to one run, one session and the same grants and approvals as stdio', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-mcp-http-'));
  const app = await createSupervisor({ directory, port: 0, codex });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = app.db.create({ name: 'MCP' }, codexSelection); const other = app.db.create({ name: 'Outro' }, codexSelection);
  app.tools.grant(bot.id, 'task.create_item', true);
  const task = app.db.start(app.db.enqueue(bot.id, randomUUID(), 'Criar', codexSelection).id); const cap = app.tools.open(task);
  t.after(() => cap.close());
  const url = `http://127.0.0.1:${app.port}/mcp`;
  const post = (body, { token = cap.token, session, origin } = {}) => fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}), ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { token: 'b'.repeat(64) })).status, 403);
  assert.equal((await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, { origin: 'http://evil.example' })).status, 403);
  assert.equal((await post({ jsonrpc: '2.0', id: 0, method: 'server/discover' })).status, 200);
  const init = await post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-11-25' } });
  const session = init.headers.get('mcp-session-id'); assert.match(session, /^[0-9a-f-]{36}$/);
  assert.equal((await init.json()).result.protocolVersion, '2025-11-25');
  assert.ok((await (await post({ jsonrpc: '2.0', id: 9, method: 'initialize', params: {} })).json()).error);
  assert.equal((await post({ jsonrpc: '2.0', method: 'notifications/initialized' }, { session })).status, 202);
  assert.equal((await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).status, 400);
  assert.ok((await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { session: randomUUID() })).json()).error);
  assert.equal((await (await post({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { session })).json()).result.tools.length, 30);
  const denied = await (await post({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'memory_read', arguments: {} } }, { session })).json();
  assert.equal(denied.result.isError, true); assert.match(denied.result.content[0].text, /negada/);
  const pending = post({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'task_create_item', arguments: { title: 'Estudar' } } }, { session });
  await until(() => app.state().approvals.length); assert.equal(app.db.all('SELECT * FROM pending_items').length, 0);
  const approval = app.state().approvals[0];
  await app.rpc('approval.respond', { approvalId: approval.id, actionHash: approval.actionHash, approved: true });
  const done = await (await pending).json(); assert.equal(done.result.isError, undefined);
  assert.equal(app.db.all('SELECT * FROM pending_items WHERE bot_id=?', bot.id).length, 1); assert.equal(app.db.all('SELECT * FROM pending_items WHERE bot_id=?', other.id).length, 0);
  cap.close(); assert.equal((await post({ jsonrpc: '2.0', id: 5, method: 'tools/list' }, { session })).status, 403);
});

test('Claude wrapper finds proot-distro 5 and legacy rootfs layouts and passes empty and JSON arguments intact', async t => {
  const { mkdir, symlink, chmod } = await import('node:fs/promises');
  const { execFile } = await import('node:child_process');
  const wrapperSource = await readFile(new URL('../supervisor/claude-wrapper.sh', import.meta.url), 'utf8');
  const { execFileSync } = await import('node:child_process'); const { dirname } = await import('node:path');
  // Termux has no /usr/bin or /bin: keep only the directory of this device's bash next to the fake proot-distro.
  const bash = execFileSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
  const run = (prefix, bin, args) => new Promise(resolve => execFile(bash, ['-c', wrapperSource, 'claude-wrapper', ...args], { env: { HOME: prefix, PREFIX: prefix, PATH: `${bin}:${dirname(bash)}` } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
  const directory = await mkdtemp(join(tmpdir(), 'mybots-wrapper-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin'); await mkdir(bin);
  await writeFile(join(bin, 'proot-distro'), `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));`); await chmod(join(bin, 'proot-distro'), 0o700);
  const args = ['-p', '--tools', '', '--mcp-config', JSON.stringify({ mcpServers: { a: { headers: { Authorization: 'Bearer x y' } } } })];
  const empty = join(directory, 'empty'); await mkdir(empty);
  assert.equal((await run(empty, bin, args)).code, 127);
  for (const [layout, name] of [['containers/debian/rootfs', 'debian'], ['installed-rootfs/ubuntu', 'ubuntu']]) {
    const prefix = join(directory, name); const local = join(prefix, 'var/lib/proot-distro', layout, 'root/.local/bin');
    await mkdir(local, { recursive: true });
    // The official installer leaves a symlink whose absolute target only exists inside the container.
    await symlink('/root/.local/share/claude/versions/2.1.303', join(local, 'claude'));
    const result = await run(prefix, bin, args);
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ['login', name, '--', '/root/.local/bin/claude', ...args]);
  }
});
