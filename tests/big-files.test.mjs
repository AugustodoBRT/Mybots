import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, symlinkSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupervisor } from '../supervisor/index.mjs';

const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ model: 'm', displayName: 'M', isDefault: true, efforts: ['low'], defaultEffort: 'low' }], limits: async () => ({}) };

test('a bot sends a file of any size by its path without loading it, only from its own folder, and the app reads it in parts', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'bigfiles-'));
  const app = await createSupervisor({ directory, port: 0, codex, execute: async () => ({ text: 'ok', status: 'complete' }) });
  try {
    const bot = await app.rpc('bot.create', { name: 'Vídeo', instructions: 'x', access: 'ask', model: 'm', reasoningEffort: 'low' });
    const workspace = join(directory, 'workspaces', bot.id); mkdirSync(workspace, { recursive: true });
    const big = join(workspace, 'filme.mp4'); writeFileSync(big, Buffer.alloc(60 * 1024 * 1024, 7));
    const run = { botId: bot.id, taskId: 't1' };
    const [from, size] = app.tools.sendablePath(run, 'filme.mp4');
    const file = app.tools.attachments.adopt(bot.id, from, size);
    assert.equal(file.mime, 'video/mp4'); assert.equal(file.size, 60 * 1024 * 1024);
    // the app reads it in 3 MB parts, the last one with no "next"
    let offset = 0, total = 0, parts = 0;
    do { const part = await app.rpc('file.read', { id: file.id, offset }); total += Buffer.from(part.chunk, 'base64').length; parts++; offset = part.next; } while (offset !== null);
    assert.equal(total, 60 * 1024 * 1024); assert.equal(parts, 20);
    // outside the work folder: a hidden folder, a path out of it and a link to outside are refused
    assert.throws(() => app.tools.sendablePath(run, '/etc/passwd'), /Só posso mandar|Isso não/);
    assert.throws(() => app.tools.sendablePath(run, '../../database.sqlite'), /Só posso mandar|Não achei/);
    const outside = join(directory, 'segredo.txt'); writeFileSync(outside, 'x'); symlinkSync(outside, join(workspace, 'atalho.txt'));
    assert.throws(() => app.tools.sendablePath(run, 'atalho.txt'), /Só posso mandar/);
    // a big file is not read by the bot itself
    const read = await app.tools.attachments.read(bot.id, file.id);
    assert.equal(read.unsupported, true); assert.match(read.message, /file_send/);
  } finally { await app.close(); }
});
