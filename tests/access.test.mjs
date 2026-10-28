import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { Device } from '../supervisor/device.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 400; i++) { if (check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

async function setup(t, access) {
  const sent = [];
  const directory = await mkdtemp(join(tmpdir(), 'mybots-access-'));
  const app = await createSupervisor({ directory, port: 0, codex, approvalMs: 2000, notify: async args => { sent.push(args); return { notified: true }; } });
  app.tools.device = new Device(app.db, { run: async (command, args, options) => { sent.push({ command, input: options?.input }); return command === 'termux-sms-list' ? '[]' : ''; } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Lua', access, ...selection });
  const open = () => {
    const task = app.db.start(app.db.enqueue(bot.id, randomUUID(), 'Oi', selection).id); const cap = app.tools.open(task); const bridgeId = randomUUID(); app.tools.context(cap.token, bridgeId, true);
    t.after(cap.close);
    return { names: () => app.tools.toolList(cap.token, bridgeId).map(tool => tool.name), call: (name, args = {}) => app.tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name, args }) };
  };
  return { app, bot, open, sent, approvals: () => app.state().approvals };
}

test('"Pouco acesso" keeps the bot to its own memory, items and routines, and hides the rest', async t => {
  const f = await setup(t, 'basic'); const run = f.open();
  assert.ok(run.names().includes('memory_write')); assert.ok(!run.names().includes('notifications_recent')); assert.ok(!run.names().includes('sms_send'));
  assert.deepEqual(await run.call('memory_write', { key: 'cor', text: 'verde' }), { saved: true, key: 'cor' });
  await assert.rejects(run.call('notifications_recent', {}), /Pouco acesso/);
  assert.equal(f.approvals().length, 0);
});

test('"Médio" asks the first time, "Sempre permitir" switches it on, and an action keeps its own approval', async t => {
  const f = await setup(t, 'ask'); const run = f.open();
  assert.ok(run.names().includes('notifications_recent'));
  // Own data needs no question.
  await run.call('memory_write', { key: 'cor', text: 'verde' }); assert.equal(f.approvals().length, 0);
  const first = run.call('notifications_recent', {});
  await until(() => f.approvals().length === 1);
  const card = f.approvals()[0]; assert.equal(card.canAlways, true);
  await f.app.rpc('approval.respond', { approvalId: card.id, actionHash: card.actionHash, approved: true, always: true });
  assert.ok(Array.isArray((await first).notifications));
  await run.call('notifications_recent', { app: 'Gmail' }); assert.equal(f.approvals().length, 0, 'não pergunta de novo');
  assert.equal(f.app.tools.grants(f.bot.id).find(item => item.name === 'notifications.recent').state, 'allow');
  // Sending an SMS: once only, then always.
  const sms = run.call('sms_send', { number: '+5531999990000', text: 'Oi' });
  await until(() => f.approvals().length === 1);
  const smsCard = f.approvals()[0]; await f.app.rpc('approval.respond', { approvalId: smsCard.id, actionHash: smsCard.actionHash, approved: true });
  await sms;
  const again = run.call('sms_send', { number: '+5531999990000', text: 'De novo' });
  await until(() => f.approvals().length === 1);
  const second = f.approvals()[0]; await f.app.rpc('approval.respond', { approvalId: second.id, actionHash: second.actionHash, approved: true, always: true });
  await again;
  await run.call('sms_send', { number: '+5531999990000', text: 'Sem perguntar' }); assert.equal(f.approvals().length, 0);
  assert.equal(f.sent.filter(item => item.command === 'termux-sms-send').length, 3);
  // A switch turned off in fine-tuning still wins over the level.
  f.app.tools.grant(f.bot.id, 'sms.send', false);
  await assert.rejects(f.open().call('sms_send', { number: '+5531999990000', text: 'x' }), /negada/);
});

test('"Acesso total" runs everything without asking, including notifications and SMS', async t => {
  const f = await setup(t, 'full'); const run = f.open();
  assert.deepEqual(await run.call('notify_user', { title: 'Oi', body: 'Teste' }), { notified: true });
  await run.call('sms_send', { number: '+5531999990000', text: 'Oi' });
  await run.call('notifications_recent', {});
  assert.equal(f.approvals().length, 0);
  assert.ok(f.sent.some(item => item.title === 'Oi') && f.sent.some(item => item.command === 'termux-sms-send'));
});

test('account connectors follow the level: Médio asks before writes (with always), Total allows, Pouco blocks', async t => {
  const decide = async (access, remember) => {
    const f = await setup(t, access); const run = f.open();
    const answer = run.call('permission', { tool_name: 'mcp__claude_ai_Gmail__send_email', input: { to: 'a@b.c' } });
    if (access === 'ask') {
      await until(() => f.approvals().length === 1);
      const card = f.approvals()[0]; assert.equal(card.canAlways, true);
      await f.app.rpc('approval.respond', { approvalId: card.id, actionHash: card.actionHash, approved: true, always: remember });
    }
    const first = await answer;
    const reads = await run.call('permission', { tool_name: 'mcp__claude_ai_Gmail__search_emails', input: {} });
    const next = access === 'ask' && remember ? await run.call('permission', { tool_name: 'mcp__claude_ai_Gmail__send_email', input: { to: 'x@y.z' } }) : null;
    return { first: first.behavior, reads: reads.behavior, next: next?.behavior, asked: f.approvals().length };
  };
  assert.deepEqual(await decide('full'), { first: 'allow', reads: 'allow', next: undefined, asked: 0 });
  assert.deepEqual(await decide('ask', true), { first: 'allow', reads: 'allow', next: 'allow', asked: 0 });
  assert.deepEqual(await decide('basic'), { first: 'deny', reads: 'deny', next: undefined, asked: 0 });
});

test('bot notifications go to the MyBots app when it is polling, and fall back to Termux:API otherwise', async t => {
  const f = await setup(t, 'full'); const run = f.open();
  const get = path => fetch(`http://127.0.0.1:${f.app.port}${path}`, { headers: { Authorization: 'Bearer ' + f.app.token } });
  // Nobody polled: straight to the fallback.
  assert.deepEqual(await run.call('notify_user', { title: 'Lembrete', body: 'Beber água' }), { notified: true });
  assert.equal((await fetch(`http://127.0.0.1:${f.app.port}/device/outbox`)).status, 401);
  // The app polls; the notice arrives as the bot, and an ack confirms delivery.
  const poll = get('/device/outbox').then(response => response.json());
  await new Promise(r => setTimeout(r, 50));
  const sent = run.call('notify_user', { title: 'Prova', body: 'Cálculo sexta' });
  const { items } = await poll;
  assert.equal(items.length, 1); assert.equal(items[0].title, 'Lua'); assert.equal(items[0].text, 'Prova: Cálculo sexta'); assert.equal(items[0].botId, f.bot.id);
  await fetch(`http://127.0.0.1:${f.app.port}/device/outbox/ack`, { method: 'POST', headers: { Authorization: 'Bearer ' + f.app.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [items[0].id] }) });
  assert.deepEqual(await sent, { notified: true, via: 'MyBots' });
  assert.equal(f.sent.filter(item => item.title === 'Prova').length, 0, 'não duplicou pelo Termux:API');
});

test('an approval reaches the notification with Aprovar/Recusar, once and only for what is safe to decide there', async t => {
  const f = await setup(t, 'ask'); const run = f.open();
  const url = path => `http://127.0.0.1:${f.app.port}${path}`; const auth = { Authorization: 'Bearer ' + f.app.token, 'Content-Type': 'application/json' };
  const act = body => fetch(url('/device/notification-action'), { method: 'POST', headers: auth, body: JSON.stringify(body) });
  const poll = () => fetch(url('/device/outbox'), { headers: auth }).then(response => response.json());
  const take = async () => { const { items } = await poll(); for (const item of items) await fetch(url('/device/outbox/ack'), { method: 'POST', headers: auth, body: JSON.stringify({ ids: [item.id] }) }); return items; };
  // The app is polling; a pending SMS approval comes with its hash and an approve works exactly once.
  const waiting = poll(); await new Promise(r => setTimeout(r, 50));
  const sms = run.call('sms_send', { number: '+5531999990000', text: 'Oi' });
  const [item] = (await waiting).items;
  assert.ok(item.approvalId && item.actionHash && item.text.includes('Oi')); assert.equal(item.canReply, undefined);
  await fetch(url('/device/outbox/ack'), { method: 'POST', headers: auth, body: JSON.stringify({ ids: [item.id] }) });
  assert.equal((await act({ type: 'approve', approvalId: item.approvalId, actionHash: 'errado' })).status, 400, 'hash diferente: nada executa');
  assert.equal(f.sent.filter(entry => entry.command === 'termux-sms-send').length, 0);
  assert.equal((await act({ type: 'approve', approvalId: item.approvalId, actionHash: item.actionHash })).status, 200);
  await sms; assert.equal(f.sent.filter(entry => entry.command === 'termux-sms-send').length, 1);
  assert.equal((await act({ type: 'approve', approvalId: item.approvalId, actionHash: item.actionHash })).status, 400, 'não vale duas vezes');
  // Recusar leaves the action undone, and the card is dismissed on the phone.
  const second = run.call('sms_send', { number: '+5531999990000', text: 'Outro' }).catch(error => error);
  let next, dismissed = [];
  for (let i = 0; i < 6 && !next; i++) { for (const entry of await take()) { if (entry.approvalId) next = entry; if (entry.dismiss) dismissed.push(entry); } }
  assert.ok(next, 'o segundo cartão chegou');
  assert.equal((await act({ type: 'reject', approvalId: next.approvalId, actionHash: next.actionHash })).status, 200);
  assert.ok(await second instanceof Error); assert.equal(f.sent.filter(entry => entry.command === 'termux-sms-send').length, 1);
  for (let i = 0; i < 6 && !dismissed.some(entry => entry.tag === 'mybots-approval-' + next.approvalId); i++) dismissed.push(...(await take()).filter(entry => entry.dismiss));
  assert.ok(dismissed.some(entry => entry.tag === 'mybots-approval-' + next.approvalId), 'o aviso sai da tela');
});

test('payment, password and code approvals never take a button on the notification', async t => {
  const f = await setup(t, 'ask');
  const { noticeable } = await import('../supervisor/tools.mjs');
  for (const tool of ['wallet/pay', 'browser/login', 'phone.fill_code', 'phone/act', 'termux', 'skill.propose', 'browser/upload', 'desktop/type', 'negotiation_close']) assert.equal(noticeable(tool, 'x'), false, tool);
  assert.equal(noticeable('sms.send', 'x'), true); assert.equal(noticeable('x.y', '', { a: 1 }), false, 'argumentos que o aviso não mostra abrem o app'); assert.equal(noticeable('notifications.recent', '', {}), true); assert.equal(noticeable('sms.send', 'x'.repeat(601)), false, 'texto longo abre o app');
  // Even with a valid hash, the endpoint refuses what only the app may decide.
  const id = randomUUID();
  const task = f.app.db.start(f.app.db.enqueue(f.bot.id, randomUUID(), 'Oi', selection).id);
  f.app.db.run("INSERT INTO approvals VALUES(?,?,?,'pending',?)", id, task.id, 'h', JSON.stringify({ botId: f.bot.id, tool: 'wallet/pay', summary: 'Pagar R$ 10' }));
  assert.throws(() => f.app.tools.noticeDecision(id, 'h', true), /Abra o MyBots/);
});

test('a bot notice can be answered from the notification and the answer reaches that bot as a message', async t => {
  const f = await setup(t, 'full'); const run = f.open();
  const url = path => `http://127.0.0.1:${f.app.port}${path}`; const auth = { Authorization: 'Bearer ' + f.app.token, 'Content-Type': 'application/json' };
  const waiting = fetch(url('/device/outbox'), { headers: auth }).then(response => response.json()); await new Promise(r => setTimeout(r, 50));
  const sent = run.call('notify_user', { title: 'Prova', body: 'Cálculo sexta' });
  const [item] = (await waiting).items; assert.equal(item.canReply, true); assert.equal(item.approvalId, undefined);
  await fetch(url('/device/outbox/ack'), { method: 'POST', headers: auth, body: JSON.stringify({ ids: [item.id] }) }); await sent;
  const reply = await fetch(url('/device/notification-action'), { method: 'POST', headers: auth, body: JSON.stringify({ type: 'reply', botId: item.botId, text: 'Pode marcar para as 14h' }) });
  assert.equal(reply.status, 200);
  assert.ok(f.app.db.messages(f.bot.id).some(message => message.role === 'user' && message.text === 'Pode marcar para as 14h'));
  assert.equal((await fetch(url('/device/notification-action'), { method: 'POST', body: '{}' })).status, 401, 'sem o token do pareamento');
  assert.equal((await fetch(url('/device/notification-action'), { method: 'POST', headers: auth, body: JSON.stringify({ type: 'reply', botId: item.botId, text: '  ' }) })).status, 400);
});
