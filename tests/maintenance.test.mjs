import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { deleteLocalBot, mergeBotLists, validateBackup } from '../mobile/local.js';
import { createTermuxBackup } from '../mobile/backup.js';
import { readTermuxJson } from '../mobile/termux-data.js';
const ID = '0199a213-81c0-7800-8aa1-bbab2a035a53';
const MESSAGE = '0199a213-81c0-7800-8aa1-bbab2a035a54';
const now = '2026-10-19T12:00:00.000Z';
const bot = () => ({ id: ID, name: 'Lua', instructions: '', color: 'green', createdAt: now, updatedAt: now,
  messages: [{ id: MESSAGE, role: 'user', text: 'Oi 😀 " $()\\\n'.repeat(2000), status: 'complete', createdAt: now }] });

test('deletion rejects a running bot, removes its conversation, and survives stale sync', () => {
  const store = { schema: 1, mode: 'phone', bots: [bot()] };
  assert.throws(() => deleteLocalBot({ ...store, bots: [{ ...bot(), messages: [{ ...bot().messages[0], awaitingResponse: true }] }] }, ID), /Aguarde/);
  const deleted = deleteLocalBot(store, ID).bots[0];
  assert.equal(deleted.messages.length, 0);
  const stale = { ...bot(), updatedAt: '2099-01-01T00:00:00.000Z' };
  const merged = mergeBotLists([deleted], [stale])[0];
  assert.ok(merged.deletedAt);
  assert.equal(merged.messages.length, 0);
  const restored = mergeBotLists([deleted], [{ ...bot(), restoredAt: '2099-01-01T00:00:00.000Z' }])[0];
  assert.equal(restored.deletedAt, undefined);
  assert.equal(restored.messages.length, 1);
  assert.equal(store.bots[0].messages.length, 1);
});

test('backup validation preserves identifiers and refuses corrupt or duplicate records', () => {
  const original = { schema: 1, mode: 'phone', bots: [bot()] };
  assert.deepEqual(validateBackup(JSON.parse(JSON.stringify(original))), original);
  assert.throws(() => validateBackup({ schema: 2, bots: [] }), /backup válido/);
  assert.throws(() => validateBackup({ ...original, bots: [bot(), bot()] }), /bot inválido/);
  assert.throws(() => validateBackup({ ...original, bots: [{ ...bot(), messages: [{ ...bot().messages[0], role: 'system' }] }] }), /mensagem inválida/);
});

test('Termux backup is private, date named and restores long Unicode text byte for byte', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = await readFile(new URL('../mobile/modules/termux-bridge/android/src/main/assets/mybots-maintenance.sh', import.meta.url), 'utf8');
  const run = (operation, payload = {}) => new Promise((resolve, reject) => {
    const args = operation === 'backupPart' ? [payload.requestId, String(payload.index)] : operation === 'backupFinish' ? [payload.requestId, String(payload.count)] : operation === 'backupRead' ? [payload.name, String(payload.offset)] : [];
    const child = spawn('/bin/bash', ['-c', script, 'mybots', operation, ...args], { env: { ...process.env, HOME: directory, LC_ALL: 'C.UTF-8' } });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', reject);
    child.on('close', exitCode => resolve({ exitCode, stdout, stderr }));
    child.stdin.end(payload.chunk || '');
  });
  const original = { schema: 1, mode: 'phone', bots: [bot()] };
  const backup = await createTermuxBackup(run, original);
  assert.match(backup.name, /^mybots-\d{8}T\d{6}Z-/);
  assert.equal((await stat(backup.path)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse((await run('backupList')).stdout), [backup.name]);
  const restored = validateBackup(await readTermuxJson(run, 'backupRead', { name: backup.name }));
  assert.deepEqual(restored, original);
  assert.equal((await run('backupRead', { name: '../escape.json', offset: 0 })).exitCode, 1);
});
