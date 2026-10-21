import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { command } from '../lib/codex.mjs';
import { createSupervisor } from '../supervisor/index.mjs';
import runner from '../lib/claude-runner.cjs';

// Real CLI, deterministic model and native-tool stand-in: verifies the hook also gates pre-allowed tools.
test('real Claude CLI: native Chrome hook allows, denies and fails closed before a pre-allowed tool executes', { timeout: 90000 }, async t => {
  const binary = process.env.MYBOTS_TEST_CLAUDE || 'claude';
  try { await command(binary, ['--version'], { timeout: 10000 }); } catch { t.skip('Claude Code não instalado.'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'mybots-chrome-cli-'));
  let executions = 0; const receipts = [];
  const native = createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    let raw = ''; for await (const c of req) raw += c; const data = JSON.parse(raw);
    if (data.id === undefined) { res.writeHead(202).end(); return; }
    if (data.method === 'server/discover') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: data.id, error: { code: -32601, message: 'Method not found' } })); return; }
    let result = {}; 
    if (data.method === 'initialize') result = { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'chrome-test', version: '1' } };
    if (data.method === 'tools/list') result = { tools: [{ name: 'read_page', description: 'Read test page', inputSchema: { type: 'object', properties: {} } }] };
    if (data.method === 'tools/call') { executions++; result = { content: [{ type: 'text', text: 'Página de teste' }] }; }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: data.id, result }));
  });
  const api = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c;
    if (!req.url.startsWith('/v1/messages')) { res.writeHead(404).end('{}'); return; }
    if (req.url.includes('count_tokens')) { res.end('{"input_tokens":1}'); return; }
    const data = JSON.parse(raw);
    const result = data.messages.flatMap(m => Array.isArray(m.content) ? m.content.filter(b => b.type === 'tool_result') : []);
    const tool = !result.length && data.tools?.find(x => x.name === 'mcp__chrome-test__read_page');
    if (result.length) receipts.push(JSON.stringify(result));
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, body) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
    event('message_start', { message: { id: 'msg_test', type: 'message', role: 'assistant', model: data.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    if (tool) { event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_test', name: tool.name, input: {} } }); event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: '{}' } }); }
    else { event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }); event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Concluído.' } }); }
    event('content_block_stop', { index: 0 }); event('message_delta', { delta: { stop_reason: tool ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } }); event('message_stop', {}); res.end();
  });
  for (const server of [native, api]) await new Promise(r => server.listen(0, '127.0.0.1', r));
  const gate = createServer(async (req, res) => {
    let raw = ''; for await (const c of req) raw += c; const body = JSON.parse(raw);
    body.tool_name = body.tool_name.replace('mcp__chrome-test__', 'mcp__claude-in-chrome__');
    const reply = await fetch(`http://127.0.0.1:${app.port}/tools/chrome`, { method: 'POST', headers: { Authorization: req.headers.authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    res.writeHead(reply.status, { 'Content-Type': 'application/json' }).end(await reply.text());
  });
  await new Promise(r => gate.listen(0, '127.0.0.1', r));
  const app = await createSupervisor({ directory: join(directory, 'phone'), port: 0, codex: { status: async () => ({ loggedIn: false }), models: async () => [] } });
  t.after(async () => { await app.close(); for (const server of [native, api, gate]) { server.closeAllConnections(); await new Promise(r => server.close(r)); }; await rm(directory, { recursive: true, force: true }); });
  app.tools.pcCommand = async () => ({ ready: true });
  const bot = app.db.create({ name: 'Chrome', home: 'pc', access: 'ask' }, { provider: 'claude', model: 'haiku', reasoningEffort: 'low' });
  app.db.putBot({ ...app.db.requireBot(bot.id), mainChrome: true });
  app.tools.grant(bot.id, 'browser', true);
  const config = join(directory, 'config'); await mkdir(config);
  const extra = JSON.stringify({ mcpServers: { 'chrome-test': { type: 'http', url: `http://127.0.0.1:${native.address().port}/mcp` } } });
  const wrapper = join(directory, 'claude.cjs');
  await writeFile(wrapper, `#!${process.execPath}\nconst {spawn}=require('node:child_process');const args=process.argv.slice(2).map(x=>x==='--chrome'?'--no-chrome':x);if(args.includes('--settings')){const i=args.indexOf('--settings')+1;const s=JSON.parse(args[i]);s.hooks.PreToolUse[0].matcher='^mcp__chrome-test__';s.hooks.PreToolUse[0].hooks[0].url=require('fs').readFileSync(${JSON.stringify(join(directory, 'mode'))},'utf8')==='network'?'http://127.0.0.1:1':'http://127.0.0.1:${gate.address().port}';args[i]=JSON.stringify(s);}if(!args.includes('--version'))args.push('--mcp-config',${JSON.stringify(extra)},'--allowedTools','mcp__chrome-test');const c=spawn(${JSON.stringify(binary)},args,{stdio:'inherit',env:{...process.env,CLAUDE_CONFIG_DIR:${JSON.stringify(config)},ANTHROPIC_BASE_URL:'http://127.0.0.1:${api.address().port}',ANTHROPIC_API_KEY:'sk-mybots-test',DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}});c.on('close',code=>process.exit(code??1));`, { mode: 0o700 });
  for (const mode of ['allow', 'deny', 'network']) {
    const task = app.db.start(app.db.enqueue(bot.id, randomUUID(), 'teste', { provider: 'claude', model: 'haiku' }).id); const cap = app.tools.open(task, undefined, 'pc');
    if (mode === 'deny') app.tools.grant(bot.id, 'browser', false);
    const endpoint = `http://127.0.0.1:${app.port}`;
    await writeFile(join(directory, 'mode'), mode);
    await runner.runReply({ model: 'haiku' }, 'Leia a página de teste uma vez.', { binary: wrapper, workspace: directory, maxMs: 35000, tools: { chrome: true, token: cap.token, endpoint } });
    cap.close(); assert.equal(executions, 1, mode);
  }
  assert.match(receipts[0], /Página de teste/); assert.match(receipts[1], /negada|permissão/i); assert.match(receipts.at(-1), /block|hook|connect/i);
});
