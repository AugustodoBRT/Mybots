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

test('an old Claude in Chrome profile uses the shared MyBots browser after migration', async t => {
  const f = await setup(t);
  assert.equal(f.app.db.requireBot(f.bot.id).browserMode, 'shared');
});
