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
  // agy's input leaves the cached part out and its numbers are the conversation's running total: the supervisor keeps only this turn's part.
  assert.deepEqual(first.usage, { input: 140, cached: 40, output: 10, calls: 2, session: true, resumed: false }, 'one tool, so two model calls');
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
  assert.deepEqual(first.usage, { input: 20, cached: 4, output: 6, calls: 2, context: 5 }, 'the last step is the size of the session now');
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
  assert.deepEqual(config.mcp['mybots-tools'], { type: 'remote', url: tools.endpoint + '/mcp', headers: { Authorization: 'Bearer ' + tools.token }, enabled: true, timeout: 130000 });
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

test('Termux wrappers find agy and opencode in a proot-distro container and carry the run token in by env', async t => {
  const { mkdir, symlink, chmod } = await import('node:fs/promises');
  const { execFile, execFileSync } = await import('node:child_process');
  const bash = execFileSync('sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).trim();
  const directory = await mkdtemp(join(tmpdir(), 'mybots-wrapper-')); t.after(() => rm(directory, { recursive: true, force: true }));
  // Only a bash and the fake proot-distro are on the PATH, like Termux (this computer's own /usr/bin has a real agy).
  const bin = join(directory, 'bin'); await mkdir(bin); await symlink(bash, join(bin, 'bash'));
  await writeFile(join(bin, 'proot-distro'), `#!${process.execPath}\nconsole.log(JSON.stringify(process.argv.slice(2)));`); await chmod(join(bin, 'proot-distro'), 0o700);
  const run = async (file, prefix, args, env = {}) => new Promise(resolve => execFile(bash, ['-c', file, 'wrapper', ...args], { env: { HOME: prefix, PREFIX: prefix, MYBOTS_HOME: join(prefix, '.mybots'), PATH: bin, ...env } }, (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr })));
  // A login shell (bash -l) reads /etc/profile, which puts this computer's real agy on the PATH; Termux has no /etc/profile.
  const source = async name => (await readFile(new URL(`../supervisor/${name}-wrapper.sh`, import.meta.url), 'utf8')).replaceAll('bash -lc', 'bash -c');
  const [agy, opencode] = [await source('agy'), await source('opencode')];
  const empty = join(directory, 'empty'); await mkdir(empty);
  assert.equal((await run(agy, empty, ['models'])).code, 127);
  assert.equal((await run(opencode, empty, ['models'])).code, 127);
  const prefix = join(directory, 'phone'); const rootfs = join(prefix, 'var/lib/proot-distro/containers/debian/rootfs');
  await mkdir(join(rootfs, 'root/.local/bin'), { recursive: true }); await mkdir(join(rootfs, 'root/.opencode/bin'), { recursive: true });
  await symlink('/root/.local/share/agy/versions/1.0.0', join(rootfs, 'root/.local/bin/agy'));
  await writeFile(join(rootfs, 'root/.opencode/bin/opencode'), '');
  const a = await run(agy, prefix, ['-p=oi', '--output-format', 'stream-json'], { MYBOTS_RUN_TOKEN: 'tok', MYBOTS_RUN_ENDPOINT: 'http://127.0.0.1:9' });
  assert.equal(a.code, 0, a.stderr);
  assert.deepEqual(JSON.parse(a.stdout), ['login', 'debian', '--bind', `${join(prefix, '.mybots')}:${join(prefix, '.mybots')}`, '--', 'env', 'MYBOTS_RUN_TOKEN=tok', 'MYBOTS_RUN_ENDPOINT=http://127.0.0.1:9', '/root/.local/bin/agy', '-p=oi', '--output-format', 'stream-json']);
  const b = await run(opencode, prefix, ['run', '--format', 'json', '--', 'oi'], { OPENCODE_CONFIG_CONTENT: '{"permission":{"*":"allow"}}' });
  assert.equal(b.code, 0, b.stderr);
  assert.deepEqual(JSON.parse(b.stdout), ['login', 'debian', '--', 'env', 'OPENCODE_CONFIG_CONTENT={"permission":{"*":"allow"}}', '/root/.opencode/bin/opencode', 'run', '--format', 'json', '--', 'oi']);
  // Without any token in the environment, nothing is carried in.
  const plain = await run(opencode, prefix, ['models']);
  assert.deepEqual(JSON.parse(plain.stdout), ['login', 'debian', '--', 'env', '/root/.opencode/bin/opencode', 'models']);
});

test('a wrapper that finds no agy or opencode (exit 127) reads as not installed, not as a login problem', async t => {
  const { Agy } = await import('../lib/agy.mjs'); const { Opencode } = await import('../lib/opencode.mjs');
  const missing = await fake(t, 'wrapper', 'process.exit(127);');
  { const status = await new Agy(missing.binary).status(); assert.equal(status.available, false); assert.equal(status.loggedIn, false); assert.match(status.message, /Instale o Antigravity de linha de comando \(agy\): curl -fsSL https:\/\/antigravity.google\/cli\/install.sh/); }
  assert.deepEqual(await new Opencode(missing.binary).status(), { available: false, loggedIn: false, message: 'Instale o opencode para usá-lo.' });
  await assert.rejects(agyRunner.runReply({ model: 'm' }, 'oi', { binary: missing.binary }), /não foi encontrado/);
  await assert.rejects(opencodeRunner.runReply({ model: 'a/b' }, 'oi', { binary: missing.binary }), /não foi encontrado/);
});

test('agy: a model that keeps hunting for the MyBots tools on the disk is cut short, and the guidance says the tools are already loaded', async t => {
  const hunting = await fake(t, 'agy', `
const out = value => console.log(JSON.stringify(value));
out({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} });
for (let i = 2; i < 40; i++) out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: i, state: 'ACTIVE', step_type: 'tool', tool_name: 'run_command', tool_info: { name: 'run_command', parameters: { CommandLine: i % 2 ? 'mount' : 'find /home/x/.gemini -name "*.json"' } } } });
setTimeout(() => {}, 5000);`);
  await assert.rejects(agyRunner.runReply({ model: 'm' }, 'oi', { binary: hunting.binary, tools: { token: 't', endpoint: 'http://127.0.0.1:1' } }), /procurando as ferramentas do MyBots no disco/);
  const editing = await fake(t, 'agy', `
const out = value => console.log(JSON.stringify(value));
out({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} });
out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: 2, state: 'ACTIVE', step_type: 'tool', tool_name: 'replace_file_content', tool_info: { name: 'replace_file_content', parameters: { TargetFile: '/home/x/.gemini/config/mcp_config.json' } } } });
setTimeout(() => {}, 5000);`);
  await assert.rejects(agyRunner.runReply({ model: 'm' }, 'oi', { binary: editing.binary, tools: { token: 't', endpoint: 'http://127.0.0.1:1' } }), /procurando as ferramentas do MyBots no disco/);
  assert.match(agyRunner.guidanceFor({ token: 't' }), /já estão carregadas.*não rode find, mount/s);
  assert.equal(agyRunner.guidanceFor(null), '');
});

test('the sandbox hides ~/.mybots-pc but mounts its bin folder back, so the MyBots tools server can start its Node there', async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-home-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const { mkdir } = await import('node:fs/promises');
  await mkdir(join(home, '.mybots-pc', 'bin'), { recursive: true });
  const args = sandboxFor('agy', home, '/usr/bin/bwrap', join(home, '.mybots-pc'));
  const bin = join(home, '.mybots-pc', 'bin');
  assert.ok(args.includes(join(home, '.mybots-pc')) && args[args.indexOf(join(home, '.mybots-pc')) - 1] === '--tmpfs');
  const at = args.findIndex((item, i) => item === '--ro-bind' && args[i + 1] === bin && args[i + 2] === bin);
  assert.ok(at > args.indexOf('--tmpfs'), 'the bin folder is mounted after the empty folder that hides the rest');
});

test('agy: reading what agy saved for the run is not hunting, and a MyBots tool in between resets the count', async t => {
  const step = (i, name, parameters) => `out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: ${i}, state: 'ACTIVE', step_type: 'tool', tool_name: '${name}', tool_info: { name: '${name}', parameters: ${JSON.stringify(parameters)} } } });`;
  const lines = [];
  for (let i = 2; i < 12; i++) lines.push(step(i, 'view_file', { AbsolutePath: '/home/x/.gemini/antigravity/brain/abc/screenshot.png' }));
  // Three finds, a MyBots tool, three finds again: never more than three in a row.
  for (let i = 12; i < 15; i++) lines.push(step(i, 'run_command', { CommandLine: 'find / -name mybots' }));
  lines.push(step(15, 'mcp_mybots-tools_browser_read', {}));
  for (let i = 16; i < 19; i++) lines.push(step(i, 'run_command', { CommandLine: 'which node' }));
  const agy = await fake(t, 'agy', `
const out = value => console.log(JSON.stringify(value));
out({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} });
${lines.join('\n')}
out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: 30, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Terminei.' } });
out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: 30, state: 'DONE', step_type: 'agent_response' } });
out({ event: 'result', result: { status: 'SUCCESS', response: 'Terminei.', usage: {} } });`);
  const result = await agyRunner.runReply({ model: 'm' }, 'oi', { binary: agy.binary, tools: { token: 't', endpoint: 'http://127.0.0.1:1' } });
  assert.equal(result.text, 'Terminei.');
  assert.ok(agyRunner.OWN_FILES.test('/home/x/.gemini/antigravity/brain/abc/a.png') && !agyRunner.OWN_FILES.test('/home/x/.gemini/antigravity/mcp_config.json'));
});

test('agy: a turn that ends only announcing the next step is told to carry it out, a few times at most', async t => {
  const agy = await fake(t, 'agy', `
const out = value => console.log(JSON.stringify(value));
const resume = args.includes('--conversation');
const prompts = fs.existsSync(calls + '.n') ? Number(fs.readFileSync(calls + '.n', 'utf8')) : 0; fs.writeFileSync(calls + '.n', String(prompts + 1));
const text = !resume || prompts < 1 ? 'Vou abrir a página de atividades.' : 'Abri: são 3 atividades.';
out({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} });
out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: text } });
out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: 1, state: 'DONE', step_type: 'agent_response' } });
out({ event: 'result', result: { status: 'SUCCESS', response: text, usage: { input_tokens: 10, output_tokens: 5 } } });`);
  const said = [];
  const result = await agyRunner.runReply({ model: 'm' }, 'oi', { binary: agy.binary, tools: { token: 't', endpoint: 'http://127.0.0.1:1' }, onProgress: item => item.say && said.push(item.say) });
  assert.equal(result.text, 'Abri: são 3 atividades.');
  assert.deepEqual(said, ['Vou abrir a página de atividades.']);
  // Both runs are the same conversation, whose total already includes the first: the later total stands, only the calls add up.
  assert.equal(result.usage.input, 10); assert.equal(result.usage.calls, 2); assert.equal(result.usage.session, true);
  const calls = await agy.calls(); assert.equal(calls.length, 2);
  assert.ok(calls[1].args.includes('--conversation') && calls[1].args.some(item => /só anunciando o próximo passo/.test(item)));
  // Without the MyBots tools (a plain chat) nothing is added; an answer is not an announcement.
  assert.ok(agyRunner.ANNOUNCES.test('Vou abrir a página') && !agyRunner.ANNOUNCES.test('Encontrei três atividades.'));
});

test('agy: a run that goes silent is stopped and the conversation resumed, instead of failing after ten minutes', async t => {
  const agy = await fake(t, 'agy', `
const out = value => console.log(JSON.stringify(value));
const first = !args.includes('--conversation');
out({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} });
if (first) { setTimeout(() => {}, 60000); return; }
out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: 1, state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Pronto: 3 atividades.' } });
out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: 1, state: 'DONE', step_type: 'agent_response' } });
out({ event: 'result', result: { status: 'SUCCESS', response: 'Pronto: 3 atividades.', usage: {} } });`);
  const steps = [];
  const result = await agyRunner.runReply({ model: 'm' }, 'oi', { binary: agy.binary, tools: { token: 't', endpoint: 'http://127.0.0.1:1' }, idleMs: 400, onProgress: item => item.step && steps.push(item.step) });
  assert.equal(result.text, 'Pronto: 3 atividades.');
  assert.ok(steps.some(step => /parou de responder/.test(step)));
  assert.equal((await agy.calls()).length, 2);
  // Without the MyBots tools (nothing to resume with) the silence is still an error.
  await assert.rejects(agyRunner.runReply({ model: 'm' }, 'oi', { binary: agy.binary, idleMs: 400, maxMs: 2000 }).then(r => { throw new Error('esperava erro ' + r.text); }, e => { throw e; }), () => true);
});

test('agy: the model thinking out loud (ids, coordinates, shouting, paths of its pictures) is kept out of the conversation', async t => {
  const NOTE = 'OLHA QUE MARAVILHA! Vou clicar em id: 4 e ler a próxima etapa!';
  const BOOK = '• id: 14 (Responder agora) NÃO TINHA box: {"x":24}. VAMOS VER ONDE ESTÁ O BOTÃO NA IMAGEM steps/512/media_0.jpg!';
  assert.ok(agyRunner.thinkingAloud(NOTE) && !agyRunner.thinkingAloud('Vou abrir a vaga da BHS e continuar a candidatura.'));
  assert.ok(agyRunner.thinkingAloud('a'.repeat(300)), 'a long in-between message is not news');
  assert.ok(agyRunner.notebook(BOOK) && !agyRunner.notebook('Terminei a BHS. Falta o Banco Inter, que pediu um teste.'));
  const step = (i, text, tool) => `out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: ${i}, state: 'ACTIVE', step_type: 'agent_response', text_delta: ${JSON.stringify(text)} } }); out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: ${i}, state: 'DONE', step_type: 'agent_response' } });${tool ? `\nout({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: ${i + 1}, state: 'ACTIVE', step_type: 'tool', tool_name: 'mcp_browser_read', tool_info: { name: 'mcp_browser_read', parameters: {} } } });` : ''}`;
  // First turn: shouting before a tool, then a final answer that is only the notebook. The resumed turn answers properly.
  const agy = await fake(t, 'agy', `
const out = value => console.log(JSON.stringify(value));
const resume = args.includes('--conversation');
out({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} });
if (!resume) { ${step(1, NOTE, true)}
  ${step(3, BOOK)}
  out({ event: 'result', result: { status: 'SUCCESS', response: ${JSON.stringify(BOOK)}, usage: {} } }); }
else { ${step(1, 'Terminei a BHS e falta o Banco Inter.')}
  out({ event: 'result', result: { status: 'SUCCESS', response: 'Terminei a BHS e falta o Banco Inter.', usage: {} } }); }`);
  const said = [], steps = [];
  const result = await agyRunner.runReply({ model: 'm' }, 'oi', { binary: agy.binary, tools: { token: 't', endpoint: 'http://127.0.0.1:1' }, onProgress: item => { if (item.say) said.push(item.say); if (item.step) steps.push(item.step); } });
  assert.equal(result.text, 'Terminei a BHS e falta o Banco Inter.');
  assert.deepEqual(said, [], 'the shouting and the notebook never reach the conversation');
  assert.ok(steps.includes('Analisando a página'));
  const calls = await agy.calls(); assert.equal(calls.length, 2);
  assert.ok(calls[1].args.some(item => /mostrou o seu raciocínio interno/.test(item)));
  // A model that keeps writing the notebook gets a short honest line instead.
  const stubborn = await fake(t, 'agy', `
const out = value => console.log(JSON.stringify(value));
out({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} });
${step(1, BOOK)}
out({ event: 'result', result: { status: 'SUCCESS', response: ${JSON.stringify(BOOK)}, usage: {} } });`);
  const last = await agyRunner.runReply({ model: 'm' }, 'oi', { binary: stubborn.binary, tools: { token: 't', endpoint: 'http://127.0.0.1:1' } });
  assert.match(last.text, /anotações técnicas minhas/);
  assert.equal((await stubborn.calls()).length, 4, 'asked three times before giving up');
  assert.match(agyRunner.guidanceFor({ token: 't' }), /sem exclamações.*nunca escreva ids de elementos, coordenadas/s);
});

test('agy: each step\'s usage gives the conversation size, and the running total becomes per turn in the supervisor', async t => {
  const agy = await fake(t, 'agy', `
const out = value => console.log(JSON.stringify(value));
const resume = args.includes('--conversation');
out({ event: 'init', conversation_id: ${JSON.stringify(CONVERSATION)}, init: {} });
out({ event: 'step_update', step_update: { conversation_id: ${JSON.stringify(CONVERSATION)}, step_index: 1, state: 'DONE', step_type: 'agent_response', text_delta: 'ok', usage: { input_tokens: 2000, output_tokens: 5, cache_read_tokens: 15000 } } });
out({ event: 'result', result: { status: 'SUCCESS', response: 'ok', usage: resume ? { input_tokens: 19000, output_tokens: 10, cache_read_tokens: 15000 } : { input_tokens: 17000, output_tokens: 5, cache_read_tokens: 0 } } });`);
  const first = await agyRunner.runReply({ model: 'm' }, 'um', { binary: agy.binary });
  assert.deepEqual(first.usage, { input: 17000, cached: 0, output: 5, calls: 1, session: true, resumed: false, context: 17000 });
  const second = await agyRunner.runReply({ model: 'm', codexSessionId: CONVERSATION }, 'dois', { binary: agy.binary });
  assert.equal(second.usage.resumed, true); assert.equal(second.usage.input, 34000);
  const { Database } = await import('../supervisor/database.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'mybots-agy-usage-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const db = new Database(directory);
  const turn = reply => db.turnTokens('b1', { ...reply, codexSessionId: CONVERSATION });
  assert.deepEqual(turn(first), { input: 17000, cached: 0, output: 5 });
  assert.deepEqual(turn(second), { input: 17000, cached: 15000, output: 5 }, 'only what the second turn added');
  db.close?.();
});
