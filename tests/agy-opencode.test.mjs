import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import agyRunner from '../lib/agy-runner.cjs';
import opencodeRunner from '../lib/opencode-runner.cjs';
import { selectionFor, PROVIDERS, PROVIDER_NAMES } from '../lib/models.mjs';
import { costOf } from '../lib/pricing.mjs';
import { sandboxFor } from '../pc/server.mjs';

const CONVERSATION = '2f6c1a52-9c0e-4f0c-8b7e-0a1d2c3b4e5f';
const SESSION = 'ses_e6b866358ffeGF3ZNLozS3hlO8';

async function fake(t, name, script) {
  const directory = await mkdtemp(join(tmpdir(), `mybots-${name}-fake-`));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, name);
  await writeFile(binary, `#!${process.execPath}\nconst fs = require('node:fs');\nconst args = process.argv.slice(2);\nconst calls = ${JSON.stringify(join(directory, 'calls.json'))};\nconst log = fs.existsSync(calls) ? JSON.parse(fs.readFileSync(calls, 'utf8')) : [];\nlog.push({ args, env: { token: process.env.MYBOTS_RUN_TOKEN || null, config: process.env.OPENCODE_CONFIG_CONTENT || null } }); fs.writeFileSync(calls, JSON.stringify(log));\n${script}`, { mode: 0o700 });
  return { binary, calls: async () => JSON.parse(await readFile(join(directory, 'calls.json'), 'utf8')) };
}

test('the agy catalog turns each "-low/-medium/-high" model into one model with reasoning levels', () => {
  const models = agyRunner.parseModels('gemini-4-argon-medium\tGemini 4 Argon (Medium)\ngemini-4-argon-low\tGemini 4 Argon (Low)\ngemini-4-argon-high\tGemini 4 Argon (High)\ngpt-oss-120b-medium\tGPT-OSS 120B (Medium)\nsolo\tSó um\nlixo sem tab\n');
  assert.deepEqual(models.map(item => [item.model, item.displayName, item.efforts, item.defaultEffort]), [['gemini-4-argon', 'Gemini 4 Argon', ['low', 'medium', 'high'], 'medium'], ['gpt-oss-120b', 'GPT-OSS 120B', ['medium'], 'medium'], ['solo', 'Só um', [], null]]);
  const picked = selectionFor(models, { provider: 'agy', model: 'gemini-4-argon', reasoningEffort: 'high' });
  assert.deepEqual(picked, { provider: 'agy', model: 'gemini-4-argon', reasoningEffort: 'high' });
  assert.deepEqual(selectionFor(models, { provider: 'agy', model: 'solo' }), { provider: 'agy', model: 'solo', reasoningEffort: null });
  assert.throws(() => selectionFor(models, { provider: 'agy', model: 'solo', reasoningEffort: 'high' }), /raciocínio/);
});

test('the opencode catalog keeps models that call tools, with their variants as reasoning levels', () => {
  const entry = (id, info) => `${id}\n${JSON.stringify(info, null, 2)}\n`;
  const text = entry('opencode/beam-free', { name: 'Beam Free', status: 'active', capabilities: { toolcall: true }, variants: { high: {}, low: {}, medium: {} } })
    + entry('opencode/no-tools', { name: 'Sem ferramentas', status: 'active', capabilities: { toolcall: false } })
    + entry('omniroute/meu', { name: 'meu', status: 'active', capabilities: { toolcall: true }, variants: {} });
  const models = opencodeRunner.parseModels(text);
  assert.deepEqual(models.map(item => [item.model, item.displayName, item.efforts, item.defaultEffort]), [['opencode/beam-free', 'Beam Free', ['low', 'medium', 'high'], 'medium'], ['omniroute/meu', 'meu · omniroute', [], null]]);
  assert.deepEqual(selectionFor(models, { provider: 'opencode', model: 'omniroute/meu' }), { provider: 'opencode', model: 'omniroute/meu', reasoningEffort: null });
});

test('the four IAs are known, and only Codex and Claude have an API price', () => {
  assert.deepEqual(PROVIDERS, ['codex', 'claude', 'agy', 'opencode']);
  assert.equal(PROVIDER_NAMES.agy, 'Antigravity');
  assert.equal(costOf({ provider: 'agy', model: 'x', input: 1e6, output: 1e6 }), 0);
  assert.equal(costOf({ provider: 'opencode', model: 'x', input: 1e6, output: 1e6 }), 0);
  assert.ok(costOf({ provider: 'claude', model: 'opus', input: 1e6, output: 1e6 }) > 0);
});

test('agy: asks with the model and level, keeps the conversation, shows the steps and returns the last text', async t => {
  const agy = await fake(t, 'agy', `
const resume = args.includes('--conversation') ? args[args.indexOf('--conversation') + 1] : ${JSON.stringify(CONVERSATION)};
const out = value => console.log(JSON.stringify(value));
console.log('aviso em texto puro');
out({ event: 'init', conversation_id: resume, init: { model: 'x', tools: [] } });
out({ event: 'step_update', step_update: { conversation_id: resume, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Vou listar.' } });
out({ event: 'step_update', step_update: { conversation_id: resume, step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: '\\n' } });
out({ event: 'step_update', step_update: { conversation_id: resume, step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: 'ls' } } } });
out({ event: 'step_update', step_update: { conversation_id: resume, step_index: 3, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Resposta ' + (args.includes('--conversation') ? 'retomada' : 'nova') } });
out({ event: 'step_update', step_update: { conversation_id: resume, step_index: 3, state: 'DONE', step_type: 'agent_response' } });
out({ event: 'result', result: { conversation_id: resume, status: 'SUCCESS', response: 'Vou listar.\\nResposta', usage: { input_tokens: 100, output_tokens: 7, thinking_tokens: 3, cache_read_tokens: 40 } } });`);
  const sessions = [], progress = [], drafts = [];
  const first = await agyRunner.runReply({ model: 'gemini-4-argon', reasoningEffort: 'high' }, 'oi', { binary: agy.binary, onSession: async id => sessions.push(id), onProgress: item => progress.push(item), onDelta: text => drafts.push(text) });
  assert.equal(first.text, 'Resposta nova');
  assert.deepEqual(first.usage, { input: 100, cached: 40, output: 10 });
  assert.equal(first.codexSessionId, CONVERSATION); assert.deepEqual(sessions, [CONVERSATION]);
  assert.deepEqual(progress, [{ say: 'Vou listar.' }, { step: 'Rodando ls' }]);
  const second = await agyRunner.runReply({ model: 'gemini-4-argon', reasoningEffort: 'low', codexSessionId: CONVERSATION }, 'e agora?', { binary: agy.binary });
  assert.equal(second.text, 'Resposta retomada');
  const calls = await agy.calls();
  assert.deepEqual(calls[0].args.filter(item => !item.startsWith('-p=')), ['--output-format', 'stream-json', '--dangerously-skip-permissions', '--model', 'gemini-4-argon-high']);
  assert.ok(calls[0].args.includes('-p=oi'));
  assert.ok(calls[1].args.includes('gemini-4-argon-low') && calls[1].args.join(' ').includes(`--conversation ${CONVERSATION}`));
});

test('agy: another conversation than the saved one, a failed turn and a bad id are reported in Portuguese', async t => {
  const other = await fake(t, 'agy', `console.log(JSON.stringify({ event: 'init', conversation_id: '11111111-1111-4111-8111-111111111111', init: {} }));`);
  await assert.rejects(agyRunner.runReply({ model: 'm', codexSessionId: CONVERSATION }, 'oi', { binary: other.binary }), error => /abriu outra conversa/.test(error.message) && error.codexSessionId === CONVERSATION);
  const failing = await fake(t, 'agy', `console.log(JSON.stringify({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} }));\nconsole.log(JSON.stringify({ event: 'result', result: { status: 'ERROR', response: '429 quota exceeded' } })); process.exit(1);`);
  await assert.rejects(agyRunner.runReply({ model: 'm' }, 'oi', { binary: failing.binary }), /limite de uso do Antigravity/);
  assert.throws(() => agyRunner.agyArguments({ model: 'm', codexSessionId: '../etc' }, 'x'), /inválido/);
  await assert.rejects(agyRunner.runReply({ model: 'm' }, 'oi', { binary: '/nao/existe/agy' }), /não foi encontrado/);
});

test('agy: the MyBots tools are registered once as an MCP server that gets the run token from the environment', async t => {
  const agy = await fake(t, 'agy', `
if (args[0] === 'mcp' && args[1] === 'list') { console.log('NAME TYPE STATUS COMMAND/URL'); process.exit(0); }
if (args[0] === 'mcp') process.exit(0);
console.log(JSON.stringify({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} }));
console.log(JSON.stringify({ event: 'result', result: { status: 'SUCCESS', response: 'ok', usage: {} } }));`);
  const tools = { token: 'a'.repeat(64), endpoint: 'http://127.0.0.1:9', entry: '/x/mcp/index.mjs', computer: false };
  await agyRunner.runReply({ model: 'm' }, 'oi', { binary: agy.binary, tools });
  await agyRunner.runReply({ model: 'm' }, 'oi', { binary: agy.binary, tools });
  const calls = await agy.calls();
  assert.deepEqual(calls.filter(call => call.args[0] === 'mcp').map(call => call.args.slice(0, 3).join(' ')), ['mcp list', 'mcp add mybots-tools']);
  const runs = calls.filter(call => call.args[0] !== 'mcp');
  assert.equal(runs.length, 2); assert.equal(runs[0].env.token, tools.token);
  assert.match(runs[0].args.find(item => item.startsWith('-p=')), /Instruções do MyBots/);
});

test('opencode: runs with the provider/model and variant, resumes the session, shows steps and keeps the last text', async t => {
  const oc = await fake(t, 'opencode', `
const sid = args.includes('-s') ? args[args.indexOf('-s') + 1] : ${JSON.stringify(SESSION)};
const out = value => console.log(JSON.stringify({ sessionID: sid, ...value }));
console.log('linha solta');
out({ type: 'step_start', part: { type: 'step-start' } });
out({ type: 'text', part: { type: 'text', text: 'Vou listar.' } });
out({ type: 'tool_use', part: { type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'ls' } } } });
out({ type: 'step_finish', part: { type: 'step-finish', reason: 'tool-calls', tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 4, write: 1 } } } });
out({ type: 'text', part: { type: 'text', text: 'Resposta ' + (args.includes('-s') ? 'retomada' : 'nova') } });
out({ type: 'step_finish', part: { type: 'step-finish', reason: 'stop', tokens: { input: 5, output: 3, reasoning: 0, cache: { read: 0, write: 0 } } } });`);
  const progress = [];
  const tools = { token: 'b'.repeat(64), endpoint: 'http://127.0.0.1:9', entry: '/x/mcp/index.mjs', computer: false };
  const first = await opencodeRunner.runReply({ model: 'opencode/beam-free', reasoningEffort: 'high' }, 'oi', { binary: oc.binary, tools, onProgress: item => progress.push(item) });
  assert.equal(first.text, 'Resposta nova'); assert.equal(first.codexSessionId, SESSION);
  assert.deepEqual(first.usage, { input: 20, cached: 4, output: 6 });
  assert.deepEqual(progress, [{ say: 'Vou listar.' }, { step: 'Rodando ls' }]);
  const second = await opencodeRunner.runReply({ model: 'opencode/beam-free', codexSessionId: SESSION }, 'e agora?', { binary: oc.binary });
  assert.equal(second.text, 'Resposta retomada');
  const [one, two] = await oc.calls();
  assert.deepEqual(one.args.slice(0, 7), ['run', '--format', 'json', '-m', 'opencode/beam-free', '--variant', 'high']);
  assert.equal(one.args.at(-2), '--'); assert.match(one.args.at(-1), /Instruções do MyBots[\s\S]*oi$/);
  assert.ok(two.args.join(' ').includes(`-s ${SESSION}`));
  const config = JSON.parse(one.env.config);
  // A bot that may not use the computer loses the shell and file edits; the MyBots tools come in with the run's token only.
  assert.deepEqual(config.permission, { '*': 'allow', bash: 'deny', edit: 'deny', external_directory: 'deny' });
  assert.deepEqual(config.mcp['mybots-tools'].environment, { MYBOTS_RUN_TOKEN: tools.token, MYBOTS_RUN_ENDPOINT: tools.endpoint });
  assert.deepEqual(opencodeRunner.configFor({ ...tools, computer: {} }).permission, { '*': 'allow' });
  assert.equal(opencodeRunner.configFor(undefined).mcp, undefined);
});

test('opencode: failures are reported in Portuguese and a changed session is refused', async t => {
  const failing = await fake(t, 'opencode', `console.log(JSON.stringify({ type: 'error', sessionID: ${JSON.stringify(SESSION)}, error: { data: { message: 'Rate limit 429' } } })); process.exit(1);`);
  await assert.rejects(opencodeRunner.runReply({ model: 'a/b' }, 'oi', { binary: failing.binary }), /limite de uso do provedor/);
  const other = await fake(t, 'opencode', `console.log(JSON.stringify({ type: 'step_start', sessionID: 'ses_aaaaaaaaaaaaaaaaaaaaaa' }));`);
  await assert.rejects(opencodeRunner.runReply({ model: 'a/b', codexSessionId: SESSION }, 'oi', { binary: other.binary }), error => /abriu outra sessão/.test(error.message) && error.codexSessionId === SESSION);
  assert.throws(() => opencodeRunner.opencodeArguments({ model: 'sem-barra' }, 'x'), /provedor\/modelo/);
  assert.throws(() => opencodeRunner.opencodeArguments({ model: 'a/b', codexSessionId: 'x' }, 'x'), /inválido/);
});

test('every IA turn hides the logins of the other IAs and keeps its own', async t => {
  const { mkdirSync } = await import('node:fs');
  const home = await mkdtemp(join(tmpdir(), 'mybots-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  for (const path of ['.codex', '.claude', '.gemini', '.local/share/opencode']) mkdirSync(join(home, path), { recursive: true });
  const hidden = provider => { const args = sandboxFor(provider, home, '/usr/bin/bwrap', join(home, '.mybots-pc')); return args.flatMap((item, i) => item === '--tmpfs' ? [args[i + 1].slice(home.length + 1)] : []).filter(path => ['.codex', '.claude', '.gemini', '.local/share/opencode'].includes(path)).sort(); };
  assert.deepEqual(hidden('codex'), ['.claude', '.gemini', '.local/share/opencode']);
  assert.deepEqual(hidden('claude'), ['.codex', '.gemini', '.local/share/opencode']);
  assert.deepEqual(hidden('agy'), ['.claude', '.codex', '.local/share/opencode']);
  assert.deepEqual(hidden('opencode'), ['.claude', '.codex', '.gemini']);
});
