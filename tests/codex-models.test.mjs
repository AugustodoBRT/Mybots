import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { chatArguments, promptFor, Codex, command } from '../lib/codex.mjs';
import { normalizeModels, selectionFor, discoverModels } from '../lib/models.mjs';
import { mergeBotLists, normalizeModels as normalizeLocalModels, promptFor as localPromptFor, selectionFor as localSelectionFor } from '../mobile/local.js';

const MODELS = [
  { model: 'gpt-6-luna', displayName: 'GPT-6 Luna', isDefault: true, efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'medium' },
  { model: 'gpt-6-astra', displayName: 'GPT-6 Astra', isDefault: false, efforts: ['medium', 'high', 'max', 'ultra'], defaultEffort: 'medium' }
];

test('phone merge is idempotent, keeps the newest settings, and upgrades a pending message', () => {
  const botId = 'edce81af-4694-43c9-9cb1-0f0d2198f439';
  const messageId = 'f9e27e02-0f2e-4a82-a5d0-40e2346ae298';
  const earlier = { id: botId, name: 'Lua', instructions: '', color: 'green', model: 'gpt-6-luna', reasoningEffort: 'low',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z',
    messages: [{ id: messageId, role: 'user', text: 'Oi', status: 'pending', createdAt: '2026-01-01T00:00:01.000Z' }] };
  const later = { ...earlier, name: 'Lua nova', model: 'gpt-6-astra', reasoningEffort: 'high', updatedAt: '2026-01-01T00:00:02.000Z',
    messages: [{ ...earlier.messages[0], status: 'complete', model: 'gpt-6-astra', reasoningEffort: 'high' }] };
  const merged = mergeBotLists([earlier], [later, later]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, 'Lua nova');
  assert.equal(merged[0].messages.length, 1);
  assert.equal(merged[0].messages[0].status, 'complete');
  const models = normalizeLocalModels([{ model: 'dynamic-model', displayName: 'Dynamic', isDefault: true,
    defaultReasoningEffort: 'medium', supportedReasoningEfforts: [{ reasoningEffort: 'low' }, { reasoningEffort: 'medium' }] }]);
  assert.deepEqual(localSelectionFor(models), { model: 'dynamic-model', reasoningEffort: 'medium' });
  assert.match(localPromptFor({ ...merged[0], messages: [{ id: messageId, role: 'user', text: 'Oi', status: 'pending' }] }, messageId), /"text":"Oi"/);
});

test('prompt keeps personality and separate roles, skips failed messages and bounds recent context', () => {
  const bot = { name: 'Lua', instructions: 'Seja curiosa.', messages: [
    { id: 'failed', role: 'user', text: 'ignorar este erro', status: 'error' },
    { id: 'old', role: 'user', text: 'a'.repeat(90001), status: 'complete' },
    { id: 'current', role: 'user', text: 'Oi!', status: 'pending' }
  ] };
  const prompt = promptFor(bot, 'current');
  assert.match(prompt, /Seja curiosa/);
  assert.match(prompt, /O início da conversa não está/);
  assert.ok(!prompt.includes('ignorar este erro'));
  assert.match(prompt, /"role":"user","text":"Oi!"/);
  const args = chatArguments('/tmp/reply');
  assert.ok(args.includes('--ignore-user-config'));
  assert.ok(args.includes('--ignore-rules'));
  assert.ok(args.includes('shell_tool'));
  assert.ok(args.includes('read-only'));
  assert.ok(!args.some(arg => arg.includes('dangerously')));
});

test('Codex runner handles missing binary, process timeout and real subprocess output', async () => {
  const codex = new Codex('/does-not-exist/mybots-codex');
  assert.deepEqual(await codex.status(), { available: false, loggedIn: false, message: 'Instale o Codex neste aparelho para conversar.' });
  const output = await command(process.execPath, ['-e', "process.stdin.on('data', d => process.stdout.write(d))"], { input: 'Olá' });
  assert.equal(output.stdout, 'Olá');
  await assert.rejects(command(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 30 }), /demorou/);
});

test('catalog normalization preserves supported levels, excludes hidden/image-only models, and handles no reasoning', () => {
  const catalog = normalizeModels([
    { model: 'text', displayName: 'Texto', isDefault: true, supportedReasoningEfforts: [
      { reasoningEffort: 'low' }, { reasoningEffort: 'max' }, { reasoningEffort: 'max' }
    ], defaultReasoningEffort: 'max', inputModalities: ['text'] },
    { model: 'plain', supportedReasoningEfforts: [] },
    { model: 'secret', hidden: true }, { model: 'image', inputModalities: ['image'] }, null
  ]);
  assert.equal(catalog.length, 2);
  assert.deepEqual(catalog[0].efforts, ['low', 'max']);
  assert.deepEqual(selectionFor(catalog), { model: 'text', reasoningEffort: 'max' });
  assert.deepEqual(selectionFor(catalog, { model: 'plain' }), { model: 'plain', reasoningEffort: null });
  assert.throws(() => selectionFor(catalog, { model: 'plain', reasoningEffort: 'low' }), /compatível/);
});

test('catalog RPC initializes, paginates and normalizes without making an inference request', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mybots-rpc-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const binary = join(directory, 'codex-fake.mjs');
  writeFileSync(binary, `#!${process.execPath}\n
    import { createInterface } from 'node:readline';
    const reply = (id, result) => console.log(JSON.stringify({ id, result }));
    createInterface({input:process.stdin}).on('line', line => {
      const request = JSON.parse(line);
      if (request.method === 'initialize') reply(request.id, {});
      else if (request.method === 'initialized') return;
      else if (request.method === 'model/list') reply(request.id, {
        data: [{ model: request.params.cursor ? 'second' : 'first', isDefault: !request.params.cursor,
          supportedReasoningEfforts: [{reasoningEffort:'low'}], defaultReasoningEffort:'low' }],
        nextCursor: request.params.cursor ? null : 'next-page'
      });
      else process.exit(5);
    });
  `, { mode: 0o700 });
  const models = await discoverModels(binary);
  assert.deepEqual(models.map(model => model.model), ['first', 'second']);
  assert.equal(models[0].defaultEffort, 'low');
});


