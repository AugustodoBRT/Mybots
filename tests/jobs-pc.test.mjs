import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { createSupervisor } from '../supervisor/index.mjs';
import { createNode } from '../pc/server.mjs';

const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }] };
async function until(check, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); } assert.fail('Estado esperado não chegou.'); }
const freePort = () => new Promise(resolve => { const server = createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); }); });

test('a job started in a turn on the computer outlives it, and its end wakes the bot with the log', async t => {
  const phoneDir = await mkdtemp(join(tmpdir(), 'mybots-phone-')); const pcDir = await mkdtemp(join(tmpdir(), 'mybots-pc-')); const projects = join(pcDir, 'MyBots');
  const prompts = []; let results = [];
  const execute = async (bot, prompt, { tools, onSession }) => {
    prompts.push(prompt); results = [];
    const call = async (body, session) => { const response = await fetch(tools.endpoint + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(body) }); return { session: response.headers.get('mcp-session-id'), body: await response.json() }; };
    const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
    if (prompt.includes('inicie')) {
      for (const [name, args] of [['job_start', { command: 'sleep 0.5; echo resultado-do-job; exit 0', label: 'Build de teste' }], ['job_list', {}]]) results.push(JSON.stringify((await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, init.session)).body));
    }
    const id = randomUUID(); await onSession(id);
    return { text: prompt.includes('inicie') ? 'Iniciei, aviso quando acabar.' : 'Vi o resultado.', ...selection, codexSessionId: id };
  };
  const app = await createSupervisor({ directory: phoneDir, port: 0, codex, approvalMs: 5000, execute: async () => { throw new Error('não roda no celular'); } });
  const node = await createNode({ directory: pcDir, port: await freePort(), uiPort: 0, host: '127.0.0.1', advertise: () => ['127.0.0.1'], projects, execute, status: async () => ({ connections: { codex: { loggedIn: true } }, models: [] }) });
  t.after(async () => { await app.close(); await node.close(); await rm(phoneDir, { recursive: true, force: true }); await rm(pcDir, { recursive: true, force: true }); });
  await app.rpc('computer.pair', { link: node.pairing().link });
  await until(() => app.state().computer.state === 'online');
  const bot = await app.rpc('bot.create', { name: 'Dev', ...selection, home: 'pc', access: 'full' });
  const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'inicie o build' });
  await until(() => ['done', 'failed'].includes(app.db.task(sent.taskId).state));
  assert.equal(app.db.task(sent.taskId).state, 'done', app.db.task(sent.taskId).error);
  assert.match(results[0], /"where\\":\\"computador\\"|where.*computador/); assert.match(results[0], /running/); assert.match(results[1], /Build de teste/);
  // The turn is over; the job ends later and the bot is woken with its report.
  await until(() => prompts.some(text => text.includes('[Tarefa em fundo]')));
  const report = prompts.find(text => text.includes('[Tarefa em fundo]'));
  assert.match(report, /terminou bem \(código de saída 0\)/); assert.match(report, /resultado-do-job/);
  await until(() => app.db.messages(bot.id).some(message => message.origin === 'job'));
  assert.match(app.db.messages(bot.id).find(message => message.origin === 'job').routineTitle, /Build de teste/);
});
