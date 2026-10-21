import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, generateKeyPairSync, randomBytes, publicEncrypt, createCipheriv } from 'node:crypto';
import { createConnection } from 'node:net';
import { createSupervisor } from '../supervisor/index.mjs';
import { createNode, sandboxFor } from '../pc/server.mjs';
import { Desktop } from '../pc/desktop.mjs';
import { BrowserSession } from '../pc/browser-worker.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 800; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-desktop-'));
  const app = await createSupervisor({ directory: join(directory, 'phone'), port: 0, codex, approvalMs: 2000 });
  const actions = []; let steps = []; let results = []; let listed = []; let visible = 0; let stopped = 0;
  const execute = async (bot, prompt, { tools, signal }) => {
    const call = async (body, session) => {
      const r = await fetch(tools.endpoint + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(body) });
      return { session: r.headers.get('mcp-session-id'), body: await r.json() };
    };
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    listed = (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, init.session)).body.result.tools.map(item => item.name);
    results = [];
    for (const [name, args = {}] of steps) results.push((await call({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name, arguments: args } }, init.session)).body.result);
    if (prompt.includes('esperar pânico')) await new Promise((resolve, reject) => {
      if (signal.aborted) reject(new Error('interrompido'));
      else signal.addEventListener('abort', () => reject(new Error('interrompido')), { once: true });
    });
    return { text: 'feito', ...selection, codexSessionId: randomUUID() };
  };
  const node = await createNode({ directory: join(directory, 'pc'), projects: join(directory, 'projects'), port: 0, uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], execute, status: async () => ({ connections: { codex: { loggedIn: true } }, models: [] }),
    desktop: { indicate: async () => { visible++; return async () => { visible--; }; }, command: async (op, args, signal) => { signal.throwIfAborted(); actions.push({ op, args }); return op === 'desktop.screenshot' ? { image: 'aW1hZ2U=' } : { done: true }; } },
    browser: { command: async (botId, op, args) => { actions.push({ botId, op, args }); return op === 'inspect' ? { kind: 'submit', label: 'Enviar', url: 'https://example.com' } : { url: 'https://example.com', title: 'Exemplo' }; }, stop: () => { stopped++; }, close: () => {} } });
  t.after(async () => { await app.close(); await node.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('computer.pair', { link: node.pairing().link }); await until(() => app.state().computer.state === 'online');
  const bot = await app.rpc('bot.create', { name: 'Tela', home: 'pc', access: 'full', ...selection });
  const start = async (script, text = 'executar') => { steps = script; const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text }); return sent.taskId; };
  const finish = async id => { await until(() => ['done','failed','cancelled'].includes(app.db.task(id).state)); return results; };
  const approve = async (approved = true, always = false) => { await until(() => app.state().approvals.length); const card = app.state().approvals[0]; await app.rpc('approval.respond', { approvalId: card.id, actionHash: card.actionHash, approved, always }); return card; };
  return { app, node, bot, directory, actions, start, finish, approve, get listed() { return listed; }, get visible() { return visible; }, get stopped() { return stopped; } };
}

test('desktop: never inherited, only PC, Pouco always blocks; Médio approves each kind and remembers Always on the phone', async t => {
  const f = await setup(t);
  let id = await f.start([['desktop_click', { x: 10, y: 20 }]]);
  assert.equal((await f.finish(id))[0].isError, true); assert.equal(f.actions.length, 0); assert.ok(!f.listed.includes('desktop_click'));
  f.app.tools.grant(f.bot.id, 'computer', true);
  assert.equal(f.app.tools.policy(f.bot.id, 'desktop'), 'deny');
  f.app.tools.grant(f.bot.id, 'desktop', true);
  id = await f.start([['desktop_screenshot'], ['desktop_click', { x: 10, y: 20 }]]);
  const full = await f.finish(id);
  assert.equal(full[0].content[1].type, 'image'); assert.equal(f.app.state().approvals.length, 0); assert.ok(f.listed.includes('desktop_click'));
  await f.app.rpc('bot.update', { botId: f.bot.id, access: 'basic' });
  id = await f.start([['desktop_windows']]); assert.equal((await f.finish(id))[0].isError, true); assert.ok(!f.listed.includes('desktop_windows'));
  await f.app.rpc('bot.update', { botId: f.bot.id, access: 'ask' });
  id = await f.start([['desktop_type', { text: 'Olá, mundo' }], ['desktop_type', { text: 'Outra vez' }]]);
  const card = await f.approve(true, true); assert.equal(card.canAlways, true); assert.match(card.summary, /Olá, mundo/);
  await f.finish(id); assert.equal(f.app.state().approvals.length, 0);
  id = await f.start([['desktop_key', { keys: ['CTRL', 'A'] }]]);
  await f.approve(false); assert.equal((await f.finish(id))[0].isError, true);
  id = await f.start([['desktop_click', { x: 20, y: 30 }]]);
  await until(() => f.app.state().approvals.length);
  f.app.tools.grant(f.bot.id, 'desktop', false);
  assert.equal((await f.finish(id))[0].isError, true);
  assert.equal(f.actions.filter(a => a.op === 'desktop.click').length, 1);
  // Even a manually constructed phone run cannot use the PC executor.
  f.app.tools.grant(f.bot.id, 'desktop', true);
  const task = f.app.db.start(f.app.db.enqueue(f.bot.id, randomUUID(), 'local', selection).id);
  const cap = f.app.tools.open(task); const bridgeId = randomUUID(); f.app.tools.context(cap.token, bridgeId, true);
  await assert.rejects(f.app.tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name: 'desktop_windows', args: {} }), /só existe.*computador/); cap.close();
});

test('PC desktop: visible indicator lasts through the turn; panic on the local socket aborts immediately and stops browser work', async t => {
  const f = await setup(t); f.app.tools.grant(f.bot.id, 'desktop', true);
  const id = await f.start([['desktop_windows']], 'esperar pânico');
  await until(() => f.visible === 1 && f.actions.length === 1);
  await new Promise((resolve, reject) => { const socket = createConnection(join(f.directory, 'pc', 'panic.sock')); socket.on('connect', () => socket.write('panic')); socket.on('data', () => { socket.end(); resolve(); }); socket.on('error', reject); });
  await f.finish(id); await until(() => f.visible === 0);
  assert.equal(f.app.db.task(id).state, 'failed'); assert.match(f.app.db.task(id).error, /tecla de pânico/); assert.ok(f.stopped > 0);
});

test('PC browser uses the same browser tools and phone approval for submitting, without inheriting desktop permission', async t => {
  const f = await setup(t); await f.app.rpc('bot.update', { botId: f.bot.id, access: 'ask' });
  f.app.tools.grant(f.bot.id, 'browser', true);
  const id = await f.start([['browser_open', { url: 'https://example.com' }], ['browser_click', { id: 1 }]]);
  const card = await f.approve(true, true); assert.match(card.title, /Enviar um formulário/);
  await f.finish(id);
  assert.deepEqual(f.actions.map(a => a.op), ['open','inspect','click']); assert.ok(f.actions.every(a => a.botId === f.bot.id));
  assert.equal(f.app.tools.browser.pages.get(f.bot.id).where, 'pc');
});

test('desktop executables get argv without shell; malformed commands refused; cancelled keys are released; custom PC home hidden', async () => {
  assert.throws(() => toolArguments('desktop.launch', { app: 'foot; touch /tmp/ruim' }));
  assert.throws(() => toolArguments('desktop.focus', { address: 'address:0x1' }));
  assert.throws(() => toolArguments('desktop.key', { keys: ['CTRL', 'SHELL'] }));
  const calls = []; const controller = new AbortController();
  const desktop = new Desktop({ run: async (bin, argv, opts) => { calls.push({ bin, argv }); if (argv[0] === 'key' && argv.some(a => a.endsWith(':1'))) { controller.abort(); throw new Error(); } return { stdout: '' }; } });
  await desktop.command('desktop.type', { text: 'TESTE V44' });
  assert.deepEqual(calls[0].argv, ['type','--key-delay','0','--','TESTE V44']);
  await assert.rejects(desktop.command('desktop.key', { keys: ['CTRL','A'] }, controller.signal));
  assert.deepEqual(calls.at(-1).argv, ['key','30:0','29:0']);
  const focused = [];
  const focus = new Desktop({ run: async (bin, argv) => { focused.push(argv); return { stdout: argv.includes('clients') ? JSON.stringify([{ address: '0xabc', at: [1920, 100], size: [800, 600] }]) : 'ok' }; } });
  await focus.command('desktop.focus', { address: '0xabc' });
  assert.deepEqual(focused[2], ['dispatch', 'movecursor', '2320 400']);
  assert.deepEqual(focused.at(-1), ['dispatch','focuswindow','address:0xabc']);
  const pasted = [];
  const unicode = new Desktop({ run: async (bin, argv, options) => {
    pasted.push({ bin, argv, input: options?.input });
    return { stdout: argv.includes('activewindow') ? '{}' : argv[0] === '--list-types' ? 'text/plain;charset=utf-8\ntext/plain\nUTF8_STRING\n' : argv.includes('--type') && bin === 'wl-paste' ? Buffer.from('texto anterior') : 'Olá, ação!' };
  } });
  await unicode.command('desktop.type', { text: 'Olá, ação!' });
  assert.ok(pasted.some(c => c.bin === 'ydotool' && c.argv.includes('47:1')));
  assert.equal(pasted.at(-1).bin, 'wl-copy'); assert.equal(pasted.at(-1).input.toString(), 'texto anterior');
  assert.ok(sandboxFor('codex', tmpdir(), '/usr/bin/bwrap', tmpdir()).includes(tmpdir()));
});

test('PC sandbox: browser profiles, host processes and desktop sockets cannot be reached by native terminal tools', { skip: !existsSync('/usr/bin/bwrap') }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-pc-hidden-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const { writeFileSync } = await import('node:fs'); writeFileSync(join(directory, 'secret'), 'não pode sair');
  const wrap = sandboxFor('codex', undefined, '/usr/bin/bwrap', directory);
  const result = JSON.parse(execFileSync(wrap[0], [...wrap.slice(1), process.execPath, '-e', `const fs=require('fs'); console.log(JSON.stringify({ hidden: !fs.existsSync(${JSON.stringify(join(directory, 'secret'))}), input: fs.existsSync('/dev/uinput'), pids: fs.readdirSync('/proc').filter(x=>/^\\d+$/.test(x)).length, runtime: ${JSON.stringify(process.env.XDG_RUNTIME_DIR || '')} ? fs.readdirSync(${JSON.stringify(process.env.XDG_RUNTIME_DIR || '/tmp')}) : [] }));`], { encoding: 'utf8' }));
  assert.equal(result.hidden, true); assert.equal(result.input, false); assert.ok(result.pids < 10); assert.deepEqual(result.runtime, []);
});

test('saved PC login: one-use RSA-OAEP/AES-GCM envelope, URL and challenge checked, plaintext never returned', async () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const url = 'https://example.com/login'; const challenge = randomBytes(24).toString('base64url');
  const key = randomBytes(32), iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(Buffer.from(challenge));
  const data = Buffer.concat([cipher.update(JSON.stringify({ url, challenge, username: 'pessoa', password: 'senha-só-no-navegador' })), cipher.final()]);
  const envelope = { key: publicEncrypt({ key: publicKey, oaepHash: 'sha256' }, key).toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: data.toString('base64') };
  const session = new BrowserSession('/unused'); let received;
  session.context = {}; session.page = { url: () => url, title: async () => 'senha-só-no-navegador', evaluate: async (fn, values) => { received = values; } };
  session.login = { privateKey, url, challenge, until: Date.now() + 10000 };
  const result = await session.command('login_fill', envelope);
  assert.equal(received.password, 'senha-só-no-navegador'); assert.equal(result.title, '[senha protegida]'); assert.doesNotMatch(JSON.stringify(result), /senha-só|pessoa|privateKey/);
  await assert.rejects(session.command('login_fill', envelope), /venceu/);
  session.login = { privateKey, url: url + '/outro', challenge, until: Date.now() + 10000 };
  await assert.rejects(session.command('login_fill', envelope), /página mudou/);
  session.login = { privateKey, url, challenge: 'outro', until: Date.now() + 10000 };
  await assert.rejects(session.command('login_fill', envelope), /login protegido/);
});

test('system Chrome: bot profiles keep their own cookies; real reads hide passwords, typing refuses them and screenshots return images', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-chrome-'));
  const sessions = [];
  t.after(async () => { for (const session of sessions) await session.close(); await rm(directory, { recursive: true, force: true }); });
  const open = async name => {
    const session = new BrowserSession(join(directory, name), { headless: true }); sessions.push(session);
    await session.start();
    await session.context.route('https://mybots.example/**', route => route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<title>Teste MyBots</title><form><input name="usuario" aria-label="Usuário"><input type="password" value="senha-que-nao-pode-sair"><button>Enviar</button></form>' }));
    await session.page.goto('https://mybots.example/login');
    return session;
  };
  const a = await open('bot-a');
  await a.context.addCookies([{ name: 'dono', value: 'a', domain: 'mybots.example', path: '/', expires: Date.now() / 1000 + 3600 }]);
  const page = await a.command('read');
  assert.equal(page.title, 'Teste MyBots'); assert.doesNotMatch(JSON.stringify(page), /senha-que-nao-pode-sair/);
  const pw = page.elements.find(el => el.kind === 'password'); const field = page.elements.find(el => el.label === 'Usuário');
  await assert.rejects(a.command('type', { id: pw.id, text: 'não' }), /Senhas só/);
  await a.command('type', { id: field.id, text: 'Olá, João' });
  assert.equal(await a.target(field.id).inputValue(), 'Olá, João');
  assert.ok((await a.command('screenshot')).image.length > 100);
  const b = await open('bot-b'); assert.equal((await b.context.cookies()).length, 0);
  await a.close();
  const again = await open('bot-a'); assert.equal((await again.context.cookies()).find(c => c.name === 'dono').value, 'a');
});

test('browser coordinate actions: Médio gates sends and drag, reads pass, Total runs, Pouco hides, takeover refuses', async t => {
  const f = await setup(t); f.app.tools.grant(f.bot.id, 'browser', true);
  await f.app.rpc('bot.update', { botId: f.bot.id, access: 'ask' });
  let id = await f.start([['browser_act', { action: 'hover', x: 10, y: 20 }], ['browser_act', { action: 'scroll', x: 10, y: 20, dy: 400 }], ['browser_find', { query: 'enviar' }], ['browser_tabs', { action: 'list' }]]);
  await f.finish(id); assert.equal(f.app.state().approvals.length, 0);
  id = await f.start([['browser_act', { action: 'click', x: 10, y: 20 }]]);
  const card = await f.approve(true, true); assert.equal(card.canAlways, true); await f.finish(id);
  assert.ok(f.app.db.get('SELECT * FROM grants WHERE bot_id=? AND tool=?', f.bot.id, 'browser/write'));
  id = await f.start([['browser_act', { action: 'drag', x: 1, y: 2, toX: 100, toY: 200 }]]);
  await f.finish(id); assert.equal(f.app.state().approvals.length, 0);
  await f.app.rpc('bot.update', { botId: f.bot.id, access: 'full' });
  id = await f.start([['browser_act', { action: 'click', x: 10, y: 20 }]]); await f.finish(id); assert.equal(f.app.state().approvals.length, 0);
  await f.app.rpc('bot.update', { botId: f.bot.id, access: 'basic' });
  id = await f.start([['browser_tabs', { action: 'list' }]]); assert.equal((await f.finish(id))[0].isError, true); assert.ok(!f.listed.includes('browser_act'));
  await f.app.rpc('bot.update', { botId: f.bot.id, access: 'full' });
  f.app.tools.browser.setControl(f.bot.id, 'person');
  const count = f.actions.length;
  id = await f.start([['browser_act', { action: 'hover', x: 1, y: 2 }], ['browser_find', { query: 'enviar' }], ['browser_tabs', { action: 'list' }]]);
  assert.ok((await f.finish(id)).every(result => result.isError)); assert.equal(f.actions.length, count);
});
