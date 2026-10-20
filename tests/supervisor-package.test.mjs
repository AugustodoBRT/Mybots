import test from 'node:test';
import assert from 'node:assert/strict';
import { processIdentity } from '../supervisor/process.mjs';
import { stat, mkdir, mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { generateKeyPairSync, privateDecrypt, createHash } from 'node:crypto';

test('packaged bootstrap runs its own tests and returns only an encrypted pairing token', async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-bootstrap-'));
  const root = join(home, '.mybots'); let credentials;
  t.after(async () => {
    if (credentials) {
      try {
        await fetch(`http://127.0.0.1:${credentials.port}/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${credentials.token}` } });
        for (let i = 0; i < 100; i++) { try { await readFile(join(root, 'supervisor.lock')); } catch { break; } await new Promise(resolve => setTimeout(resolve, 20)); }
      } catch {}
    }
    await rm(home, { recursive: true, force: true });
  });
  const archive = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/assets/mybots-supervisor.tgz', import.meta.url));
  const hash = createHash('sha256').update(archive).digest('hex');
  const script = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/assets/mybots-pair.sh', import.meta.url), 'utf8');
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const publicText = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  await writeFile(join(home, 'codex'), '#!/bin/sh\nprintf "codex test help\\n"\n', { mode: 0o700 });
  // Packages above one RUN_COMMAND are staged with the app's real part script (taken from the Kotlin source), then joined by the pair script.
  const kotlin = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/java/expo/modules/termuxbridge/TermuxBridgeModule.kt', import.meta.url), 'utf8');
  const partScript = kotlin.split('PAIR_PART_SCRIPT = """')[1].split('""".trimIndent()')[0].split('\n').map(line => line.replace(/^ {6}/, '')).join('\n').replaceAll("${'$'}", '$');
  const PART = Number(kotlin.match(/PAIR_PART = ([0-9_]+)/)[1].replaceAll('_', ''));
  const runBash = (args, input) => new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', args, { env: { ...process.env, HOME: home } });
    let stderr = ''; child.stderr.setEncoding('utf8'); child.stderr.on('data', chunk => stderr += chunk);
    // A rejected call exits before reading its input; the write may then fail with EPIPE, which is expected.
    child.stdin.on('error', () => {});
    child.on('error', reject); child.on('close', code => resolve({ code, stderr })); child.stdin.end(input);
  });
  const parts = Math.ceil(archive.length / PART);
  assert.ok(parts >= 2, 'o pacote atual deve exercitar o envio em partes');
  for (let index = 0; index < parts; index++) {
    const staged = await runBash(['-c', partScript, 'mybots', hash, String(index)], archive.subarray(index * PART, (index + 1) * PART).toString('base64'));
    assert.equal(staged.code, 0, staged.stderr);
  }
  assert.notEqual((await runBash(['-c', partScript, 'mybots', '../x', '0'], 'AA==')).code, 0);
  // A previous supervisor stuck while closing: alive, holding the lock, not answering. Pairing must replace it.
  await mkdir(root, { recursive: true });
  const stuck = spawn('sleep', ['120'], { stdio: 'ignore' });
  t.after(() => { try { stuck.kill('SIGKILL'); } catch {} });
  await new Promise(r => setTimeout(r, 100));
  await writeFile(join(root, 'supervisor.lock'), JSON.stringify({ pid: stuck.pid, start: processIdentity(stuck.pid) }));
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const result = await new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', script, 'mybots', hash, '', publicText, 'sha256', 'staged'], {
      env: { ...environment, HOME: home, MYBOTS_HOME: root, MYBOTS_PORT: '0', PATH: `${home}:${process.env.PATH}` }
    });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject); child.on('close', code => resolve({ code, stdout, stderr }));
    // Like Termux without a stdin extra: the pipe stays open, so reading it would hang.
    child.on('close', () => child.stdin.destroy());
  });
  assert.equal(result.code, 0, result.stderr);
  await assert.rejects(stat(join(root, 'staging')));
  assert.equal(stuck.exitCode !== null || stuck.signalCode !== null, true, 'o processo travado foi encerrado');
  const envelope = JSON.parse(result.stdout);
  const token = privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(envelope.encryptedToken, 'base64')).toString('utf8');
  credentials = { ...envelope, token };
  assert.equal(token, await readFile(join(root, 'token'), 'utf8'));
  assert.ok(!result.stdout.includes(token)); assert.ok(!result.stderr.includes(token));
  assert.equal(envelope.token, undefined);
  const testReport = await readFile(join(root, 'testes-supervisor.txt'), 'utf8');
  assert.match(testReport, /pass [1-9][0-9]*/); assert.match(testReport, /fail 0/);
  assert.ok((await readFile(join(root, 'ambiente-supervisor.txt'), 'utf8')).includes('SQLite nativo disponível'));
  // The keep-alive service restarts a stopped supervisor with the installed release, without stdin (like Termux) or a new install.
  await fetch(`http://127.0.0.1:${credentials.port}/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${credentials.token}` } });
  for (let i = 0; i < 200; i++) { try { await readFile(join(root, 'supervisor.lock')); } catch { break; } await new Promise(resolve => setTimeout(resolve, 20)); }
  await assert.rejects(fetch(`http://127.0.0.1:${credentials.port}/health`));
  const restartScript = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/assets/mybots-restart.sh', import.meta.url), 'utf8');
  const restart = (release, env = {}) => new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', restartScript, 'mybots', release, publicText, 'sha256'], { env: { ...environment, HOME: home, MYBOTS_PORT: '0', PATH: `${home}:${process.env.PATH}`, ...env } });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => stdout += chunk); child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject); child.on('close', code => { child.stdin.destroy(); resolve({ code, stdout, stderr }); });
  });
  // An app updated but not opened yet asks for a release that is not installed: the one that last ran is used.
  const restarted = await restart('0'.repeat(64));
  assert.equal(restarted.code, 0, restarted.stderr);
  const again = JSON.parse(restarted.stdout);
  assert.equal(again.release, hash);
  assert.equal(privateDecrypt({ key: privateKey, oaepHash: 'sha256' }, Buffer.from(again.encryptedToken, 'base64')).toString('utf8'), token);
  credentials = { ...again, token };
  assert.equal((await (await fetch(`http://127.0.0.1:${again.port}/health`, { headers: { Authorization: `Bearer ${token}` } })).json()).release, hash);
  assert.match(await readFile(join(root, 'supervisor.log'), 'utf8'), /reinício pelo MyBots/);
  // Already running: the restart only hands back the same pairing, never a second supervisor.
  const running = await restart(hash);
  assert.equal(running.code, 0, running.stderr); assert.equal(JSON.parse(running.stdout).port, again.port);
  // Nothing installed (pairing never ran here): it asks for the app instead of installing.
  const emptyHome = await mkdtemp(join(tmpdir(), 'mybots-restart-empty-')); t.after(() => rm(emptyHome, { recursive: true, force: true }));
  const empty = await restart(hash, { HOME: emptyHome });
  assert.equal(empty.code, 3); assert.match(empty.stderr, /Abra o MyBots/);
});

test('missing SQLite and failed runtime preparation never migrate or overwrite the old JSON', async t => {
  const home = await mkdtemp(join(tmpdir(), 'mybots-runtime-missing-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const original = join(home, 'mybots-local.json'); const bytes = '{"schema":1,"bots":[]}'; await writeFile(original, bytes);
  for (const binary of ['node','pkg']) await writeFile(join(home, binary), '#!/bin/sh\nexit 1\n', { mode: 0o700 });
  const script = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/assets/mybots-pair.sh', import.meta.url), 'utf8');
  const archive = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/assets/mybots-supervisor.tgz', import.meta.url));
  const { NODE_TEST_CONTEXT, ...environment } = process.env;
  const code = await new Promise((resolve, reject) => {
    const child = spawn('/bin/bash', ['-c', script, 'mybots', createHash('sha256').update(archive).digest('hex'), '', 'unused', 'sha256'], {
      env: { ...environment, HOME: home, PATH: `${home}:${process.env.PATH}` }, stdio: ['pipe','ignore','ignore']
    });
    child.on('error', reject); child.on('close', resolve); child.stdin.end(archive.toString('base64'));
  });
  assert.notEqual(code, 0);
  assert.equal(await readFile(original, 'utf8'), bytes);
  await assert.rejects(readFile(join(home, '.mybots', 'mybots.db')), { code: 'ENOENT' });
});
