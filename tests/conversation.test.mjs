import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { Codex, chatArguments } from '../lib/codex.mjs';
import { promptFor } from '../mobile/local.js';

const SESSION = '0199a213-81c0-7800-8aa1-bbab2a035a53';
const REQUEST = '0199a213-81c0-7800-8aa1-bbab2a035a54';
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

