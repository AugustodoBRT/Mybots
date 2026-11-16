import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { join, extname, normalize } from 'node:path';
import { createRequire } from 'node:module';
import { createSupervisor } from '../supervisor/index.mjs';
import { APP_VERSION } from '../mobile/changelog.js';

const run = promisify(execFile);
const hasChrome = existsSync('/usr/bin/google-chrome-stable');
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }],
  limits: async () => ({ plan: 'plus', windows: [{ key: 'five_hour', used: 32, resetsAt: Date.now() + 3600000 }] }) };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png' };

test('chat stays mounted through chief session creation, streams in one row and settles promptly', { skip: !hasChrome, timeout: 600000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-chatwin-')); const ui = join(directory, 'ui');
  await run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', ui], { cwd: new URL('../mobile', import.meta.url).pathname, timeout: 400000, maxBuffer: 1 << 26 });
  let finishReply;
  const app = await createSupervisor({ directory: join(directory, 'sup'), port: 0, codex, execute: async (bot, prompt, { onDelta }) => {
    onDelta('Resposta'); await new Promise(resolve => setTimeout(resolve, 250)); onDelta('Resposta chegando aos poucos');
    await new Promise(resolve => { finishReply = resolve; });
    return { text: 'Resposta chegando aos poucos. Pronto!', ...selection };
  } });
  await app.rpc('bot.create', { name: 'Chefe', isChief: true, ...selection });
  const web = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname); let file = normalize(join(ui, path === '/' ? 'index.html' : path));
    if (!file.startsWith(ui) || !existsSync(file) || !statSync(file).isFile()) file = join(ui, 'index.html');
    let body = await readFile(file);
    if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('<head>', `<head><script>window.MYBOTS_DESKTOP=${JSON.stringify({ port: app.port, token: app.token })}</script>`));
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => web.on('listening', resolve));
  const { chromium } = createRequire(new URL('../pc/package.json', import.meta.url))('playwright-core');
  const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome-stable', headless: true, args: ['--no-sandbox'] });
  t.after(async () => { await browser.close(); web.close(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  // The news window after an update would cover the screen: here the current version counts as already seen.
  await page.addInitScript(version => { try { localStorage.setItem('mybots.seenVersion', version); } catch {} }, APP_VERSION);
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(`http://127.0.0.1:${web.address().port}/`);


  const field = page.getByLabel('Sua mensagem').first();
  await field.waitFor({ timeout: 60000 });
  await page.evaluate(() => {
    window.chatMissing = 0;
    window.chatWatch = setInterval(() => { if (!document.querySelector('textarea[aria-label="Sua mensagem"]')) window.chatMissing++; }, 16);
  });
  await field.fill('Oi'); await page.getByLabel('Enviar mensagem', { exact: true }).first().click();
  await page.getByText('Resposta chegando aos poucos', { exact: true }).first().waitFor();
  assert.equal(await page.getByText('Pensando', { exact: true }).count(), 0);
  assert.equal(await field.inputValue(), '');
  await page.getByLabel('Parar resposta').first().waitFor();
  const partial = page.getByText('Resposta chegando aos poucos', { exact: true }).first();
  await partial.evaluate(el => { window.streamRow = el.closest('[data-desktop-message]'); });
  await page.screenshot({ path: '/tmp/mybots-chat-stream-desktop.png' });
  finishReply();
  await page.getByText('Resposta chegando aos poucos. Pronto!', { exact: true }).first().waitFor();
  await page.getByLabel('Parar resposta').waitFor({ state: 'hidden', timeout: 2000 });
  assert.equal(await page.evaluate(() => window.streamRow?.isConnected), true, 'the same reply row survives completion');
  assert.equal(await page.evaluate(() => window.chatMissing), 0, 'no transient home/empty screen');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '/tmp/mybots-chat-stream-narrow.png' });
  assert.equal(errors.length, 0, errors.join('\n'));
});
