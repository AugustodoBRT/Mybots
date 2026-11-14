import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { deleteLocalBot, mergeBotLists, validateBackup } from '../mobile/local.js';
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
  assert.throws(() => validateBackup({ ...original, bots: [{ ...bot(), messages: [{ ...bot().messages[0], role: 'robot' }] }] }), /mensagem inválida/);
});

test('backup validation accepts skills that are folders of the computer', () => {
  const skills = [{ path: '/home/augusto/.claude/skills/pdf', write: false }];
  validateBackup({ schema: 1, mode: 'phone', bots: [{ ...bot(), skills }] });
  assert.throws(() => validateBackup({ schema: 1, bots: [{ ...bot(), skills: [{ path: 'relativo' }] }] }), /Perfil inválido/);
  assert.throws(() => validateBackup({ schema: 1, bots: [{ ...bot(), skills: ['nao-e-id'] }] }), /Perfil inválido/);
});

