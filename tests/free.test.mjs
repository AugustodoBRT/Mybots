import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createSupervisor } from '../supervisor/index.mjs';
import { toolArguments, FREE_ASK_DEFAULT } from '../supervisor/tool-policy.mjs';
import { ingestNotifications, recentNotifications } from '../supervisor/device.mjs';
import { Link } from '../supervisor/link.mjs';

const require = createRequire(import.meta.url);
const codexRunner = require('../lib/codex-runner.cjs');
const claudeRunner = require('../lib/claude-runner.cjs');
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

// The app side of MyBotsAccess: long-polls /device/browser like BotBrowser.kt and answers the phone commands.
function fakePhone(app, { hold = null } = {}) {
  const seen = []; let stopped = false;
  const handle = ({ op, args }) => {
    if (op === 'phoneScreen') return { package: 'com.android.settings', app: 'Configurações', elements: [{ id: 1, kind: 'botão', text: 'Rede e Internet' }, { id: 2, kind: 'campo', password: true, text: '••••' }] };
    if (op === 'phoneFillCode') return args.confirmed || args.from === 'iFood' ? { filled: true, sender: args.from, target: { label: 'iFood' } } : { needsPerson: true, sender: args.from, target: 'Loja Estranha' };
    if (op === 'phoneOpenApp') return { app: args.app, package: 'com.android.settings', target: { app: args.app }, thumb: { image: Buffer.from('jpeg').toString('base64'), width: 4, height: 8 } };
    return { ok: true, app: 'Configurações' };
  };
  (async () => {
    while (!stopped) {
      try {
        const answer = await fetch(`http://127.0.0.1:${app.port}/device/browser`, { headers: { Authorization: 'Bearer ' + app.token } });
        if (answer.status !== 200) break;
        for (const command of (await answer.json()).commands) {
          seen.push(command);
          // A slow step (opening an app) that only ends when the test says so, to stop it in the middle.
          if (hold && command.op === hold.op) { hold.started(); continue; }
          let body; try { body = { id: command.id, ok: true, value: handle(command) }; } catch (error) { body = { id: command.id, ok: false, error: error.message }; }
          await fetch(`http://127.0.0.1:${app.port}/device/browser/result`, { method: 'POST', headers: { Authorization: 'Bearer ' + app.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        }
      } catch { break; }
    }
  })();
  return { seen, stop: () => { stopped = true; } };
}

async function setup(t, access = 'free', options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-free-'));
  const notices = [];
  const app = await createSupervisor({ directory, port: 0, codex, approvalMs: 3000, notify: async item => { notices.push(item); return { notified: true }; }, execute: async () => ({ text: 'Ok.', ...selection }) });
  const phone = fakePhone(app, options);
  t.after(async () => { phone.stop(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  await until(() => app.state().browser.available);
  const bot = await app.rpc('bot.create', { name: 'Livre', access, ...selection });
  const open = (lane = 'phone') => {
    const task = app.db.start(app.db.enqueue(bot.id, randomUUID(), 'Oi', selection).id); const cap = app.tools.open(task, new AbortController().signal, lane); const bridgeId = randomUUID(); app.tools.context(cap.token, bridgeId, true);
    t.after(cap.close);
    return { task, names: () => app.tools.toolList(cap.token, bridgeId).map(tool => tool.name), call: (name, args = {}) => app.tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name, args }), close: cap.close };
  };
  const card = async () => { await until(() => app.state().approvals.length === 1); return app.state().approvals[0]; };
  const answer = async (approved = true) => { const item = await card(); await app.rpc('approval.respond', { approvalId: item.id, actionHash: item.actionHash, approved, always: false }); return item; };
  return { app, bot, phone, open, card, answer, notices };
}

test('Livre: nothing asks except the "sempre perguntar" list; phone and Termux exist only there', async t => {
  const f = await setup(t);
  assert.equal(f.app.tools.policy(f.bot.id, 'phone'), 'allow'); assert.equal(f.app.tools.policy(f.bot.id, 'termux'), 'allow');
  assert.equal(f.app.tools.policy(f.bot.id, 'sms.send'), 'allow');
  // The default list: risky commands, skills, uploads, SMS and wallet payments still ask.
  assert.deepEqual(FREE_ASK_DEFAULT, ['risky', 'skill.propose', 'browser/upload', 'sms.send', 'wallet/pay']);
  const bot = f.app.db.requireBot(f.bot.id);
  assert.equal(f.app.tools.gate(bot, 'sms.send', { freeKey: 'sms.send' }).ask, true);
  assert.equal(f.app.tools.gate(bot, 'notify.user', { alwaysAsk: true, freeKey: 'notify.user' }).ask, false);
  assert.equal(f.app.tools.gate(bot, 'browser', { writeKey: 'browser/write', legacyAsk: true, freeKey: 'browser/submit' }).ask, false);
  await f.app.rpc('free.set', { ask: ['browser/submit'] });
  assert.equal(f.app.tools.gate(bot, 'sms.send', { freeKey: 'sms.send' }).ask, false);
  assert.equal(f.app.tools.gate(bot, 'browser', { freeKey: 'browser/submit' }).ask, true);
  assert.deepEqual((await f.app.rpc('free.get')).options.filter(item => item.ask).map(item => item.key), ['browser/submit']);
  await assert.rejects(f.app.rpc('free.set', { ask: ['tudo'] }), /Lista inválida/);
  assert.match(f.app.state().activity.map(item => item.detail).join('\n'), /sempre perguntar: passou a perguntar Enviar formulários no navegador/);
  // Phone tools are listed only for Livre bots; the others never see them.
  assert.ok(f.open().names().includes('phone_screen'));
  const other = await f.app.rpc('bot.create', { name: 'Total', access: 'full', ...selection });
  assert.equal(f.app.tools.policy(other.id, 'phone'), 'deny'); assert.equal(f.app.tools.policy(other.id, 'termux'), 'deny');
  // The switch can still turn the phone off for one Livre bot.
  f.app.tools.grant(f.bot.id, 'phone', false);
  assert.equal(f.app.tools.policy(f.bot.id, 'phone'), 'deny');
  assert.ok(!f.open().names().includes('phone_screen'));
});

test('the wallet approval is enabled once for an existing Livre list and respects a later choice', async t => {
  const f = await setup(t);
  f.app.db.run("DELETE FROM metadata WHERE key='free.wallet_default'");
  f.app.db.run("INSERT INTO metadata VALUES('free.ask',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(['browser/submit']));
  const selected = () => f.app.tools.freeSettings().options.filter(item => item.ask).map(item => item.key);
  assert.deepEqual(selected(), ['wallet/pay', 'browser/submit']);
  await f.app.rpc('free.set', { ask: ['browser/submit'] });
  assert.deepEqual(selected(), ['browser/submit']);
});

test('the model never raises a level: no Livre from team tools, a Livre maker makes Acesso total, the computer cannot choose it', async t => {
  const f = await setup(t);
  assert.throws(() => toolArguments('team.create_bot', { name: 'X', access: 'free' }), /Só a pessoa/);
  const run = f.open();
  const made = await run.call('team_create_bot', { name: 'Ajudante' });
  assert.equal(made.access, 'full');
  const link = new Link(f.app.db, { port: () => f.app.port });
  link.rpc = (method, params) => f.app.rpc(method, params);
  assert.match((await link.desktop({ method: 'bot.update', params: { botId: made.id, access: 'free' } })).error, /só se escolhe no app do celular/);
  assert.match((await link.desktop({ method: 'free.set', params: { ask: [] } })).error, /só pode ser feito no celular/);
  assert.equal(f.app.db.requireBot(made.id).access, 'full');
  link.close?.();
});

test('phone tools validate their arguments', () => {
  assert.deepEqual(toolArguments('phone.screen', {}), { image: false });
  assert.deepEqual(toolArguments('phone.tap', { id: 3 }), { id: 3, long: false });
  assert.deepEqual(toolArguments('phone.tap', { x: 10, y: 20, long: true }), { x: 10, y: 20, long: true });
  assert.deepEqual(toolArguments('phone.fill_code', { from: 'iFood', id: 2 }), { from: 'iFood', id: 2, where: 'phone' });
  assert.deepEqual(toolArguments('phone.back', {}), { home: false });
  for (const [tool, args] of [['phone.tap', { id: 1, x: 2, y: 3 }], ['phone.tap', {}], ['phone.tap', { id: 0 }], ['phone.type', { id: 1 }], ['phone.type', { id: 1, text: 'a'.repeat(2001) }],
    ['phone.scroll', { direction: 'sideways' }], ['phone.open_app', { app: '' }], ['phone.open_app', { app: 'am start\n-n x' }], ['phone.fill_code', { from: 'x', id: 1, where: 'pc' }],
    ['phone.screen', { image: 'yes' }], ['phone.back', { home: 1 }], ['phone.tap', { id: 1, script: 'x' }]]) assert.throws(() => toolArguments(tool, args), `${tool} ${JSON.stringify(args)}`);
});

test('phone commands reach the app with the turn and bot, steps go to the timeline, a listed item asks, and the activity records it', async t => {
  const f = await setup(t);
  const run = f.open();
  const screen = await run.call('phone_screen', {});
  assert.equal(screen.untrusted, true); assert.equal(screen.elements[1].text, '••••');
  const sent = f.phone.seen.find(item => item.op === 'phoneScreen');
  assert.equal(sent.args.taskId, run.task.id); assert.equal(sent.args.botId, f.bot.id); assert.equal(sent.botId, null);
  assert.equal(f.app.state().phone.controller.botId, f.bot.id);
  // Not on the list: opening an app needs nobody.
  await run.call('phone_open_app', { app: 'Configurações' });
  assert.equal(f.app.state().approvals.length, 0);
  assert.equal(f.app.state().phone.caption, 'Abrindo Configurações');
  assert.match((await f.app.rpc('browser.steps', { botId: f.bot.id })).steps.at(-1).caption, /^No celular: Abrindo Configurações/);
  // Opening apps, tapping, typing and scrolling are no longer on the list: even an old saved list that carries them never asks.
  f.app.db.run("INSERT INTO metadata VALUES('free.ask',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", JSON.stringify(['phone/act', 'phone.open_app']));
  assert.equal(f.app.tools.freeAsk('phone.open_app'), false); assert.equal(f.app.tools.freeAsk('phone/act'), false);
  assert.ok(!f.app.tools.freeSettings().options.some(item => item.key === 'phone/act' || item.key === 'phone.open_app'));
  await f.app.rpc('free.set', { ask: ['phone.open_app', 'phone/act'] });
  await run.call('phone_open_app', { app: 'Relógio' });
  await run.call('phone_tap', { id: 1 });
  assert.equal(f.app.state().approvals.length, 0);
  const log = f.app.state().activity.map(entry => entry.detail).join('\n');
  assert.match(log, /Livre começou a controlar o celular/); assert.match(log, /Celular: abrir app \(Configurações\): concluído/);
  // The turn ends: the app is told to drop the overlay and the notice.
  run.close();
  assert.equal(f.app.state().phone.controller, null);
  await until(() => f.phone.seen.some(command => command.op === 'phoneEnd' && command.args.taskId === run.task.id));
});

test('Parar stops the bot in the middle of a step: the app is told at once and the turn is cancelled', async t => {
  let started; const begun = new Promise(resolve => { started = resolve; });
  const f = await setup(t, 'free', { hold: { op: 'phoneOpenApp', started: () => started() } });
  const task = f.app.db.enqueue(f.bot.id, randomUUID(), 'Abra o relógio', selection);
  const signal = new AbortController();
  // A real turn through the queue, so Parar cancels it like the app's button.
  f.app.queue.execute = async (bot, prompt, { tools }) => {
    const bridgeId = randomUUID(); f.app.tools.context(tools.token, bridgeId, true);
    await f.app.tools.callMcp(tools.token, { bridgeId, callId: randomUUID(), name: 'phone_open_app', args: { app: 'Relógio' } });
    return { text: 'Abri.', ...selection };
  };
  f.app.queue.schedule();
  await begun;
  assert.equal(f.app.state().phone.controller.botId, f.bot.id);
  const result = await f.app.rpc('phone.stop', {});
  assert.equal(result.stopped, true);
  await until(() => f.phone.seen.some(command => command.op === 'phoneStop' && command.args.taskId === task.id));
  await until(() => f.app.db.task(task.id).state === 'cancelled');
  assert.equal(f.app.state().phone.controller, null);
  assert.match(f.app.state().activity.map(item => item.detail).join('\n'), /Você parou Livre no celular/);
  signal.abort();
});

test('Parar from the overlay or the notice, Assumir and Devolver come from the app; a request for help continues the work', async t => {
  const f = await setup(t);
  const run = f.open();
  await run.call('phone_screen', {});
  const post = body => fetch(`http://127.0.0.1:${f.app.port}/device/phone`, { method: 'POST', headers: { Authorization: 'Bearer ' + f.app.token, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  assert.equal((await fetch(`http://127.0.0.1:${f.app.port}/device/phone`, { method: 'POST', body: '{"event":"stop"}' })).status, 401);
  assert.equal((await post({ event: 'take' })).status, 200);
  assert.equal(f.app.state().phone.control, 'person');
  await assert.rejects(run.call('phone_screen', {}), /A pessoa assumiu o celular/);
  assert.equal((await post({ event: 'return' })).status, 200);
  await run.call('phone_screen', {});
  // The bot asks for the person (a bank that refuses accessibility): a notice, then Devolver queues the next turn.
  await run.call('phone_ask_user', { reason: 'Confirme o Pix no app do banco.' });
  await until(() => f.notices.length > 0);
  assert.equal(f.notices.at(-1).title, 'Toque para ajudar no celular');
  assert.equal(f.app.state().phone.help[f.bot.id].reason, 'Confirme o Pix no app do banco.');
  assert.equal((await post({ event: 'stop', source: 'notice' })).status, 200);
  assert.equal(f.app.state().phone.controller, null);
  assert.match(f.app.state().activity.map(item => item.detail).join('\n'), /Você parou Livre no celular \(pela notificação\)/);
  const back = await f.app.rpc('phone.control', { who: 'bot' });
  assert.equal(back.continued, true);
  assert.ok(f.app.db.all('SELECT body FROM messages WHERE bot_id=?', f.bot.id).some(row => /Celular devolvido/.test(row.body)));
  assert.equal((await post({ event: 'other' })).status, 400);
});

test('verification codes: hidden from notifications, filled by the app; a message that does not name the field\'s app asks the person', async t => {
  const f = await setup(t);
  ingestNotifications(f.app.db, [{ id: 'n1', package: 'com.google.android.apps.messaging', app: 'Mensagens', title: 'iFood', text: 'Seu código iFood é 482913. Não compartilhe.', time: Date.now() }]);
  const read = recentNotifications(f.app.db, { app: 'Mensagens' });
  assert.equal(read.notifications[0].text, 'Seu código iFood é [código protegido]. Não compartilhe.');
  // The sender of an SMS stays readable: only the message is masked.
  ingestNotifications(f.app.db, [{ id: 'n2', package: 'com.google.android.apps.messaging', app: 'Mensagens', title: '555-0123', text: 'Codigo de verificacao 771122', time: Date.now() + 1 }]);
  assert.deepEqual(recentNotifications(f.app.db, { query: 'verificacao' }).notifications.map(item => [item.title, item.text]), [['555-0123', 'Codigo de verificacao [código protegido]']]);
  const run = f.open();
  const filled = await run.call('phone_fill_code', { from: 'iFood', id: 2 });
  assert.equal(filled.filled, true);
  assert.ok(!JSON.stringify(filled).includes('482913'));
  // The app found a code from that sender, but its message names another service: the person decides.
  const pending = run.call('phone_fill_code', { from: 'Banco', id: 2 });
  const item = await f.answer(true);
  assert.equal(item.title, 'Preencher um código de verificação'); assert.match(item.summary, /não cita Loja Estranha/);
  assert.equal((await pending).filled, true);
  assert.equal(f.phone.seen.filter(command => command.op === 'phoneFillCode').at(-1).args.confirmed, true);
  const everything = JSON.stringify({ state: f.app.state(), activity: f.app.db.all('SELECT * FROM activity'), events: f.app.db.all('SELECT * FROM events') });
  assert.ok(!everything.includes('482913')); assert.ok(!everything.includes('771122'));
});

test('Termux shell on Livre: Claude asks for risky and listed commands, the supervisor\'s files are out of reach, Codex gets the shell unless the list blocks it', async t => {
  const f = await setup(t);
  const run = f.open('phone');
  const permission = (tool_name, input) => run.call('permission', { tool_name, input });
  const allowed = await permission('Bash', { command: 'pkg install -y jq && jq --version' });
  assert.equal(allowed.behavior, 'allow');
  const blocked = await permission('Bash', { command: 'sqlite3 ~/.mybots/mybots.sqlite "UPDATE bots SET body=1"' });
  assert.equal(blocked.behavior, 'deny'); assert.match(blocked.message, /supervisor do MyBots/);
  assert.equal((await permission('Read', { file_path: '/data/data/com.termux/files/home/.mybots/secrets/key' })).behavior, 'deny');
  const risky = permission('Bash', { command: 'rm -rf ~/' });
  const item = await f.answer(false);
  assert.equal(item.title, 'Rodar um comando no Termux');
  assert.equal((await risky).behavior, 'deny');
  // Off the Livre level the phone keeps no shell at all.
  const other = await f.app.rpc('bot.create', { name: 'Total', access: 'full', ...selection });
  const task = f.app.db.start(f.app.db.enqueue(other.id, randomUUID(), 'Oi', selection).id); const cap = f.app.tools.open(task, new AbortController().signal, 'phone'); const bridgeId = randomUUID(); f.app.tools.context(cap.token, bridgeId, true);
  t.after(cap.close);
  assert.match((await f.app.tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name: 'permission', args: { tool_name: 'Bash', input: { command: 'ls' } } })).message, /só existe no nível Livre/);
  // The runners: Codex gets the whole shell on the phone; Claude gets Bash through the permission tool.
  const codexArgs = codexRunner.chatArguments('/tmp/x', selection, { token: 't', entry: '/x', endpoint: 'http://x', termux: true, phone: true });
  assert.ok(codexArgs.includes('danger-full-access')); assert.ok(!codexArgs.includes('shell_tool'));
  assert.match(codexArgs.find(arg => arg.startsWith('developer_instructions=')), /terminal completo do Termux.*phone_screen/s);
  const plain = codexRunner.chatArguments('/tmp/x', selection, { token: 't', entry: '/x', endpoint: 'http://x' });
  assert.ok(plain.includes('read-only'));
  const claudeArgs = claudeRunner.claudeArguments(selection, randomUUID(), { token: 't', endpoint: 'http://x', termux: true, phone: true });
  assert.equal(claudeArgs[claudeArgs.indexOf('--tools') + 1], 'Bash,Read,Write,Edit,Glob,Grep');
  assert.ok(claudeArgs.includes('mcp__mybots-tools__permission'));
  assert.match(claudeArgs[claudeArgs.indexOf('--append-system-prompt') + 1], /pedir a aprovação dela/);
  // Codex cannot ask command by command: "Comandos no Termux" on the list keeps it without a shell.
  const codexBot = await f.app.rpc('bot.create', { name: 'Codex livre', access: 'free', ...selection });
  await f.app.rpc('free.set', { ask: ['termux'] });
  let tools;
  f.app.queue.execute = async (bot, prompt, options) => { tools = options.tools; return { text: 'Ok.', ...selection }; };
  const turn = f.app.db.enqueue(codexBot.id, randomUUID(), 'oi', selection); f.app.queue.schedule();
  await until(() => f.app.db.task(turn.id).state === 'done');
  assert.equal(tools.termux, false); assert.equal(tools.phone, true);
});
