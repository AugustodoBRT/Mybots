import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { Store } from '../lib/store.mjs';
import { chatArguments, promptFor, Codex, command } from '../lib/codex.mjs';
import { createApp } from '../server.mjs';
import { normalizeModels, selectionFor, discoverModels } from '../lib/models.mjs';
import { mergeBotLists, normalizeModels as normalizeLocalModels, promptFor as localPromptFor, selectionFor as localSelectionFor } from '../mobile/local.js';

const MODELS = [
  { model: 'gpt-6-luna', displayName: 'GPT-6 Luna', isDefault: true, efforts: ['low', 'medium', 'high', 'max'], defaultEffort: 'medium' },
  { model: 'gpt-6-astra', displayName: 'GPT-6 Astra', isDefault: false, efforts: ['medium', 'high', 'max', 'ultra'], defaultEffort: 'medium' }
];

async function fixture(t, reply = async () => 'Oi, podemos conversar!') {
  const directory = mkdtempSync(join(tmpdir(), 'mybots-test-'));
  const app = createApp({ directory, codex: {
    status: async () => ({ available: true, loggedIn: true, message: 'Codex conectado' }),
    models: async () => MODELS,
    reply: async (...args) => {
      const result = await reply(...args);
      return { ...(typeof result === 'string' ? { text: result } : result), model: args[0].model, reasoningEffort: args[0].reasoningEffort };
    }
  } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  await app.refreshConnection();
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const start = await fetch(base + '/?key=' + app.token, { redirect: 'manual' });
  assert.equal(start.status, 303);
  const cookie = start.headers.get('set-cookie').split(';')[0];
  const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-MyBots': '1' };
  return { app, directory, base, headers,
    get: async () => (await fetch(base + '/api/state', { headers })).json(),
    post: (path, value, extra = {}) => fetch(base + path, { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify(value) }) };
}

async function until(check) {
  for (let i = 0; i < 100; i++) {
    if (await check()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail('A resposta não chegou no tempo esperado.');
}

test('create two bots, isolate conversations, persist replies after restart', async t => {
  const f = await fixture(t, async bot => `Olá, sou ${bot.name}.`);
  const first = await (await f.post('/api/bots', { name: 'Lua', instructions: 'Converse com leveza.' })).json();
  const second = await (await f.post('/api/bots', { name: 'Nico', color: 'blue' })).json();
  assert.equal((await f.post(`/api/bots/${first.id}/messages`, { text: 'Oi!' })).status, 202);
  await until(async () => (await f.get()).active.length === 0);
  const state = await f.get();
  assert.deepEqual(state.bots[0].messages.map(message => message.text), ['Oi!', 'Olá, sou Lua.']);
  assert.equal(state.bots[1].messages.length, 0);
  assert.ok(second.id !== first.id);
  assert.equal(statSync(join(f.directory, 'bots.json')).mode & 0o777, 0o600);
  await f.app.close();
  const reopened = new Store(f.directory);
  assert.equal(reopened.get(first.id).messages[1].text, 'Olá, sou Lua.');
  reopened.close();
});

test('duplicate sends are rejected while Codex is thinking', async t => {
  let complete;
  const f = await fixture(t, () => new Promise(resolve => { complete = resolve; }));
  const bot = await (await f.post('/api/bots', { name: 'Nico' })).json();
  assert.equal((await f.post(`/api/bots/${bot.id}/messages`, { text: 'Oi' })).status, 202);
  assert.equal((await f.post(`/api/bots/${bot.id}/messages`, { text: 'Duplicada' })).status, 409);
  complete('Olá!');
  await until(async () => (await f.get()).active.length === 0);
  assert.equal((await f.get()).bots[0].messages.length, 2);
});

test('a failed reply is saved as an error and bot accepts a new message', async t => {
  let calls = 0;
  const f = await fixture(t, async () => { if (calls++ === 0) throw new Error('Sem conexão.'); return 'Conectou!'; });
  const bot = await (await f.post('/api/bots', { name: 'Lua' })).json();
  await f.post(`/api/bots/${bot.id}/messages`, { text: 'Primeira' });
  await until(async () => (await f.get()).active.length === 0);
  assert.equal((await f.get()).bots[0].messages[0].status, 'error');
  await f.post(`/api/bots/${bot.id}/messages`, { text: 'Segunda' });
  await until(async () => (await f.get()).active.length === 0);
  assert.equal((await f.get()).bots[0].messages.at(-1).text, 'Conectou!');
});

test('access requires a startup key and rejects foreign origins, missing CSRF header and foreign hosts', async t => {
  const f = await fixture(t);
  assert.equal((await fetch(f.base + '/api/state')).status, 401);
  assert.equal((await fetch(f.base + '/?key=wrong')).status, 401);
  assert.equal((await f.post('/api/bots', { name: 'Bot' }, { Origin: 'https://other.example' })).status, 403);
  assert.equal((await f.post('/api/bots', { name: 'Bot' }, { 'X-MyBots': '' })).status, 403);
  const foreignHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(f.base + '/api/state', { headers: { ...f.headers, Host: 'other.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject);
    request.end();
  });
  assert.equal(foreignHostStatus, 403);
});

test('native API access requires the bearer token and accepts the configured LAN host', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mybots-lan-test-'));
  const app = createApp({ directory, host: '192.168.1.24', accessToken: 'mobile-session-token', codex: {
    status: async () => ({ available: true, loggedIn: true, message: 'Codex conectado' }), models: async () => MODELS
  } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const state = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/state', { headers: {
      Host: `192.168.1.24:${app.server.address().port}`, Authorization: 'Bearer mobile-session-token'
    } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(state, 200);
  const created = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/bots', { method: 'POST', headers: {
      Host: `192.168.1.24:${app.server.address().port}`, Authorization: 'Bearer mobile-session-token',
      'X-MyBots': '1', Origin: 'exp://192.168.1.24:8081', 'Content-Type': 'application/json'
    } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end(JSON.stringify({ name: 'Bot nativo', model: 'gpt-6-luna', reasoningEffort: 'medium' }));
  });
  assert.equal(created, 201);
  const denied = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/state', { headers: {
      Host: `192.168.1.24:${app.server.address().port}`, Authorization: 'Bearer wrong-token'
    } }, response => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject); request.end();
  });
  assert.equal(denied, 401);
});

test('sync merges phone and computer histories by id without replacing existing messages', async t => {
  const f = await fixture(t);
  const bot = f.app.store.create({ name: 'Lua', instructions: 'Leveza.', color: 'green' });
  f.app.store.configure(bot, { model: 'gpt-6-luna', reasoningEffort: 'medium' });
  const first = f.app.store.addMessage(bot, 'user', 'Oi!', 'complete', { model: 'gpt-6-luna', reasoningEffort: 'medium' });
  const addedId = 'f9e27e02-0f2e-4a82-a5d0-40e2346ae298';
  const backup = structuredClone(bot);
  backup.messages.push({ id: addedId, role: 'assistant', text: 'Oi, tudo bem?', status: 'complete', model: 'gpt-6-luna', reasoningEffort: 'medium', createdAt: new Date(Date.now() + 1000).toISOString() });
  backup.updatedAt = new Date(Date.now() + 1000).toISOString();
  const response = await f.post('/api/sync', { bots: [backup] });
  assert.equal(response.status, 200);
  const messages = (await f.get()).bots[0].messages;
  assert.equal(messages.filter(message => message.id === first.id).length, 1);
  assert.deepEqual(messages.map(message => message.text), ['Oi!', 'Oi, tudo bem?']);
  assert.equal((await f.post('/api/sync', { bots: [backup] })).status, 200);
  assert.equal((await f.get()).bots[0].messages.length, 2);
});

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

test('validates name, instructions, color, message size and JSON without modifying bots', async t => {
  const f = await fixture(t);
  for (const value of [null, [], { name: ' ' }, { name: 'a'.repeat(41) }, { name: 'Bot', color: 'red' }, { name: 'Bot', instructions: 'a'.repeat(2001) }]) {
    assert.equal((await f.post('/api/bots', value)).status, 400);
  }
  assert.equal((await f.get()).bots.length, 0);
  const bot = await (await f.post('/api/bots', { name: 'Bot' })).json();
  for (const value of [null, { text: '' }, { text: 'x'.repeat(8001) }]) {
    assert.equal((await f.post(`/api/bots/${bot.id}/messages`, value)).status, 400);
  }
  assert.equal((await f.get()).bots[0].messages.length, 0);
  assert.equal((await fetch(f.base + '/api/bots', { method: 'POST', headers: f.headers, body: '{broken' })).status, 400);
});

test('missing Codex login is reported without saving a pending message', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mybots-no-login-'));
  const app = createApp({ directory, codex: { status: async () => ({ available: true, loggedIn: false, message: 'Faça login.' }) } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const b = app.store.create({ name: 'Bot' });
  const response = await fetch(base + `/api/bots/${b.id}/messages`, { method: 'POST',
    headers: { Cookie: `mybots=${app.token}`, 'Content-Type': 'application/json', 'X-MyBots': '1' }, body: JSON.stringify({ text: 'Oi' }) });
  assert.equal(response.status, 503);
  assert.equal(b.messages.length, 0);
});

test('restart recovers interrupted messages and refuses a second writer', t => {
  const directory = mkdtempSync(join(tmpdir(), 'mybots-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = new Store(directory);
  const bot = store.create({ name: 'Nico' });
  store.addMessage(bot, 'user', 'Oi', 'pending');
  assert.throws(() => new Store(directory), /Já existe/);
  store.close();
  const reopened = new Store(directory);
  assert.equal(reopened.get(bot.id).messages[0].status, 'error');
  reopened.close();
  writeFileSync(join(directory, 'bots.json'), '{corrupted');
  assert.throws(() => new Store(directory), /preservados/);
  assert.equal(readFileSync(join(directory, 'bots.json'), 'utf8'), '{corrupted');
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

test('model and reasoning selection persists, reaches the runner, and identifies each response', async t => {
  const configurations = [];
  const f = await fixture(t, async bot => { configurations.push([bot.model, bot.reasoningEffort]); return 'Resposta.'; });
  const bot = await (await f.post('/api/bots', { name: 'Astra', model: 'gpt-6-astra', reasoningEffort: 'ultra' })).json();
  assert.equal(bot.model, 'gpt-6-astra');
  assert.equal(bot.reasoningEffort, 'ultra');
  await f.post(`/api/bots/${bot.id}/messages`, { text: 'Primeira' });
  await until(async () => (await f.get()).active.length === 0);
  assert.equal((await f.post(`/api/bots/${bot.id}/settings`, { model: 'gpt-6-luna', reasoningEffort: 'max' })).status, 200);
  await f.post(`/api/bots/${bot.id}/messages`, { text: 'Segunda' });
  await until(async () => (await f.get()).active.length === 0);
  assert.deepEqual(configurations, [['gpt-6-astra', 'ultra'], ['gpt-6-luna', 'max']]);
  const messages = (await f.get()).bots[0].messages;
  assert.deepEqual(messages.filter(message => message.role === 'assistant').map(message => [message.model, message.reasoningEffort]), configurations);
  const saved = JSON.parse(readFileSync(join(f.directory, 'bots.json'), 'utf8'))[0];
  assert.equal(saved.model, 'gpt-6-luna');
  assert.equal(saved.reasoningEffort, 'max');
  assert.equal(saved.messages[1].model, 'gpt-6-astra');
  const args = chatArguments('/tmp/reply', saved);
  assert.equal(args[args.indexOf('--model') + 1], 'gpt-6-luna');
  assert.ok(args.includes('model_reasoning_effort="max"'));
});

test('unsupported model or reasoning never silently falls back or modifies settings', async t => {
  const f = await fixture(t);
  const bot = await (await f.post('/api/bots', { name: 'Bot', model: 'gpt-6-luna', reasoningEffort: 'high' })).json();
  for (const value of [
    { model: 'nonexistent', reasoningEffort: 'max' },
    { model: 'gpt-6-luna', reasoningEffort: 'ultra' },
    { model: '', reasoningEffort: 'high' },
    { model: 'gpt-6-luna', reasoningEffort: 'fake' }
  ]) assert.equal((await f.post(`/api/bots/${bot.id}/settings`, value)).status, 400);
  const saved = (await f.get()).bots[0];
  assert.equal(saved.model, 'gpt-6-luna');
  assert.equal(saved.reasoningEffort, 'high');
  assert.equal((await f.post('/api/bots', { name: 'Invalido', model: 'nonexistent' })).status, 400);
  assert.equal((await f.get()).bots.length, 1);
});

test('settings are locked for a pending reply and legacy responses are not relabeled', async t => {
  let complete;
  const f = await fixture(t, () => new Promise(resolve => { complete = resolve; }));
  const bot = await (await f.post('/api/bots', { name: 'Bot' })).json();
  const saved = f.app.store.get(bot.id);
  f.app.store.addMessage(saved, 'assistant', 'Resposta antiga.');
  await f.post(`/api/bots/${bot.id}/messages`, { text: 'Oi' });
  assert.equal((await f.post(`/api/bots/${bot.id}/settings`, { model: 'gpt-6-astra', reasoningEffort: 'max' })).status, 409);
  assert.equal((await f.get()).bots[0].model, 'gpt-6-luna');
  complete('Olá');
  await until(async () => (await f.get()).active.length === 0);
  const messages = (await f.get()).bots[0].messages;
  assert.equal(messages[0].model, undefined);
  assert.equal(messages.at(-1).model, 'gpt-6-luna');
  assert.equal(messages.at(-1).reasoningEffort, 'medium');
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


test('computer API persists its own session and keeps it when phone histories are merged', async t => {
  const id = '0199a213-81c0-7800-8aa1-bbab2a035a53';
  const sessions = [];
  const f = await fixture(t, async bot => { sessions.push(bot.codexSessionId); return { text: 'Resposta', codexSessionId: id }; });
  const bot = await (await f.post('/api/bots', { name: 'Lua' })).json();
  await f.post(`/api/bots/${bot.id}/messages`, { text: 'Primeira' });
  await until(async () => (await f.get()).active.length === 0);
  await f.post(`/api/bots/${bot.id}/messages`, { text: 'Segunda' });
  await until(async () => (await f.get()).active.length === 0);
  assert.deepEqual(sessions, [undefined, id]);
  const backup = structuredClone(f.app.store.get(bot.id));
  backup.codexSessionId = '0199a213-81c0-7800-8aa1-bbab2a035a54';
  assert.equal((await f.post('/api/sync', { bots: [backup] })).status, 200);
  assert.equal(f.app.store.get(bot.id).codexSessionId, id);
  assert.equal(JSON.parse(readFileSync(join(f.directory, 'bots.json'), 'utf8'))[0].codexSessionId, id);
});

test('deleting a bot hides it, blocks its reuse and prevents stale sync from restoring it', async t => {
  const f = await fixture(t);
  const created = await (await f.post('/api/bots', { name: 'Apagar' })).json();
  const backup = structuredClone(f.app.store.get(created.id));
  assert.equal((await f.post(`/api/bots/${created.id}/delete`, {})).status, 200);
  assert.equal((await f.get()).bots.length, 0);
  assert.equal((await f.post(`/api/bots/${created.id}/messages`, { text: 'Oi' })).status, 404);
  assert.equal((await f.post('/api/sync', { bots: [backup] })).status, 200);
  assert.equal((await f.get()).bots.length, 0);
  assert.equal((await f.get()).deletedBots[0].id, created.id);
});

test('a running bot cannot be deleted', async t => {
  let complete;
  const f = await fixture(t, () => new Promise(resolve => { complete = resolve; }));
  const bot = await (await f.post('/api/bots', { name: 'Ocupado' })).json();
  await f.post(`/api/bots/${bot.id}/messages`, { text: 'Oi' });
  assert.equal((await f.post(`/api/bots/${bot.id}/delete`, {})).status, 409);
  complete('Oi');
  await until(async () => !(await f.get()).active.length);
});
