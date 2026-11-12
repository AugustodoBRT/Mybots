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
const browserPath = process.env.MYBOTS_TEST_BROWSER || '/usr/bin/google-chrome-stable';
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }], limits: async () => ({ windows: [] }) };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png' };

// The computer's window, for real: the exported web app in Chrome, a real supervisor with fake bots, and the canvas that replaced the office.
test('canvas: cartões ao vivo, página isolada, arrastar, zoom, trocar de bot e mandar mensagem', { skip: !existsSync(browserPath), timeout: 600000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-canvas-win-')); const ui = join(directory, 'ui');
  await run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', ui], { cwd: new URL('../mobile', import.meta.url).pathname, timeout: 400000, maxBuffer: 1 << 26 });
  const app = await createSupervisor({ directory: join(directory, 'sup'), port: 0, codex, execute: async bot => ({ text: `Pronto, sou ${bot.name}.`, ...selection }) });
  await app.rpc('state.get');
  const chief = await app.rpc('bot.create', { name: 'Chefe', isChief: true, instructions: 'Chefe.', ...selection });
  const vagas = await app.rpc('bot.create', { name: 'Vagas', instructions: 'Vagas.', ...selection });
  app.tools.tables.add(vagas.id, { table: 'candidaturas', row: { empresa: 'Acme', status: 'enviada' } });
  const table = app.tools.canvas.add(vagas.id, { kind: 'table', title: 'Candidaturas', area: 'Vagas', table: 'candidaturas' });
  app.tools.canvas.add(vagas.id, { kind: 'note', title: 'Resumo', area: 'Vagas', text: '**1 enviada**', near: table.id, label: 'detalhes' });
  app.tools.canvas.add(chief.id, { kind: 'html', title: 'Painel', area: 'Equipe', html: '<p id=p>0</p><script>p.textContent=6*7</script><img src="https://example.com/x.png">' });
  const web = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    let file = normalize(join(ui, path === '/' ? 'index.html' : path));
    if (!file.startsWith(ui) || !existsSync(file) || !statSync(file).isFile()) file = join(ui, 'index.html');
    let body = await readFile(file);
    if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('<head>', `<head><script>window.MYBOTS_DESKTOP=${JSON.stringify({ port: app.port, token: app.token })}</script>`));
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
  }).listen(0, '127.0.0.1');
  t.after(() => { web.closeAllConnections?.(); web.close(); }); t.after(() => app.close());
  await new Promise(resolve => web.on('listening', resolve));
  const { chromium } = createRequire(new URL('../pc/package.json', import.meta.url))('playwright-core');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox'] });
  // Hooks run in the order they were added: the folder goes last, after the browser, the server and the supervisor.
  t.after(() => browser.close()); t.after(() => rm(directory, { recursive: true, force: true }));
  const page = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  // The news window after an update would cover the screen: here the current version counts as already seen.
  await page.addInitScript(version => { try { localStorage.setItem('mybots.seenVersion', version); } catch {} }, APP_VERSION);
  const errors = [], outside = []; page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/example\.com/.test(request.url())) outside.push(request.url()); });
  await page.goto(`http://127.0.0.1:${web.address().port}/`);
  await page.getByRole('button', { name: 'Canvas', exact: true }).first().click({ timeout: 60000 });
  await page.getByText('Candidaturas').first().waitFor({ timeout: 30000 });
  assert.ok(await page.getByText('Acme').count(), 'the table card shows the shared table');
  // The bot's page runs isolated: its script works, the image from the internet is never fetched.
  const frame = page.frameLocator('iframe[title="Página feita por um bot"]');
  await frame.getByText('42').waitFor({ timeout: 10000 });
  assert.equal(await page.locator('iframe[title="Página feita por um bot"]').getAttribute('sandbox'), 'allow-scripts');
  // A new card from a bot shows up without reloading.
  app.tools.canvas.add(vagas.id, { kind: 'note', title: 'Nova nota', area: 'Vagas', text: 'chegou agora' });
  await page.getByText('Nova nota').waitFor({ timeout: 10000 });
  // Drag the background and zoom with the wheel; then the box sends to another bot and its reply shows above it.
  await page.mouse.move(640, 700); await page.mouse.down(); await page.mouse.move(760, 640, { steps: 6 }); await page.mouse.up();
  await page.mouse.wheel(0, -200);
  await page.getByRole('button', { name: /Trocar o bot/ }).click();
  await page.getByRole('button', { name: 'Falar com Vagas' }).click();
  await page.getByPlaceholder('Escreva para Vagas…').fill('Põe o resumo no canvas');
  await page.getByRole('button', { name: 'Enviar' }).click();
  await page.getByText('Pronto, sou Vagas.').waitFor({ timeout: 20000 });
  assert.ok(app.db.all('SELECT body FROM messages WHERE bot_id=?', vagas.id).some(row => JSON.parse(row.body).text === 'Põe o resumo no canvas'));
  // Opening a card in full and taking it off the canvas.
  await page.getByRole('button', { name: 'Mostrar tudo' }).click();
  // The cards let touches through to the board, which finds the card under the finger: click where the card is.
  const card = await page.getByText('chegou agora').boundingBox(); await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
  await page.getByRole('button', { name: 'Tirar do canvas' }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Nova nota'), null, { timeout: 10000 });
  assert.equal((await app.rpc('canvas.state')).cards.length, 3);
  assert.deepEqual(outside, []); assert.deepEqual(errors, []);
});
