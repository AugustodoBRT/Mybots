import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { X509Certificate } from 'node:crypto';
import { dataDirectory, panicEndpoint, hasIsolation, hasDesktopControl } from '../pc/platform.mjs';
import { identity } from '../pc/server.mjs';
import { processIdentity, stopOrphan } from '../supervisor/process.mjs';

test('the node folder and the panic endpoint follow each system; Linux keeps its old paths', () => {
  assert.equal(dataDirectory('linux', {}, '/home/ana'), '/home/ana/.mybots-pc');
  assert.equal(dataDirectory('darwin', {}, '/Users/ana'), '/Users/ana/Library/Application Support/MyBots');
  assert.equal(dataDirectory('win32', { APPDATA: 'C:\\Users\\ana\\AppData\\Roaming' }, 'C:\\Users\\ana'), join('C:\\Users\\ana\\AppData\\Roaming', 'MyBots'));
  assert.equal(dataDirectory('linux', { MYBOTS_PC_HOME: '/x' }, '/home/ana'), '/x');
  assert.equal(panicEndpoint('/home/ana/.mybots-pc', 'linux'), '/home/ana/.mybots-pc/panic.sock');
  assert.match(panicEndpoint('C:\\a', 'win32'), /^\\\\\.\\pipe\\mybots-panic-[0-9a-f]{16}$/); assert.notEqual(panicEndpoint('C:\\a', 'win32'), panicEndpoint('C:\\b', 'win32'));
  assert.equal(hasIsolation('linux'), true); assert.equal(hasIsolation('win32'), false); assert.equal(hasIsolation('darwin'), false);
  assert.equal(hasDesktopControl('linux'), true); assert.equal(hasDesktopControl('darwin'), false);
});

test('the computer certificate is made in JavaScript (no openssl): EC P-256, 10 years, key private, same one on the next start', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-cert-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const first = identity(directory); const cert = new X509Certificate(first.cert);
  assert.equal(cert.publicKey.asymmetricKeyType, 'ec'); assert.equal(cert.publicKey.asymmetricKeyDetails.namedCurve, 'prime256v1'); assert.match(cert.subject, /CN=mybots-pc/);
  assert.ok(new Date(cert.validTo) - Date.now() > 3000 * 86400000); assert.match(first.fingerprint, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  assert.equal(((await import('node:fs')).statSync(join(directory, 'key.pem')).mode & 0o777), 0o600);
  assert.equal(identity(directory).fingerprint, first.fingerprint);
});

test('process identity per system: /proc, ps (macOS) and PowerShell (Windows); a stale or invalid pid gives null', () => {
  const run = (program, args) => { assert.ok(['ps', 'powershell.exe'].includes(program)); return program === 'ps' ? ' Tue Nov  3 10:00:00 2026\n' : '133900000000000000\n'; };
  assert.equal(processIdentity(123, 'darwin', { run }), 'Tue Nov  3 10:00:00 2026'); assert.equal(processIdentity(123, 'win32', { run }), '133900000000000000');
  assert.equal(processIdentity(123, 'linux', { read: () => `123 (a b) ${['S', ...Array.from({ length: 18 }, (_, i) => i + 1), 4242, 7].join(' ')}` }), '4242');
  assert.equal(processIdentity(123, 'linux', { read: () => { throw new Error('ENOENT'); } }), null);
  assert.equal(processIdentity(0, 'linux'), null); assert.equal(processIdentity('1; rm -rf', 'win32', { run }), null);
  assert.ok(processIdentity(process.pid, process.platform));
});

test('an orphan worker is stopped only when its start time still matches; Windows uses taskkill', () => {
  const calls = [];
  stopOrphan({ worker_pid: 50, worker_start: 'a' }, 'linux', { identity: () => 'a', kill: (pid, signal) => calls.push(['kill', pid, signal]) });
  stopOrphan({ worker_pid: 51, worker_start: 'a' }, 'linux', { identity: () => 'other', kill: (pid, signal) => calls.push(['kill', pid, signal]) });
  stopOrphan({ worker_pid: 52, worker_start: 'b' }, 'win32', { identity: () => 'b', run: (program, args) => calls.push([program, ...args]) });
  stopOrphan({ worker_pid: null, worker_start: 'b' }, 'linux', { identity: () => 'b', kill: () => calls.push('never') });
  assert.deepEqual(calls, [['kill', -50, 'SIGKILL'], ['taskkill', '/PID', '52', '/T', '/F']]);
});

import { chromePaths, findChrome, chromeProfile, userAgentFor } from '../pc/chrome.mjs';

test('Chrome: where it is on each system, Edge as the Windows fallback, the profile folder and a normal user agent', () => {
  const env = { PROGRAMFILES: 'C:\\Program Files', 'PROGRAMFILES(X86)': 'C:\\Program Files (x86)', LOCALAPPDATA: 'C:\\Users\\Ana\\AppData\\Local' };
  const paths = chromePaths('win32', env);
  assert.ok(paths.includes('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')); assert.ok(paths.at(-1).endsWith('msedge.exe'));
  assert.equal(findChrome('win32', path => path.includes('msedge.exe') && path.startsWith('C:\\Program Files (x86)'), env), 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe');
  assert.equal(findChrome('win32', path => path.includes('Google'), env), 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');   // Chrome before Edge
  assert.equal(findChrome('linux', path => path === '/usr/bin/chromium'), '/usr/bin/chromium'); assert.equal(findChrome('freebsd', () => true), null);
  assert.ok(chromeProfile('win32', env, 'C:\\Users\\Ana').endsWith('User Data')); assert.ok(chromeProfile('darwin', {}, '/Users/ana').endsWith('Application Support/Google/Chrome'));
  assert.ok(chromeProfile('linux', {}, '/home/ana').endsWith('.config/google-chrome'));
  assert.match(userAgentFor('126', 'win32'), /Windows NT 10\.0; Win64; x64\).*Chrome\/126\.0\.0\.0/); assert.match(userAgentFor('126', 'darwin'), /Macintosh/); assert.match(userAgentFor('126', 'linux'), /X11; Linux/);
  assert.equal(userAgentFor(null), null);
});

import { killTree, openCommand, noticeCommand } from '../pc/platform.mjs';
import { showNotice } from '../pc/local.mjs';

test('stopping a process tree and opening a file follow each system', () => {
  const calls = [];
  assert.equal(killTree(4242, 'SIGKILL', 'win32', { run: (...args) => calls.push(args) }), true);
  assert.deepEqual(calls[0].slice(0, 2), ['taskkill', ['/PID', '4242', '/T', '/F']]); assert.equal(calls[0][2].windowsHide, true);
  const signals = []; assert.equal(killTree(7, 'SIGKILL', 'linux', { kill: (...args) => signals.push(args) }), true); assert.deepEqual(signals, [[-7, 'SIGKILL']]);
  const fallback = []; assert.equal(killTree(7, 'SIGTERM', 'darwin', { kill: (pid, signal) => { fallback.push(pid); if (pid < 0) throw new Error('sem grupo'); } }), true); assert.deepEqual(fallback, [-7, 7]);
  assert.equal(killTree(0, 'SIGKILL', 'linux', {}), false); assert.equal(killTree('x', 'SIGKILL', 'win32', {}), false);
  assert.deepEqual(openCommand('C:\\a b.txt', 'win32'), { command: 'explorer.exe', args: ['C:\\a b.txt'] }); assert.equal(openCommand('/x', 'darwin').command, 'open'); assert.equal(openCommand('/x', 'linux').command, 'xdg-open');
});

test('desktop notices: the text never becomes part of a command, and only Linux has approval buttons', () => {
  const hostile = '"; Remove-Item -Recurse C:\\ ; $(calc) `x` \' & echo';
  const windows = noticeCommand('Título', hostile, { actions: true }, 'win32');
  assert.equal(windows.command, 'powershell.exe'); assert.deepEqual(windows.env, { MYBOTS_TITLE: 'Título', MYBOTS_TEXT: hostile }); assert.equal(windows.actions, false);
  assert.equal(windows.args.some(arg => arg.includes('Remove-Item')), false);
  const mac = noticeCommand('T', hostile, {}, 'darwin'); assert.equal(mac.command, 'osascript'); assert.equal(mac.args.join(' ').includes('Remove-Item'), false);
  const linux = noticeCommand('T', 'x', { actions: true }, 'linux'); assert.equal(linux.command, 'notify-send'); assert.ok(linux.args.includes('--action=approve=Aprovar')); assert.equal(linux.args.at(-1), 'x');
  const started = []; const fake = (command, args, options) => { started.push({ command, args, options }); return { on() {}, stdout: { on() {} } }; };
  showNotice({ title: 'Oi', text: hostile }, () => {}, 'win32', fake);
  assert.equal(started[0].command, 'powershell.exe'); assert.equal(started[0].options.windowsHide, true); assert.equal(started[0].options.env.MYBOTS_TEXT, hostile);
});
