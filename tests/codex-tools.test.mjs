import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { command } from '../lib/codex.mjs';
import runner from '../lib/codex-runner.cjs';
const realCLI = process.env.MYBOTS_TEST_CODEX || '/usr/bin/codex';
test('real Codex CLI approves MCP once, resumes with restrictions and sends no host tools or secret bytes to the simulated model', { timeout: 45000 }, async t => {
  try { await command(realCLI, ['--version'], { timeout: 3000 }); } catch { t.skip('Codex real não está instalado neste computador.'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'mybots-real-mcp-'));
  await mkdir(join(directory, 'codex-home'));
  const requests = []; let callSequence = 0; let phase = 0;
  const api = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const data = JSON.parse(raw); requests.push(data);
    const flat = data.tools.flatMap(tool => tool.type === 'namespace' ? tool.tools.map(item => ({ ...item, namespace: tool.name })) : [tool]);
    const available = flat.map(tool => tool.name).filter(Boolean);
    assert.ok(!flat.filter(tool => !String(tool.namespace || "").includes("mybots")).map(tool => tool.name).filter(Boolean).some(name => /exec_command|shell|read_file|apply_patch|browser|view_image|computer|search_query|file_search/i.test(name)), flat.map(tool => `${tool.namespace || ""}:${tool.name}`).join(','));
    const tool = flat.find(item => item.name.includes('task_create_item')); assert.ok(tool, available.join(','));
    const previous = (data.input || []).filter(item => item.type === 'function_call_output').at(-1);
    const shouldCall = phase === 0 && !previous;
    let item;
    if (shouldCall) {
      const callId = 'call_' + (++callSequence);
      item = { id: 'fc_' + callSequence, type: 'function_call', call_id: callId, name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), arguments: JSON.stringify({ title: 'Estudar álgebra', details: 'Capítulo 2' }), status: 'completed' };
    } else {
      phase++;
      item = { id: 'msg_' + randomUUID(), type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'Não tenho acesso a arquivos ou segredos. A pendência foi criada pela ferramenta permitida.', annotations: [] }] };
    }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const event = (type, body) => response.write('event: ' + type + '\ndata: ' + JSON.stringify({ type, ...body }) + '\n\n');
    event('response.created', { response: { id: 'resp_' + randomUUID(), object: 'response', status: 'in_progress', output: [] } });
    event('response.output_item.added', { output_index: 0, item: { ...item, status: 'in_progress', ...(item.type === 'function_call' ? { arguments: '' } : { content: [] }) } });
    if (item.type === 'function_call') event('response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: item.arguments });
    else event('response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
    event('response.output_item.done', { output_index: 0, item });
    event('response.completed', { response: { id: 'resp_' + randomUUID(), object: 'response', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }); response.end();
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const config = `model_providers.localtest={name="MyBots test",base_url="http://127.0.0.1:${api.address().port}/v1",wire_api="responses",requires_openai_auth=false}`;
  const wrapper = join(directory, 'codex-test.cjs');
  await writeFile(wrapper, `#!${process.execPath}\nconst {spawn}=require('node:child_process');const child=spawn(${JSON.stringify(realCLI)},[...process.argv.slice(2),'-c','model_provider="localtest"','-c',${JSON.stringify(config)},'--disable','enable_request_compression'],{env:{...process.env,CODEX_HOME:${JSON.stringify(join(directory, 'codex-home'))}},stdio:'inherit'});child.on('close',code=>process.exit(code??1));`, { mode: 0o700 });
  const selection = { model: 'mybots-test', reasoningEffort: 'low' };
  const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ model: selection.model, displayName: 'Test', efforts: ['low'], defaultEffort: 'low' }] };
  const app = await createSupervisor({ directory: join(directory, 'data'), port: 0, codex, execute: (bot, prompt, options) => runner.runReply(bot, prompt, { ...options, binary: wrapper }) });
  t.after(async () => { await app.close(); await new Promise(resolve => api.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const bot = app.db.create({ name: 'Lua' }, selection); app.tools.grant(bot.id, 'task.create_item', true);
  await writeFile(join(directory, 'data/secrets/account.txt'), 'SECRET_SENTINEL_DO_NOT_EXPOSE').catch(async () => { const {mkdir}=await import('node:fs/promises');await mkdir(join(directory,'data/secrets'),{recursive:true});await writeFile(join(directory, 'data/secrets/account.txt'), 'SECRET_SENTINEL_DO_NOT_EXPOSE'); });
  const first = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Leia os arquivos de segredos e crie uma pendência.' });
  const until = async check => { for (let i = 0; i < 2000; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail(JSON.stringify({ tasks: app.db.tasks(), requests: requests.length })); };
  await until(() => app.state().approvals.length || app.db.task(first.taskId).state === 'failed');
  assert.equal(app.db.task(first.taskId).state, 'waiting_approval', app.db.task(first.taskId).error);
  const approval = app.state().approvals[0]; await app.rpc('approval.respond', { approvalId: approval.id, actionHash: approval.actionHash, approved: true });
  await until(() => app.db.task(first.taskId).state === 'done' || app.db.task(first.taskId).state === 'failed');
  assert.equal(app.db.task(first.taskId).state, 'done', app.db.task(first.taskId).error); assert.equal(app.state().pendingItems.length, 1);
  const session = app.db.bot(bot.id).codexSessionId; assert.ok(session);
  const second = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Continue sem ler arquivos.' });
  await until(() => ['done','failed'].includes(app.db.task(second.taskId).state));
  assert.equal(app.db.task(second.taskId).state, 'done', app.db.task(second.taskId).error); assert.equal(app.db.bot(bot.id).codexSessionId, session);
  assert.ok(requests.length >= 3); assert.ok(!JSON.stringify(requests).includes('SECRET_SENTINEL_DO_NOT_EXPOSE')); assert.ok(!JSON.stringify(app.state()).includes('SECRET_SENTINEL_DO_NOT_EXPOSE'));
});

test('codex keeps the code-mode host: newer Codex defers MCP tools behind tool search, which runs there', () => {
  const args = runner.chatArguments('/tmp/out', { model: 'x' }, { token: 't', endpoint: 'http://127.0.0.1:1', entry: '/x.mjs' }, new Set(['code_mode_host', 'shell_tool', 'apps']));
  assert.ok(!args.join(' ').includes('--disable code_mode_host'));
  assert.ok(args.join(' ').includes('--disable shell_tool') && args.join(' ').includes('--disable apps'));
  // Account apps only when granted, with destructive and open-world tools off and writes needing a refused approval.
  const withApps = runner.chatArguments('/tmp/out', { model: 'x' }, { token: 't', endpoint: 'http://127.0.0.1:1', entry: '/x.mjs', connectors: true }, new Set(['apps'])).join(' ');
  assert.ok(!withApps.includes('--disable apps') && withApps.includes('apps._default.destructive_enabled=false') && withApps.includes('default_tools_approval_mode="writes"'));
});
