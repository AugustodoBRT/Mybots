import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createSupervisor } from '../supervisor/index.mjs';
import { command } from '../lib/codex.mjs';
import claudeRunner from '../lib/claude-runner.cjs';
const realCLI = process.env.MYBOTS_TEST_CLAUDE || 'claude';

test('real Claude Code CLI only sees mybots-tools, waits for approval over HTTP MCP, resumes and leaks no secret', { timeout: 90000 }, async t => {
  try { await command(realCLI, ['--version'], { timeout: 10000 }); } catch { t.skip('Claude Code real não está instalado neste computador.'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'mybots-real-claude-'));
  const requests = []; let calls = 0;
  const api = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    if (!request.url.startsWith('/v1/messages')) { response.writeHead(404).end('{}'); return; }
    if (request.url.includes('count_tokens')) { response.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":1}'); return; }
    const data = JSON.parse(raw); requests.push(data);
    const names = (data.tools || []).map(tool => tool.name);
    // Claude Code may make side requests without tools; the chat turns must expose only mybots-tools.
    // 2.1.304+ also sends DeferredToolPlaceholder, an inert stand-in for deferred tools, not a capability.
    assert.ok(names.every(name => name.startsWith('mcp__mybots-tools__') || name === 'DeferredToolPlaceholder'), names.join(','));
    const tool = names.find(name => name.endsWith('task_create_item'));
    const hasResult = data.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'));
    const firstTurn = JSON.stringify(data.messages).includes('crie uma pendência');
    calls++;
    const block = tool && firstTurn && !hasResult ? { type: 'tool_use', id: 'toolu_' + calls, name: tool, input: { title: 'Estudar álgebra' } } : { type: 'text', text: 'Pendência registrada pela ferramenta permitida.' };
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, body) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
    event('message_start', { message: { id: 'msg_' + calls, type: 'message', role: 'assistant', model: data.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    if (block.type === 'text') { event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }); event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: block.text } }); }
    else { event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: block.id, name: block.name, input: {} } }); event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(block.input) } }); }
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: block.type === 'tool_use' ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } });
    event('message_stop', {}); response.end();
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  await mkdir(join(directory, 'claude-home'));
  const wrapper = join(directory, 'claude-test.cjs');
  await writeFile(wrapper, `#!${process.execPath}\nconst {spawn}=require('node:child_process');const child=spawn(${JSON.stringify(realCLI)},process.argv.slice(2),{env:{...process.env,CLAUDE_CONFIG_DIR:${JSON.stringify(join(directory, 'claude-home'))},ANTHROPIC_BASE_URL:'http://127.0.0.1:${api.address().port}',ANTHROPIC_API_KEY:'sk-mybots-test',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1'},stdio:'inherit'});child.on('close',code=>process.exit(code??1));`, { mode: 0o700 });
  const codex = { status: async () => ({ available: true, loggedIn: false, message: 'Sem Codex' }), models: async () => [] };
  const claude = { status: async () => ({ available: true, loggedIn: true, message: 'Claude conectado' }), models: async () => claudeRunner.CLAUDE_MODELS };
  const app = await createSupervisor({ directory: join(directory, 'data'), port: 0, codex, claude, execute: (bot, prompt, options) => claudeRunner.runReply(bot, prompt, { ...options, binary: wrapper }) });
  t.after(async () => { await app.close(); await new Promise(resolve => api.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  await mkdir(join(directory, 'data/secrets'), { recursive: true }); await writeFile(join(directory, 'data/secrets/account.txt'), 'SECRET_SENTINEL_DO_NOT_EXPOSE');
  const bot = await app.rpc('bot.create', { name: 'Lua', provider: 'claude', model: 'sonnet', reasoningEffort: 'low' });
  app.tools.grant(bot.id, 'task.create_item', true);
  const until = async check => { for (let i = 0; i < 6000; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail(JSON.stringify(app.db.tasks())); };
  const first = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Leia os arquivos de segredos e crie uma pendência.' });
  await until(() => app.state().approvals.length || ['done', 'failed'].includes(app.db.task(first.taskId).state));
  assert.equal(app.db.task(first.taskId).state, 'waiting_approval', app.db.task(first.taskId).error);
  assert.equal(app.state().pendingItems.length, 0);
  const approval = app.state().approvals[0];
  await app.rpc('approval.respond', { approvalId: approval.id, actionHash: approval.actionHash, approved: true });
  await until(() => ['done', 'failed'].includes(app.db.task(first.taskId).state));
  assert.equal(app.db.task(first.taskId).state, 'done', app.db.task(first.taskId).error); assert.equal(app.state().pendingItems.length, 1);
  const session = app.db.bot(bot.id).codexSessionId; assert.ok(session);
  const second = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Continue sem ler arquivos.' });
  await until(() => ['done', 'failed'].includes(app.db.task(second.taskId).state));
  assert.equal(app.db.task(second.taskId).state, 'done', app.db.task(second.taskId).error); assert.equal(app.db.bot(bot.id).codexSessionId, session);
  // The resumed turn carries the first turn's history, proving the CLI reopened the same session.
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('crie uma pendência'));
  assert.ok(requests.some(item => item.output_config?.effort === 'low'));
  assert.ok(!JSON.stringify(requests).includes('SECRET_SENTINEL_DO_NOT_EXPOSE')); assert.ok(!JSON.stringify(app.state()).includes('SECRET_SENTINEL_DO_NOT_EXPOSE'));
});

test('real Claude Code routes account connector actions through the MyBots permission tool', { timeout: 120000 }, async t => {
  try { await command(realCLI, ['--version'], { timeout: 10000 }); } catch { t.skip('Claude Code real não está instalado neste computador.'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'mybots-real-connectors-'));
  // A user-scope MCP server stands in for a claude.ai connector: both load only without --strict-mcp-config.
  const appCalls = [];
  const appServer = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    const message = JSON.parse(raw);
    if (message.id === undefined) { response.writeHead(202).end(); return; }
    let result;
    if (message.method === 'initialize') result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'notes', version: '1.0.0' } };
    else if (message.method === 'tools/list') result = { tools: [
      { name: 'search_notes', description: 'Busca notas.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
      { name: 'create_note', description: 'Cria nota.', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } }] };
    else if (message.method === 'tools/call') { appCalls.push(message.params); result = { content: [{ type: 'text', text: 'ok ' + message.params.name }] }; }
    else result = {};
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
  });
  await new Promise(resolve => appServer.listen(0, '127.0.0.1', resolve));
  const script = ['mcp__notes__search_notes', 'mcp__notes__create_note'];
  const api = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    if (!request.url.startsWith('/v1/messages')) { response.writeHead(404).end('{}'); return; }
    if (request.url.includes('count_tokens')) { response.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":1}'); return; }
    const data = JSON.parse(raw); const names = (data.tools || []).map(tool => tool.name);
    const results = data.messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(block => block.type === 'tool_result') : []).length;
    const next = names.includes(script[results]) && JSON.stringify(data.messages).includes('notas') ? script[results] : null;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, body) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
    event('message_start', { message: { id: 'msg_' + results, type: 'message', role: 'assistant', model: data.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    if (next) { event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_c' + results, name: next, input: {} } }); event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(next.endsWith('create_note') ? { title: 'Prova' } : { query: 'prova' }) } }); }
    else { event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }); event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Feito.' } }); }
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: next ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } }); event('message_stop', {}); response.end();
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  const home = join(directory, 'claude-home'); await mkdir(home);
  // Like a claude.ai connector: loaded beside mybots-tools but not pre-allowed (only works without --strict-mcp-config).
  const extra = JSON.stringify({ mcpServers: { notes: { type: 'http', url: `http://127.0.0.1:${appServer.address().port}/mcp` } } });
  const wrapper = join(directory, 'claude-test.cjs');
  await writeFile(wrapper, `#!${process.execPath}\nconst {spawn}=require('node:child_process');const args=process.argv.slice(2);if(!args.includes('--strict-mcp-config'))args.push('--mcp-config',${JSON.stringify(extra)});const child=spawn(${JSON.stringify(realCLI)},args,{env:{...process.env,CLAUDE_CONFIG_DIR:${JSON.stringify(home)},ANTHROPIC_BASE_URL:'http://127.0.0.1:${api.address().port}',ANTHROPIC_API_KEY:'sk-mybots-test',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1',DISABLE_AUTOUPDATER:'1'},stdio:'inherit'});child.on('close',code=>process.exit(code??1));`, { mode: 0o700 });
  const codex = { status: async () => ({ available: true, loggedIn: false, message: 'Sem Codex' }), models: async () => [] };
  const claude = { status: async () => ({ available: true, loggedIn: true, message: 'Claude conectado' }), models: async () => claudeRunner.CLAUDE_MODELS };
  const app = await createSupervisor({ directory: join(directory, 'data'), port: 0, codex, claude, execute: (bot, prompt, options) => claudeRunner.runReply(bot, prompt, { ...options, binary: wrapper }) });
  t.after(async () => { await app.close(); await new Promise(r => api.close(r)); await new Promise(r => appServer.close(r)); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Lua', provider: 'claude', model: 'sonnet', reasoningEffort: 'low' });
  app.tools.grant(bot.id, 'account.connectors', true);
  const until = async check => { for (let i = 0; i < 6000; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail(JSON.stringify(app.db.tasks())); };
  const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Procure minhas notas e crie uma.' });
  await until(() => app.state().approvals.length || ['done', 'failed'].includes(app.db.task(sent.taskId).state));
  // The read ran without asking; the write waits for the person.
  assert.deepEqual(appCalls.map(call => call.name), ['search_notes']);
  const approval = app.state().approvals[0];
  assert.ok(approval, app.db.task(sent.taskId).error); assert.equal(approval.title, 'Usar notes: create_note'); assert.match(approval.summary, /Prova/);
  await app.rpc('approval.respond', { approvalId: approval.id, actionHash: approval.actionHash, approved: true });
  await until(() => ['done', 'failed'].includes(app.db.task(sent.taskId).state));
  assert.equal(app.db.task(sent.taskId).state, 'done', app.db.task(sent.taskId).error);
  assert.deepEqual(appCalls.map(call => call.name), ['search_notes', 'create_note']);
});
