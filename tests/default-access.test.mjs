import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { defaultBotAccess, googleAccountUrl, browserAccountGuidance, validateBackup } from '../mobile/local.js';
import { DESKTOP_METHODS } from '../supervisor/link.mjs';
import { SupervisorClient } from '../mobile/supervisor-client.js';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 5)); } assert.fail('O estado esperado não chegou.'); }
async function setup(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-default-access-'));
  const turns = [], commands = [];
  const execute = async (bot, prompt, options) => { turns.push({ bot, prompt, tools: options.tools }); return { text: 'Pronto.', ...selection }; };
  const app = await createSupervisor({ directory, port: 0, codex, execute, notify: async () => ({ notified: true }) });
  let stopped = false;
  const polling = (async () => {
    while (!stopped) {
      try {
        const response = await fetch(`http://127.0.0.1:${app.port}/device/browser`, { headers: { Authorization: 'Bearer ' + app.token } });
        for (const command of (await response.json()).commands || []) {
          commands.push(command);
          const value = command.op === 'read' ? { url: 'https://mail.google.com/', text: 'Faça login' } : { url: command.args.url || 'https://mail.google.com/', title: 'Google' };
          await fetch(`http://127.0.0.1:${app.port}/device/browser/result`, { method: 'POST', headers: { Authorization: 'Bearer ' + app.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: command.id, ok: true, value }) });
        }
      } catch { break; }
    }
  })();
  t.after(async () => { stopped = true; await app.close(); await polling; await rm(directory, { recursive: true, force: true }); });
  await until(() => app.state().browser.available);
  const make = data => app.rpc('bot.create', { name: 'Bot', ...selection, ...data });
  const open = (bot, lane = 'phone') => {
    const task = app.db.start(app.db.enqueue(bot.id, randomUUID(), 'Oi', selection).id);
    const controller = new AbortController(), cap = app.tools.open(task, controller.signal, lane), bridgeId = randomUUID();
    app.tools.context(cap.token, bridgeId, true); t.after(cap.close);
    return { task, cap, names: () => app.tools.toolList(cap.token, bridgeId).map(tool => tool.name),
      call: (name, args = {}) => app.tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name, args }) };
  };
  return { app, make, open, turns, commands, execute };
}

test('old and new profiles get full access and automatic presence; phone control remains an explicit choice', async t => {
  const f = await setup(t);
  for (const access of [undefined, 'basic', 'ask', 'full', 'free']) {
    const bot = await f.make({ access, home: 'pc' });
    assert.equal(bot.access, 'full'); assert.equal(bot.home, 'any'); assert.equal(bot.gpu, true);
    assert.equal(bot.phoneControl, access === 'free');
    assert.deepEqual(f.app.state().presence[bot.id], { online: true, where: 'phone' });
  }
  // Simulate a persisted pre-update profile, rather than only testing creation.
  const bot = await f.make();
  f.app.db.putBot({ ...bot, access: 'basic', home: 'pc', browserMode: 'separate', phoneControl: undefined });
  assert.equal(f.app.db.requireBot(bot.id).access, 'full');
  assert.equal(f.app.db.requireBot(bot.id).browserMode, 'shared');
  assert.equal(defaultBotAccess({ access: 'free', phoneControl: false }).phoneControl, false);
  const legacy = await f.make({ access: 'free' });
  f.app.db.putBot({ ...legacy, access: 'free', phoneControl: undefined });
  f.app.tools.grant(legacy.id, 'phone', false);
  assert.equal(f.app.db.requireBot(legacy.id).phoneControl, false);
  f.app.tools.grant(bot.id, 'browser', false); f.app.tools.grant(bot.id, 'memory.write', false);
  const run = f.open(bot);
  assert.ok(run.names().includes('browser_open')); assert.ok(!run.names().includes('phone_screen'));
  assert.ok(!run.names().includes('email_search')); assert.ok(!run.names().includes('email_read'));
  await run.call('memory_write', { key: 'nome', text: 'Ana' });
  await run.call('notify_user', { title: 'Oi', body: 'Pronto' });
  assert.equal(f.app.state().approvals.length, 0);
  await f.app.rpc('bot.phoneControl', { botId: bot.id, on: true });
  assert.ok(run.names().includes('phone_screen'));
  await run.call('phone_screen');
  assert.equal(f.commands.find(command => command.op === 'phoneScreen').args.phoneControl, true);
  await f.app.rpc('bot.phoneControl', { botId: bot.id, on: false });
  assert.equal(f.app.tools.policy(bot.id, 'phone'), 'deny');
  await assert.rejects(run.call('phone_screen'), /encerrada|desligado|inválida/);
  assert.ok(DESKTOP_METHODS.includes('bot.phoneControl'));
});

test('bots keep responding without a PC, move automatically when it connects, and use browser services without connectors', async t => {
  const f = await setup(t), bot = await f.make({ home: 'pc' });
  await f.app.rpc('bot.update', { botId: bot.id, googleAccount: 'faculdade@example.com' });
  const first = await f.app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Veja meus e-mails' });
  await until(() => f.app.db.task(first.taskId).state === 'done');
  assert.equal(f.turns[0].tools.connectors, false); assert.equal(f.turns[0].tools.termux, true);
  assert.match(f.turns[0].prompt, /faculdade@example.com/); assert.match(f.turns[0].prompt, /browser_open/);
  f.app.nodes.connect({ id: 'pc', connections: { codex: { loggedIn: true } }, execute: f.execute });
  const second = await f.app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Continue' });
  await until(() => f.app.db.task(second.taskId).state === 'done');
  assert.equal(f.turns[1].tools.computer.full, true); assert.equal(f.turns[1].tools.desktop, false, 'the person\'s screen is off unless turned on for the bot');
  assert.equal(f.turns[1].tools.connectors, false);
  f.app.nodes.disconnect('pc');
  assert.deepEqual(f.app.state().presence[bot.id], { online: true, where: 'phone' });
});

test('multiple Google accounts persist independently, selection resets sessions, and navigation targets each bot account', async t => {
  const f = await setup(t), a = await f.make(), b = await f.make({ name: 'Outro' });
  await f.app.rpc('google.accounts.add', { account: 'pessoal@example.com' });
  await f.app.rpc('bot.update', { botId: a.id, googleAccount: 'faculdade@example.com' });
  await f.app.rpc('bot.update', { botId: b.id, googleAccount: 'pessoal@example.com' });
  assert.deepEqual(f.app.state().googleAccounts, ['pessoal@example.com', 'faculdade@example.com']);
  await assert.rejects(f.app.rpc('google.accounts.add', { account: 'invalido' }), /e-mail/);
  f.app.db.session(a.id, randomUUID());
  await f.app.rpc('bot.update', { botId: a.id, googleAccount: 'pessoal@example.com' });
  assert.equal(f.app.db.requireBot(a.id).codexSessionId, undefined);
  await f.app.rpc('bot.update', { botId: a.id, googleAccount: 'faculdade@example.com' });
  for (const bot of [a, b]) await f.open(bot).call('browser_open', { url: 'https://mail.google.com/mail/u/0/#inbox' });
  const opened = f.commands.filter(command => command.op === 'open');
  assert.equal(new URL(opened[0].args.url).searchParams.get('authuser'), 'faculdade@example.com');
  assert.equal(new URL(opened[1].args.url).searchParams.get('authuser'), 'pessoal@example.com');
  assert.ok(opened.every(command => command.profile === 'shared'));
  assert.equal(googleAccountUrl('https://example.com/?authuser=0', 'x@example.com'), 'https://example.com/?authuser=0');
  assert.match(browserAccountGuidance(f.app.db.requireBot(a.id)), /nunca use outra conta silenciosamente/);
});

test('Google account selection requires confirmation from the phone, including older supervisors that ignore the field', async t => {
  const f = await setup(t), bot = await f.make(), client = new SupervisorClient();
  client.call = async () => ({ id: bot.id, name: bot.name });
  await assert.rejects(client.setGoogleAccount(bot.id, 'outra@example.com'), /não foi salva.*Atualize o MyBots no celular/);
  client.call = (...args) => f.app.rpc(...args);
  await assert.rejects(client.setGoogleAccount(bot.id, 'invalido'), /e-mail completo/);
  await client.setGoogleAccount(bot.id, ' Outra@Example.com ');
  assert.equal(f.app.state().bots.find(item => item.id === bot.id).googleAccount, 'outra@example.com');
  assert.deepEqual(f.app.state().googleAccounts, ['outra@example.com']);
  await client.setGoogleAccount(bot.id, '');
  assert.equal(f.app.db.requireBot(bot.id).googleAccount, '');
});

test('adding a Google login opens the existing browser and hands it to the person without exposing passwords', async t => {
  const f = await setup(t), bot = await f.make();
  assert.deepEqual(await f.app.rpc('google.login', { botId: bot.id, account: 'outra@example.com' }), { opened: true });
  const command = f.commands.find(command => command.op === 'open');
  const url = new URL(command.args.url);
  assert.equal(url.hostname, 'accounts.google.com'); assert.equal(url.pathname, '/AddSession');
  assert.equal(url.searchParams.get('Email'), 'outra@example.com');
  assert.equal(f.app.state().browser.control[bot.id], 'person');
  assert.equal(f.app.state().approvals.length, 0);
  assert.ok(DESKTOP_METHODS.includes('google.login'));
});


test('backups preserve Google accounts and each bot choice, and reject malformed account or control data', async t => {
  const f = await setup(t), bot = await f.make();
  await f.app.rpc('google.accounts.add', { account: 'pessoal@example.com' });
  await f.app.rpc('bot.update', { botId: bot.id, googleAccount: 'faculdade@example.com' });
  await f.app.rpc('bot.phoneControl', { botId: bot.id, on: true });
  const backup = f.app.db.snapshot();
  const opencode = structuredClone(backup); opencode.bots[0].provider = 'opencode'; opencode.bots[0].codexSessionId = 'ses_1234567890abcdefgh';
  assert.doesNotThrow(() => validateBackup(opencode));
  opencode.bots[0].codexSessionId = 'ses_unsafe/../path';
  assert.throws(() => validateBackup(opencode), /inválido/);
  f.app.db.run("DELETE FROM metadata WHERE key='google.accounts'");
  f.app.db.restore(backup);
  assert.deepEqual(f.app.db.googleAccounts(), ['pessoal@example.com', 'faculdade@example.com']);
  assert.equal(f.app.db.requireBot(bot.id).googleAccount, 'faculdade@example.com');
  assert.equal(f.app.db.requireBot(bot.id).phoneControl, true);
  const invalid = structuredClone(backup); invalid.googleAccounts.push('invalid');
  assert.throws(() => f.app.db.restore(invalid), /Google/);
  invalid.googleAccounts.pop(); invalid.bots[0].phoneControl = 'sim';
  assert.throws(() => f.app.db.restore(invalid), /Controle do celular/);
});
