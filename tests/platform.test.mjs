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
