import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
const { openTerminal, candidates } = createRequire(import.meta.url)('../desktop/electron/terminal.js');

test('Windows: the command reaches PowerShell whole, with quotes and spaces', () => {
  const command = '& "C:\\Users\\Ana Maria\\.local\\bin\\claude.exe" auth login';
  const [[program, args]] = candidates(command, 'win32');
  assert.equal(program, 'cmd.exe');
  assert.equal(args[args.indexOf('start') + 1], '"MyBots"', 'without the quotes start would take it as the program');
  assert.equal(Buffer.from(args.at(-1), 'base64').toString('utf16le'), command);
});

test('Linux: the next terminal is tried when one is not installed; none at all says so', async () => {
  const tried = [];
  const run = ok => program => { const child = new EventEmitter(); child.unref = () => {}; tried.push(program); queueMicrotask(() => child.emit(program === ok ? 'spawn' : 'error', new Error('ENOENT'))); return child; };
  assert.equal(await openTerminal('claude auth login', { platform: 'linux', run: run('konsole') }), true);
  assert.deepEqual(tried, ['x-terminal-emulator', 'gnome-terminal', 'konsole']);
  assert.equal(await openTerminal('claude auth login', { platform: 'linux', run: run('nenhum') }), false);
});
