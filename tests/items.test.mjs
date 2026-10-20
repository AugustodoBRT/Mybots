import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { itemKey, deadline } from '../supervisor/items.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check) { for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

async function setup(t, start = Date.parse('2026-10-22T15:00:00Z')) {
  let at = start; const notices = [];
  const directory = await mkdtemp(join(tmpdir(), 'mybots-items-'));
  const app = await createSupervisor({ directory, port: 0, codex, clock: () => at, routineTickMs: 60000,
    notify: async (args, options) => { notices.push({ ...args, ...options }); return { notified: true }; } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('device.timezone', { timeZone: 'America/Sao_Paulo' });
  const bot = await app.rpc('bot.create', { name: 'Faculdade', access: 'ask', ...selection });
  const open = (botId = bot.id) => {
    const task = app.db.start(app.db.enqueue(botId, randomUUID(), 'Oi', selection).id); const cap = app.tools.open(task); const bridgeId = randomUUID(); app.tools.context(cap.token, bridgeId, true);
    t.after(cap.close);
    return (name, args = {}) => app.tools.callMcp(cap.token, { bridgeId, callId: randomUUID(), name, args });
  };
  return { app, bot, open, notices, advance: ms => { at += ms; }, set: value => { at = value; }, now: () => at, directory };
}

test('the same activity is recognized despite case, accents and punctuation; a date alone stays a date', () => {
  assert.equal(itemKey({ course: 'Cálculo I', title: 'Lista 3 — Integrais', due: '2026-10-25' }), itemKey({ course: 'calculo i', title: 'LISTA 3: integrais!', due: '2026-10-25' }));
  assert.notEqual(itemKey({ course: 'Cálculo I', title: 'Lista 3', due: '2026-10-25' }), itemKey({ course: 'Cálculo II', title: 'Lista 3', due: '2026-10-25' }));
  const day = deadline('2026-10-25', 'America/Sao_Paulo');
  assert.equal(day.dateOnly, true); assert.equal(new Date(day.remind).toISOString(), '2026-10-24T12:00:00.000Z');
  assert.equal(new Date(day.end).toISOString(), '2026-10-26T03:00:00.000Z');
  const timed = deadline('2026-10-25T23:59', 'America/Sao_Paulo');
  assert.equal(new Date(timed.at).toISOString(), '2026-10-26T02:59:00.000Z'); assert.equal(timed.remind, timed.at - 86400000);
});

test('activities are registered once, a changed deadline is an update, and a bot only sees its own items', async t => {
  const f = await setup(t); const call = f.open();
  const first = await call('task_create_item', { course: 'Cálculo I', title: 'Lista 3', due: '2026-10-25', source: 'notificação do Gmail de 22/10', details: 'Exercícios 1 a 10' });
  assert.equal(first.course, 'Cálculo I'); assert.equal(first.due, '2026-10-25'); assert.equal(first.key, undefined);
  assert.match(first.dueLabel, /25\/10/);
  // The same notice again (a forwarded e-mail, the daily check): nothing new.
  const again = await call('task_create_item', { course: 'calculo i', title: 'LISTA 3', due: '2026-10-25' });
  assert.equal(again.duplicate, true); assert.equal(again.item.id, first.id);
  assert.equal(f.app.db.all('SELECT * FROM pending_items').length, 1);
  await assert.rejects(call('task_create_item', { title: 'Prova', due: '2026-02-30' }), /AAAA-MM-DD/);
  await assert.rejects(call('task_create_item', { title: 'Prova', due: '25/10/2026' }), /AAAA-MM-DD/);
  // The professor moved the deadline: update keeps one item and its history.
  const moved = await call('task_update_item', { id: first.id, due: '2026-10-27T23:59' });
  assert.equal(moved.id, first.id); assert.equal(moved.due, '2026-10-27T23:59');
  assert.equal(f.app.db.all('SELECT * FROM pending_items').length, 1);
  assert.ok(f.app.state().activity.some(item => item.kind === 'item_updated' && /prazo .* → .*27\/10.* às 23:59/.test(item.detail)));
  const second = await call('task_create_item', { course: 'Cálculo I', title: 'Lista 4', due: '2026-10-30' });
  await assert.rejects(call('task_update_item', { id: second.id, title: 'Lista 3', due: '2026-10-27T23:59' }), /outra pendência igual/);
  // Nearest deadline first; done items leave the open list.
  assert.deepEqual((await call('task_list_items')).items.map(item => item.title), ['Lista 3', 'Lista 4']);
  await call('task_update_item', { id: second.id, done: true });
  assert.deepEqual((await call('task_list_items')).items.map(item => item.title), ['Lista 3']);
  assert.equal((await call('task_list_items', { state: 'all' })).total, 2);
  // Another bot cannot see or change them, and its own identical activity is separate.
  const other = await f.app.rpc('bot.create', { name: 'Outro', access: 'ask', ...selection }); const otherCall = f.open(other.id);
  assert.equal((await otherCall('task_list_items')).total, 0);
  await assert.rejects(otherCall('task_update_item', { id: first.id, done: true }), /não encontrada/);
  assert.equal((await otherCall('task_create_item', { course: 'Cálculo I', title: 'Lista 3', due: '2026-10-27T23:59' })).duplicate, undefined);
  assert.equal(f.app.state().approvals.length, 0, 'pendências do próprio bot não pedem aprovação no Médio');
});

test('the deadline notice goes out once the day before, as MyBots, wakes the phone, and a new deadline gets a new one', async t => {
  const f = await setup(t); const call = f.open();
  const item = await call('task_create_item', { course: 'Cálculo I', title: 'Lista 3', due: '2026-10-25' });
  const wake = async () => (await fetch(`http://127.0.0.1:${f.app.port}/device/wake`, { method: 'POST', headers: { Authorization: 'Bearer ' + f.app.token, 'Content-Type': 'application/json' }, body: '{}' })).json();
  // Saturday 24/10 at 09:00 in São Paulo is when the phone must wake.
  assert.equal((await wake()).nextRoutineAt, '2026-10-24T12:00:00.000Z');
  await f.app.items.tick(); assert.equal(f.notices.length, 0);
  f.set(Date.parse('2026-10-24T12:00:30Z'));
  await wake();
  await until(() => f.notices.length === 1);
  assert.equal(f.notices[0].title, 'Faculdade · Cálculo I: Lista 3');
  assert.match(f.notices[0].body, /^Prazo amanhã \(dom\., 25\/10\)\.$/);
  assert.equal(f.notices[0].botId, f.bot.id);
  await f.app.items.tick(); await wake(); assert.equal(f.notices.length, 1, 'nunca repete o mesmo aviso');
  assert.ok(f.app.state().activity.some(entry => entry.kind === 'item_reminder'));
  // A deadline moved to next week: notified again the day before the new date, not now.
  await call('task_update_item', { id: item.id, due: '2026-10-30T18:00' });
  assert.equal((await wake()).nextRoutineAt, '2026-10-29T21:00:00.000Z');
  f.set(Date.parse('2026-10-29T21:00:10Z')); await f.app.items.tick();
  assert.equal(f.notices.length, 2); assert.match(f.notices[1].body, /amanhã .* às 18:00/);
  // Done items and items already past their deadline are never announced.
  const late = await call('task_create_item', { title: 'Entrega antiga', due: '2026-10-20' });
  const done = await call('task_create_item', { title: 'Feita', due: '2026-10-31' });
  await call('task_update_item', { id: done.id, done: true });
  f.set(Date.parse('2026-10-30T12:30:00Z')); await f.app.items.tick();
  assert.equal(f.notices.length, 2); assert.ok(late.id);
});

test('a backup keeps items with their dedupe state and the browser form permission', async t => {
  const f = await setup(t); const call = f.open();
  await call('task_create_item', { course: 'Física', title: 'Relatório', due: '2026-10-25' });
  f.set(Date.parse('2026-10-24T12:01:00Z')); await f.app.items.tick();
  f.app.tools.remember(f.bot.id, 'browser/write');
  const snapshot = await f.app.rpc('backup.export');
  f.app.db.run("UPDATE tasks SET state='done'");
  await f.app.rpc('backup.restore', { snapshot });
  const restored = f.app.db.all('SELECT * FROM pending_items');
  assert.equal(restored.length, 1); assert.ok(JSON.parse(restored[0].body).remindedAt);
  assert.equal((await f.open()('task_create_item', { course: 'fisica', title: 'relatorio', due: '2026-10-25' })).duplicate, true);
  assert.equal(f.app.tools.saved(f.bot.id, 'browser/write'), 'true');
});

test('notices drop the Markdown of the bot reply', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-plain-'));
  const shown = [];
  const app = await createSupervisor({ directory, port: 0, codex, notify: async args => { shown.push(args); return { notified: true }; } });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.tools.notify({ title: '**Faculdade**', body: '## Resumo\nAtualizei o prazo do **Relatório 2** para `06/11`.' }, { botId: randomUUID() });
  assert.deepEqual(shown[0], { title: 'Faculdade', body: 'Resumo\nAtualizei o prazo do Relatório 2 para 06/11.' });
});
