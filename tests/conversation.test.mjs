import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { Codex, chatArguments } from '../lib/codex.mjs';
import { promptFor } from '../mobile/local.js';
import { activePhoneBots, createPhoneClient } from '../mobile/phone.js';

const SESSION = '0199a213-81c0-7800-8aa1-bbab2a035a53';
const REQUEST = '0199a213-81c0-7800-8aa1-bbab2a035a54';
const asset = new URL('../mobile/modules/termux-bridge/android/src/main/assets/mybots-termux.sh', import.meta.url);
const settings = { model: 'test-model', reasoningEffort: 'low' };

async function fakeCLI(t, replyText = 'Lembro: abacaxi.') {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-session-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const binary = join(directory, 'codex');
  await writeFile(binary, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if(process.argv[2]==='features'){console.log('shell_tool stable true');process.exit(0);}
if (args.includes('--help')) { console.log('--ignore-user-config --ignore-rules --json --sandbox --output-last-message'); process.exit(0); }
if (args.includes('--version')) { console.log('codex-test'); process.exit(0); }
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  const file = ${JSON.stringify(join(directory, 'calls.json'))};
  const calls = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : [];
  if (args.includes('--ephemeral') || !args.includes('--json')) process.exit(4);
  const resume = args.indexOf('resume');
  if (calls.length && (resume < 0 || args[resume + 1] !== '${SESSION}' || input.includes('Personalidade:'))) process.exit(5);
  calls.push({args,input}); fs.writeFileSync(file, JSON.stringify(calls));
  // Session event arrives in chunks, followed by enough output to overflow the old stdout tail.
  process.stdout.write('{"type":"thread.');
  process.stdout.write('started","thread_id":"${SESSION}"}\\n');
  process.stdout.write(JSON.stringify({type:'item.completed', item:{text:'x'.repeat(20000)}}) + '\\n');
  fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], ${JSON.stringify(replyText)});
  console.log(JSON.stringify({type:'turn.completed'}));
});
`, { mode: 0o700 });
  return { directory, binary };
}

test('ten turns use one persistent session and send only the new message on resume', async t => {
  const { directory, binary } = await fakeCLI(t);
  const codex = new Codex(binary);
  let bot = { id: REQUEST, name: 'Lua', instructions: '', ...settings, messages: [] };
  for (let turn = 0; turn < 10; turn++) {
    const message = { id: String(turn), role: 'user', text: turn === 0 ? 'Lembre abacaxi.' : `Turno ${turn}`, status: 'pending' };
    bot.messages.push(message);
    const result = await codex.reply(bot, message.id);
    bot.codexSessionId = result.codexSessionId;
    message.status = 'complete';
    bot.messages.push({ id: `reply${turn}`, role: 'assistant', text: result.text, status: 'complete' });
  }
  const calls = JSON.parse(await readFile(join(directory, 'calls.json'), 'utf8'));
  assert.equal(calls.length, 10);
  assert.equal(bot.codexSessionId, SESSION);
  assert.equal(calls[9].input, 'Turno 9');
  assert.equal(promptFor(bot, '9'), 'Turno 9');
  assert.ok(!chatArguments('/tmp/out', bot).includes('--ephemeral'));
});

test('Termux Bash resumes ten turns, pages long Unicode replies and ignores duplicate requests', async t => {
  const expected = 'Aspas " \\ $(comando) `texto` 😀\n\t'.repeat(1000);
  const { directory } = await fakeCLI(t, expected);
  const script = await readFile(asset, 'utf8');
  const raw = (operation, requestId, session, offset = 0, input = '') => new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', script, 'mybots', operation, requestId, operation === 'recover' ? String(offset) : settings.model, settings.reasoningEffort, session], {
      env: { ...process.env, HOME: directory, PATH: `${directory}:${process.env.PATH}`, LC_ALL: 'C.UTF-8' }
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(stderr)));
    child.stdin.end(input);
  });
  for (let turn = 0; turn < 10; turn++) {
    const id = REQUEST.slice(0, -2) + String(turn).padStart(2, '0');
    await raw('reply', id, turn ? SESSION : '', 0, turn ? `Turno ${turn}` : 'Lembre abacaxi.');
    let offset = 0, serialized = '';
    do {
      const page = await raw('recover', id, '', offset);
      assert.ok(page.chunk.length < 24001);
      serialized += page.chunk;
      offset = page.nextOffset;
    } while (offset !== null);
    const response = JSON.parse(serialized);
    assert.equal(response.text, expected);
    assert.equal(response.codexSessionId, SESSION);
    assert.equal(response.status, 'complete');
    assert.equal((await stat(join(directory, '.mybots', 'responses', `${id}.json`))).mode & 0o777, 0o600);
    await raw('reply', id, '', 0, 'Duplicada');
  }
  assert.equal(JSON.parse(await readFile(join(directory, 'calls.json'), 'utf8')).length, 10);
  assert.match(await readFile(join(directory, '.mybots', 'environment.txt'), 'utf8'), /codex-test/);
  const orphan = REQUEST.slice(0, -2) + '99';
  await writeFile(join(directory, '.mybots', 'responses', `${orphan}.json`), JSON.stringify({ requestId: orphan, status: 'running', pid: 2147483647, deadline: 0 }));
  await writeFile(join(directory, '.mybots', 'responses', `${orphan}.json.session`), SESSION);
  const recovered = await raw('recover', orphan, '');
  const failure = JSON.parse(recovered.chunk);
  assert.equal(failure.status, 'error');
  assert.equal(failure.codexSessionId, SESSION);
});

function phoneFixture(run, write = async () => {}) {
  let store = { schema: 1, mode: 'phone', bots: [{ id: 'bot', name: 'Lua', instructions: '', ...settings, messages: [] }] };
  const pagedRun = async (operation, payload) => {
    const result = await run(operation, payload);
    return operation === 'recover' ? { ...result, stdout: JSON.stringify({ chunk: result.stdout, nextOffset: null }) } : result;
  };
  const dependencies = { read: async () => structuredClone(store), write: async next => { await write(next); store = structuredClone(next); }, run: pagedRun };
  return { client: createPhoneClient(dependencies), reopen: () => createPhoneClient(dependencies), store: () => store };
}

test('closing the app mid-reply recovers exactly one response and the same session', async () => {
  let finish, request;
  const f = phoneFixture(async (operation, payload) => {
    if (operation === 'reply') { request = payload; return new Promise(resolve => { finish = resolve; }); }
    return { exitCode: 0, stdout: JSON.stringify({ requestId: payload.requestId, status: 'complete', text: 'abacaxi', codexSessionId: SESSION, ...settings }) };
  });
  const sending = f.client.send('bot', 'Lembre abacaxi.', settings);
  while (!finish) await new Promise(resolve => setTimeout(resolve, 1));
  assert.equal(f.store().bots[0].messages[0].requestId, request.requestId);
  assert.deepEqual(activePhoneBots(f.store()), ['bot']);
  await f.reopen().recover();
  await f.reopen().recover();
  finish({ exitCode: 0 }); await sending;
  assert.equal(f.store().bots[0].messages.length, 2);
  assert.equal(f.store().bots[0].codexSessionId, SESSION);
  assert.deepEqual(activePhoneBots(f.store()), []);
});

test('failed persistence never invokes Termux', async () => {
  let called = false;
  const f = phoneFixture(async () => { called = true; }, async () => { throw new Error('Disco cheio'); });
  await assert.rejects(f.client.send('bot', 'Oi', settings), /Disco cheio/);
  assert.equal(called, false);
});

test('callback timeout is visible, blocks duplicate sending, and still recovers', async () => {
  const f = phoneFixture(async (operation, payload) => {
    if (operation === 'reply') throw Object.assign(new Error('Tempo esgotado'), { code: 'TERMUX_TIMEOUT' });
    return { exitCode: 0, stdout: JSON.stringify({ requestId: payload.requestId, status: 'complete', text: 'Chegou', codexSessionId: SESSION }) };
  });
  await assert.rejects(f.client.send('bot', 'Oi', settings), /esgotado/);
  assert.equal(f.store().bots[0].messages[0].status, 'error');
  await assert.rejects(f.client.send('bot', 'Duplicada', settings), /Aguarde/);
  await f.reopen().recover();
  assert.equal(f.store().bots[0].messages[0].status, 'complete');
  assert.equal(f.store().bots[0].messages[1].text, 'Chegou');
});
