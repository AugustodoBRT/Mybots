import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

test('the Codex image tool is on, and the pictures it saved during a reply are picked up, only the new ones', async () => {
  const runner = require('../lib/codex-runner.cjs');
  const source = (await import('node:fs')).readFileSync(new URL('../lib/codex-runner.cjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source.match(/DISABLED_FEATURES = \[[^\]]*\]/s)[0], /image_generation/);
  const home = mkdtempSync(join(tmpdir(), 'codexhome-')); process.env.CODEX_HOME = home;
  const session = '01a1892d-7a7c-7671-ac1e-2517a7519bd9', folder = join(home, 'generated_images', session); mkdirSync(folder, { recursive: true });
  const old = join(folder, 'exec-old.png'); writeFileSync(old, Buffer.from('antiga')); utimesSync(old, new Date(Date.now() - 3600_000), new Date(Date.now() - 3600_000));
  const start = Date.now();
  writeFileSync(join(folder, 'exec-new.png'), Buffer.from('nova')); writeFileSync(join(folder, 'notas.txt'), 'x');
  const found = await runner.generatedImages(session, start);
  assert.deepEqual(found.map(item => [item.name, item.mime, item.bytes.toString()]), [['imagem-1.png', 'image/png', 'nova']]);
  assert.deepEqual(await runner.generatedImages('não-é-uma-sessão', start), []);
});
