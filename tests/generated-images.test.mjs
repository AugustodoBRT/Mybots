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

test('the pictures of the person\'s message go to Codex with the question (--image), before the prompt marker', () => {
  const runner = require('../lib/codex-runner.cjs');
  const args = runner.chatArguments('/tmp/out', { model: 'x' }, undefined, undefined, ['/a/um.png', '/a/dois.jpg']);
  const at = args.indexOf('--image');
  assert.deepEqual(args.slice(at, at + 4), ['--image', '/a/um.png', '--image', '/a/dois.jpg']); assert.equal(args.at(-1), '-');
  assert.ok(!runner.chatArguments('/tmp/out', { model: 'x' }).includes('--image'));
});

test('a message with a picture reaches the Codex run with the stored picture path, and a Claude bot or a file that is not a picture gets none', async () => {
  const { createSupervisor } = await import('../supervisor/index.mjs');
  const { existsSync, mkdtempSync: temp } = await import('node:fs');
  const seen = [];
  const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ model: 'm', displayName: 'M', isDefault: true, efforts: ['low'], defaultEffort: 'low' }], limits: async () => ({}) };
  const app = await createSupervisor({ directory: temp(join(tmpdir(), 'pics-')), port: 0, codex, execute: async (bot, prompt, options) => { seen.push(options.images || []); return { text: 'ok', model: 'm', reasoningEffort: 'low' }; } });
  try {
    const bot = await app.rpc('bot.create', { name: 'Olhos', instructions: 'x', access: 'ask', model: 'm', reasoningEffort: 'low' });
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64').toString('base64');
    const send = (text, attachments) => app.rpc('chat.send', { botId: bot.id, requestId: crypto.randomUUID(), text, attachments });
    await send('olha', [{ name: 'a.png', mime: 'image/png', data: png }, { name: 'n.txt', mime: 'text/plain', data: Buffer.from('oi').toString('base64') }]);
    for (let i = 0; i < 200 && !seen.length; i++) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(seen[0].length, 1); assert.ok(existsSync(seen[0][0]));
  } finally { await app.close(); }
});
