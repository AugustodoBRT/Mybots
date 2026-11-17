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

test('real Claude Code: AskUserQuestion becomes a decision card and its answer resumes the bot', { timeout: 90000 }, async t => {
  try { await command(realCLI, ['--version'], { timeout: 10000 }); } catch { t.skip('Claude Code real não está instalado neste computador.'); return; }
  const directory = await mkdtemp(join(tmpdir(), 'mybots-real-ask-'));
  const requests = [];
  const api = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    if (!request.url.startsWith('/v1/messages')) { response.writeHead(404).end('{}'); return; }
    if (request.url.includes('count_tokens')) { response.writeHead(200, { 'content-type': 'application/json' }).end('{"input_tokens":1}'); return; }
    const data = JSON.parse(raw); requests.push(data);
    const names = (data.tools || []).map(tool => tool.name);
    const hasResult = data.messages.some(message => Array.isArray(message.content) && message.content.some(block => block.type === 'tool_result'));
    const wants = JSON.stringify(data.messages).includes('qual cor') && names.includes('AskUserQuestion') && !hasResult;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    const event = (type, body) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...body })}\n\n`);
    event('message_start', { message: { id: 'msg_' + requests.length, type: 'message', role: 'assistant', model: data.model, content: [], stop_reason: null, usage: { input_tokens: 1, output_tokens: 1 } } });
    if (wants) {
      event('content_block_start', { index: 0, content_block: { type: 'tool_use', id: 'toolu_ask', name: 'AskUserQuestion', input: {} } });
      event('content_block_delta', { index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify({ questions: [{ question: 'Qual cor você prefere?', header: 'Cor', multiSelect: false, options: [{ label: 'Azul', description: 'Mais calmo' }, { label: 'Verde', description: 'Mais vivo' }] }] }) } });
    } else { event('content_block_start', { index: 0, content_block: { type: 'text', text: '' } }); event('content_block_delta', { index: 0, delta: { type: 'text_delta', text: 'Mandei a pergunta, espero você.' } }); }
    event('content_block_stop', { index: 0 });
    event('message_delta', { delta: { stop_reason: wants ? 'tool_use' : 'end_turn' }, usage: { output_tokens: 1 } }); event('message_stop', {}); response.end();
  });
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
  await mkdir(join(directory, 'claude-home'));
  const wrapper = join(directory, 'claude-test.cjs');
  await writeFile(wrapper, `#!${process.execPath}\nconst {spawn}=require('node:child_process');const child=spawn(${JSON.stringify(realCLI)},process.argv.slice(2),{stdio:'inherit',env:{...process.env,CLAUDE_CONFIG_DIR:${JSON.stringify(join(directory, 'claude-home'))},ENABLE_TOOL_SEARCH:'false',ANTHROPIC_BASE_URL:'http://127.0.0.1:${api.address().port}',ANTHROPIC_API_KEY:'sk-mybots-test',DISABLE_AUTOUPDATER:'1',CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:'1'}});child.on('close',code=>process.exit(code??1));`, { mode: 0o700 });
  const codex = { status: async () => ({ available: true, loggedIn: false, message: 'Sem Codex' }), models: async () => [] };
  const claude = { status: async () => ({ available: true, loggedIn: true, message: 'Claude conectado' }), models: async () => claudeRunner.CLAUDE_MODELS };
  const app = await createSupervisor({ directory: join(directory, 'data'), port: 0, codex, claude, execute: (bot, prompt, options) => claudeRunner.runReply(bot, prompt, { ...options, binary: wrapper }) });
  t.after(async () => { await app.close(); await new Promise(resolve => api.close(resolve)); await rm(directory, { recursive: true, force: true }); });
  const bot = await app.rpc('bot.create', { name: 'Lua', provider: 'claude', model: 'sonnet', reasoningEffort: 'low' });
  const until = async check => { for (let i = 0; i < 6000; i++) { if (check()) return; await new Promise(r => setTimeout(r, 10)); } assert.fail(JSON.stringify(app.db.tasks())); };
  const sent = await app.rpc('chat.send', { botId: bot.id, requestId: randomUUID(), text: 'Pergunte qual cor eu prefiro.' });
  await until(() => ['done', 'failed'].includes(app.db.task(sent.taskId).state));
  assert.equal(app.db.task(sent.taskId).state, 'done', app.db.task(sent.taskId).error);
  const open = app.state().decisions;
  assert.equal(open.length, 1); assert.match(open[0].question, /Qual cor/); assert.deepEqual(open[0].options, ['Azul — Mais calmo', 'Verde — Mais vivo']);
  assert.ok(requests.some(item => (item.tools || []).some(tool => tool.name === 'AskUserQuestion')));
  assert.ok(JSON.stringify(requests.at(-1).messages).includes('A pergunta foi enviada'));
  await app.rpc('decision.answer', { id: open[0].id, option: 1 });
  await until(() => app.db.tasks().some(task => task.id !== sent.taskId && ['done', 'failed'].includes(task.state)));
  assert.equal(app.state().decisions.length, 0);
});
