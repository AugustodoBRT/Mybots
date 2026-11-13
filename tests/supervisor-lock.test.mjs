import './isolate-accounts.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSupervisor } from '../supervisor/index.mjs';

const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [] };

// 13/11/2026: the phone's supervisor was killed right after creating its lock file, before writing it. The empty lock then made every
// start fail ("Não foi possível iniciar o supervisor") until the file was removed by hand.
test('an empty or broken lock left by a killed start does not keep the supervisor down; a fresh one still counts as running', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'mybots-lock-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const lock = join(directory, 'supervisor.lock');
  for (const content of ['', '{"pid":', 'lixo']) {
    writeFileSync(lock, content);
    const old = new Date(Date.now() - 60000); utimesSync(lock, old, old);
    const app = await createSupervisor({ directory, port: 0, codex });
    await app.close();
  }
  // A lock being written this very moment by another start is respected.
  writeFileSync(lock, '');
  await assert.rejects(createSupervisor({ directory, port: 0, codex }), /já está em execução/);
});
