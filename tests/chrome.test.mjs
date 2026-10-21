import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { createSupervisor } from '../supervisor/index.mjs';
import { createNode } from '../pc/server.mjs';
import runner from '../lib/claude-runner.cjs';

const selection = { provider: 'claude', model: 'haiku', reasoningEffort: 'low' };
const claude = { status: async () => ({ available: true, loggedIn: true }), models: async () => runner.CLAUDE_MODELS };
async function until(check) { for (let i = 0; i < 1000; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-chrome-'));
  let script = [], results = [], listed = [], visible = 0, started, session;
  const app = await createSupervisor({ directory: join(directory, 'phone'), port: 0, claude, codex: { status: async () => ({ loggedIn: false }), models: async () => [] } });
  const node = await createNode({ directory: join(directory, 'pc'), projects: join(directory, 'projects'), port: 0, uiPort: 0, advertise: () => ['127.0.0.1'], host: '127.0.0.1', status: async () => ({ connections: { claude: { loggedIn: true } }, models: runner.CLAUDE_MODELS }),
    browser: { command: async () => assert.fail('Claude não deve abrir Playwright'), stop: () => {}, close: () => {} },
    desktop: { indicate: async () => { visible++; return async () => { visible--; }; } },
    execute: async (bot, prompt, { tools, signal }) => {
      assert.equal(typeof tools.chrome, 'boolean'); started = tools; session = bot.codexSessionId; results = [];
      const headers = { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json' };
      const bridgeId = randomUUID();
      const post = (path, body) => fetch(tools.endpoint + path, { method: 'POST', headers, body: JSON.stringify(body) });
      await post('/tools/claim', { bridgeId });
      listed = (await (await post('/tools/list', { bridgeId })).json()).tools.map(x => x.name);
      for (const [name, input = {}] of script) {
        const body = { hook_event_name: 'PreToolUse', tool_name: 'mcp__claude-in-chrome__' + name, tool_input: input, tool_use_id: 'toolu_' + randomUUID() };
        const result = await (await post('/tools/chrome', body)).json(); results.push(result);
      }
      if (prompt.includes('pânico')) await new Promise((resolve, reject) => { if (signal.aborted) reject(new Error('interrompido')); else signal.addEventListener('abort', () => reject(new Error('interrompido')), { once: true }); });
      return { text: 'feito', ...selection, codexSessionId: randomUUID() };
    }
  });
  t.after(async () => { await app.close(); await node.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('computer.pair', { link: node.pairing().link }); await until(() => app.state().computer.state === 'online');
  const bot = await app.rpc('bot.create', { name: 'Chrome', home: 'pc', access: 'ask', ...selection });
  app.db.putBot({ ...app.db.requireBot(bot.id), browserMode: 'claude' });
  app.tools.grant(bot.id, 'browser', true);
  const start = async (steps, text = 'executar') => { script = steps; return (await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text })).taskId; };
  const finish = async id => { await until(() => ['done', 'failed', 'cancelled'].includes(app.db.task(id).state)); return results.map(r => r.hookSpecificOutput?.permissionDecision); };
  const approve = async (approved, always = false) => { await until(() => app.state().approvals.length); const card = app.state().approvals[0]; await app.rpc('approval.respond', { approvalId: card.id, actionHash: card.actionHash, approved, always }); return card; };
  return { app, node, directory, bot, start, finish, approve, get listed() { return listed; }, get visible() { return visible; }, get started() { return started; }, get session() { return session; } };
}

test('official Chrome: enabled only on PC; native hook blocks on network failure; guidance separates shared Chrome from Playwright', () => {
  const session = randomUUID();
  const tools = { chrome: true, device: 'PC', endpoint: 'http://127.0.0.1:9', token: 'a'.repeat(64) };
  const args = runner.claudeArguments({}, session, tools); const after = flag => args[args.indexOf(flag) + 1];
  assert.ok(args.includes('--chrome')); assert.equal(after('--permission-prompts'), 'host');
  const hook = JSON.parse(after('--settings')).hooks.PreToolUse[0];
  assert.match('mcp__claude-in-chrome__computer', new RegExp(hook.matcher));
  assert.equal(hook.hooks[0].onFailure, 'block'); assert.equal(hook.hooks[0].url, tools.endpoint + '/tools/chrome');
  assert.match(after('--append-system-prompt'), /Chrome principal/); assert.doesNotMatch(after('--append-system-prompt'), /num perfil só deste bot/);
  for (const other of [undefined, {}, { browser: true }]) assert.ok(runner.claudeArguments({}, session, other && { ...other, endpoint: tools.endpoint }).includes('--no-chrome'));
});

test('official Chrome: reads without asking, mutations require phone approval with Always; account permission cannot grant browser', async t => {
  const f = await setup(t);
  f.app.db.session(f.bot.id, randomUUID());
  f.app.db.run('INSERT INTO metadata VALUES(?,?)', 'session.lane.' + f.bot.id, 'pc');
  let id = await f.start([['read_page', { tabId: 1 }], ['form_input', { ref: 'ref_1', value: 'Olá' }], ['navigate', { url: 'https://example.com' }]]);
  const card = await f.approve(true, true); assert.equal(card.canAlways, true); assert.match(card.summary, /Chrome principal.*compartilhados/); assert.match(card.summary, /Olá/);
  assert.deepEqual(await f.finish(id), ['allow','allow','allow']); assert.equal(f.session, undefined);
  const resumed = f.app.db.bot(f.bot.id).codexSessionId;
  id = await f.start([['read_page', {}]]); await f.finish(id); assert.equal(f.session, resumed);
  assert.ok(f.listed.includes('browser_ask_user')); assert.ok(!f.listed.includes('browser_open')); assert.equal(f.visible, 0);
  f.app.tools.grant(f.bot.id, 'browser', false); f.app.tools.grant(f.bot.id, 'account.connectors', true);
  id = await f.start([['get_page_text', { tabId: 1 }]]); assert.deepEqual(await f.finish(id), ['deny']);
  await f.app.rpc('bot.update', { botId: f.bot.id, access: 'basic' });
  id = await f.start([['read_page', {}]]); assert.deepEqual(await f.finish(id), ['deny']);
});

test('official Chrome: deny, revoke while pending, uploads always ask, person takeover and expired capability block', async t => {
  const f = await setup(t);
  let id = await f.start([['javascript_tool', { text: 'document.title' }]]); await f.approve(false); assert.deepEqual(await f.finish(id), ['deny']);
  id = await f.start([['browser_batch', { actions: [] }]]); await until(() => f.app.state().approvals.length); f.app.tools.grant(f.bot.id, 'browser', false); assert.deepEqual(await f.finish(id), ['deny']);
  await f.app.rpc('bot.update', { botId: f.bot.id, access: 'full' });
  id = await f.start([['file_upload', { paths: ['/tmp/test.txt'] }]]); assert.equal((await f.approve(false)).canAlways, false); assert.deepEqual(await f.finish(id), ['deny']);
  id = await f.start([['tabs_context_mcp', {}]]); assert.deepEqual(await f.finish(id), ['allow']);
  await f.app.rpc('browser.control', { botId: f.bot.id, who: 'person' });
  id = await f.start([['navigate', { url: 'https://example.com' }]]); assert.deepEqual(await f.finish(id), ['deny']);
  assert.equal((await fetch(`http://127.0.0.1:${f.app.port}/tools/chrome`, { method: 'POST', headers: { Authorization: 'Bearer ' + f.started.token }, body: '{}' })).status, 403);
  const task = f.app.db.start(f.app.db.enqueue(f.bot.id, randomUUID(), 'phone', selection).id); const cap = f.app.tools.open(task);
  const answer = await f.app.tools.chromeHook(cap.token, { hook_event_name: 'PreToolUse', tool_name: 'mcp__claude-in-chrome__read_page', tool_input: {}, tool_use_id: 'toolu_test' });
  assert.equal(answer.hookSpecificOutput.permissionDecision, 'deny'); cap.close();
});

test('official Chrome: visible PC notice and local panic abort the turn without closing the main Chrome', async t => {
  const f = await setup(t); await f.app.rpc('bot.update', { botId: f.bot.id, access: 'full' });
  const id = await f.start([['tabs_context_mcp', {}]], 'esperar pânico'); await until(() => f.visible === 1);
  await new Promise((resolve, reject) => { const socket = createConnection(join(f.directory, 'pc/panic.sock')); socket.on('connect', () => socket.write('panic')); socket.on('data', () => { socket.end(); resolve(); }); socket.on('error', reject); });
  await f.finish(id); await until(() => f.visible === 0); assert.match(f.app.db.task(id).error, /tecla de pânico/);
});
