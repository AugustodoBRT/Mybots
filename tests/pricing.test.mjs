import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { costOf, priceOf } from '../lib/pricing.mjs';
import { createSupervisor } from '../supervisor/index.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };

test('o custo estimado separa entrada nova, cache e saída', () => {
  // 1 M de entrada, 800 mil dela em cache, 100 mil de saída, no Codex Sol: 200 mil × 2 + 800 mil × 0,10 + 100 mil × 10 = 0,40 + 0,08 + 1,00
  assert.ok(Math.abs(costOf({ provider: 'codex', model: 'gpt-6.1-sol', input: 1e6, cached: 8e5, output: 1e5 }) - 1.48) < 1e-9);
  assert.ok(Math.abs(costOf({ provider: 'claude', model: 'sonnet', input: 1e6, cached: 0, output: 0 }) - 2) < 1e-9);
  assert.ok(costOf({ provider: 'claude', model: 'opus', input: 1e6, output: 1e5 }) > costOf({ provider: 'claude', model: 'haiku', input: 1e6, output: 1e5 }));
  assert.equal(costOf({ provider: 'codex', model: 'x', input: 0, output: 0 }), 0);
  // the cached part can never exceed the input (bad data must not give a negative cost)
  assert.ok(costOf({ provider: 'codex', model: 'sol', input: 100, cached: 9999, output: 0 }) >= 0);
});

test('modelo sem preço próprio usa o do provedor e avisa que não é exato', () => {
  assert.equal(priceOf('codex', 'gpt-6.1-sol').exact, true);
  assert.equal(priceOf('codex', 'gpt-6-luna').exact, false);
  assert.equal(priceOf('claude', 'fable').exact, false);
  assert.deepEqual([priceOf('claude', undefined).input, priceOf('codex', null).input], [2, 2]);
});

test('o supervisor soma o gasto por bot (hoje, semana, mês) e por dia', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-cost-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', ...selection, usage: { input: 1e6, cached: 0, output: 1e5 } }) });
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Atlas', ...selection });
  await app.rpc('chat.send', { botId: bot.id, requestId: crypto.randomUUID(), text: 'oi' });
  for (let i = 0; i < 200 && !app.db.usage().bots[bot.id]; i++) await new Promise(resolve => setTimeout(resolve, 10));
  const usage = (await app.rpc('state.get')).usage; const entry = usage.bots[bot.id];
  assert.deepEqual(entry.today, { input: 1e6, cached: 0, output: 1e5, turns: 1 });
  const expected = costOf({ provider: 'codex', model: 'test', input: 1e6, output: 1e5 });
  assert.ok(expected > 0 && Math.abs(entry.cost.today - expected) < 1e-9 && entry.cost.week === entry.cost.today && entry.cost.month === entry.cost.today);
  assert.equal(usage.days.length, 7); assert.ok(Math.abs(usage.days.at(-1).cost - expected) < 1e-9); assert.equal(usage.days[0].cost, 0);
});
