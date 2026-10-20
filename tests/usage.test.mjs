import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }],
  limits: async () => ({ plan: 'plus', windows: [{ key: 'five_hour', used: 12.4, resetsAt: Date.now() + 3600000 }, { key: 'week', used: 9, resetsAt: Date.now() + 86400000 }] }) };
async function until(check) { for (let i = 0; i < 400; i++) { if (await check()) return; await new Promise(r => setTimeout(r, 5)); } assert.fail('Estado esperado não chegou.'); }

test('each reply records its tokens per bot; the plan limits come from the IA and survive a restart', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-usage-'));
  let again;
  t.after(async () => { await again?.close(); await rm(directory, { recursive: true, force: true }); });
  let turn = 0;
  const execute = async () => ({ text: 'Feito.', ...selection, usage: turn++ ? { input: 1000, cached: 800, output: 50 } : { input: 12000, cached: 0, output: 300 } });
  const app = await createSupervisor({ directory, port: 0, codex, execute });
  const bot = await app.rpc('bot.create', { name: 'Faculdade', ...selection });
  const other = await app.rpc('bot.create', { name: 'Outro', ...selection });
  for (const text of ['Oi', 'De novo']) {
    const { taskId } = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text });
    await until(() => app.db.task(taskId).state === 'done');
  }
  const usage = (await app.rpc('state.get')).usage;
  assert.deepEqual(usage.bots[bot.id].today, { input: 13000, cached: 800, output: 350, turns: 2 });
  assert.deepEqual(usage.bots[bot.id].week, usage.bots[bot.id].today);
  assert.equal(usage.bots[other.id], undefined);
  assert.equal(usage.days.length, 7); assert.equal(usage.days.at(-1).output, 350);
  // The reply shows its own tokens.
  assert.deepEqual(app.db.bot(bot.id).messages.at(-1).usage, { input: 1000, output: 50 });
  await until(() => app.db.limits().codex);
  assert.equal(app.db.limits().codex.plan, 'plus'); assert.deepEqual(app.db.limits().codex.windows.map(item => [item.key, item.used]), [['five_hour', 12], ['week', 9]]);
  await app.close();
  again = await createSupervisor({ directory, port: 0, codex: { ...codex, limits: async () => { throw new Error('offline'); } }, execute });
  assert.equal(again.db.limits().codex.windows[1].used, 9);
  assert.equal(again.db.usage().bots[bot.id].month.turns, 2);
});

test('Codex session totals become per-reply tokens; a new session starts from its own total', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-usage-'));
  const [s1, s2] = [randomUUID(), randomUUID()];
  const totals = [[15895, 7168, 5, s1], [31808, 15232, 11, s1], [50655, 30976, 17, s1], [16000, 0, 4, s2]];
  let turn = 0;
  const execute = async () => { const [input, cached, output, session] = totals[turn++]; return { text: 'ok', ...selection, codexSessionId: session, usage: { input, cached, output, session: true } }; };
  const app = await createSupervisor({ directory, port: 0, codex, execute });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Teste', ...selection });
  for (let i = 0; i < totals.length; i++) {
    const { taskId } = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'oi' });
    await until(() => app.db.task(taskId).state === 'done');
  }
  assert.deepEqual(app.db.all('SELECT input,cached,output FROM usage ORDER BY created_at, rowid').map(row => [row.input, row.cached, row.output]),
    [[15895, 7168, 5], [15913, 8064, 6], [18847, 15744, 6], [16000, 0, 4]]);
  // An old conversation resumed for the first time: its total is only the starting point.
  const old = await app.rpc('bot.create', { name: 'Antigo', ...selection });
  const session = randomUUID(); let total = 900000;
  const resumed = async () => ({ text: 'ok', ...selection, codexSessionId: session, usage: { input: (total += 20000), cached: 0, output: 10, session: true, resumed: true } });
  app.queue.execute = resumed;
  for (let i = 0; i < 2; i++) {
    const { taskId } = await app.rpc('chat.send', { botId: old.id, requestId: randomUUID(), text: 'oi' });
    await until(() => app.db.task(taskId).state === 'done');
  }
  assert.deepEqual(app.db.all('SELECT input FROM usage WHERE bot_id=?', old.id).map(row => row.input), [20000]);
});

test('Claude reports its windows with each reply; replies without usage record nothing', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-usage-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'Sem contagem.', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Simples', ...selection });
  const { taskId } = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi' });
  await until(() => app.db.task(taskId).state === 'done');
  assert.equal(app.db.usage().bots[bot.id], undefined);
  app.db.setLimits('claude', { windows: [{ key: 'five_hour', used: 23, resetsAt: Date.now() }, { key: 'week', used: 'x' }] });
  assert.deepEqual(app.db.limits().claude.windows.map(item => item.used), [23]);
  app.db.setLimits('claude', { windows: [] });
  assert.equal(app.db.limits().claude.windows.length, 1);
});

test('the widget summary long-polls: it answers at once with a new version and again when a bot starts working', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-widget-'));
  let release; const hold = new Promise(resolve => { release = resolve; });
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => { await hold; return { text: 'Pronto **feito**.', ...selection }; } });
  t.after(async () => { release(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Faculdade', color: 'blue', ...selection });
  const get = v => fetch(`http://127.0.0.1:${app.port}/device/widget${v ? '?v=' + v : ''}`, { headers: { Authorization: 'Bearer ' + app.token } }).then(r => r.json());
  assert.equal((await fetch(`http://127.0.0.1:${app.port}/device/widget`)).status, 401);
  const first = await get();
  assert.deepEqual(first.bots.map(item => [item.name, item.color, item.state]), [['Faculdade', 'blue', 'idle']]);
  const waiting = get(first.version);
  await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi' });
  const working = await waiting;
  assert.notEqual(working.version, first.version); assert.equal(working.bots[0].state, 'working');
  release();
  await until(async () => (await get()).bots[0].state === 'idle');
  assert.equal((await get()).bots[0].preview, 'Pronto feito.');
});

test('the person\'s name for the greeting is saved, cleaned and can be cleared; "Consultar agora" reads the limits', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-person-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', ...selection }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  assert.deepEqual((await app.rpc('state.get')).person, { name: '' });
  assert.deepEqual(await app.rpc('person.update', { name: '  Augusto   Silva ' }), { name: 'Augusto Silva' });
  assert.equal((await app.rpc('state.get')).person.name, 'Augusto Silva');
  await assert.rejects(app.rpc('person.update', { name: 'x'.repeat(41) }), /40 letras/);
  assert.deepEqual(await app.rpc('person.update', { name: '' }), { name: '' });
  await app.rpc('state.get');
  assert.equal((await app.rpc('limits.refresh', { provider: 'codex' })).codex.plan, 'plus');
  await assert.rejects(app.rpc('limits.refresh', { provider: 'claude' }), /não está conectado/);
  await assert.rejects(app.rpc('limits.refresh', { provider: 'gemini' }), /inválida/);
});

test('a Claude reply records the exact model the alias resolved to, and the picker shows its version', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-model-'));
  const claude = { status: async () => ({ available: true, loggedIn: true, message: 'Conectado' }), models: async () => [{ provider: 'claude', model: 'opus', displayName: 'Claude Opus', isDefault: false, efforts: ['low', 'medium'], defaultEffort: 'medium' }] };
  const app = await createSupervisor({ directory, port: 0, codex, claude, execute: async bot => ({ text: 'ok', model: bot.model, reasoningEffort: bot.reasoningEffort, modelId: 'claude-opus-5-5' }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal((await app.rpc('state.get')).models.find(item => item.provider === 'claude').displayName, 'Claude Opus');
  const bot = await app.rpc('bot.create', { name: 'Opus', provider: 'claude', model: 'opus', reasoningEffort: 'medium' });
  const { taskId } = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Oi' });
  await until(() => app.db.task(taskId).state === 'done');
  assert.equal(app.db.bot(bot.id).messages.at(-1).modelId, 'claude-opus-5-5');
  const opus = (await app.rpc('state.get')).models.find(item => item.provider === 'claude');
  assert.equal(opus.displayName, 'Claude Opus 5.5'); assert.equal(opus.modelId, 'claude-opus-5-5'); assert.equal(opus.model, 'opus');
});
