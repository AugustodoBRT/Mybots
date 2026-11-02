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

const run = promisify(execFile);
const browserPath = process.env.MYBOTS_TEST_BROWSER || '/usr/bin/google-chrome-stable';
const hasChrome = existsSync(browserPath);
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }],
  limits: async () => ({ plan: 'plus', windows: [{ key: 'five_hour', used: 32, resetsAt: Date.now() + 3600000 }] }) };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png' };

// The computer's window, for real: the exported web app in Chrome, talking to a real supervisor with fake bots.
test('escritório: conversa, rascunhos, envio, arquivo e sala sem desmontar a cena', { skip: !hasChrome, timeout: 600000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-pcwin-')); const ui = join(directory, 'ui');
  await run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', ui], { cwd: new URL('../mobile', import.meta.url).pathname, timeout: 400000, maxBuffer: 1 << 26 });
  const execute = async (bot, prompt, { tools, signal, onProgress }) => {
    const input = JSON.parse(app.db.task(tools.taskId).payload).text || '';
    if (input === 'Aprovação real') {
      onProgress?.({ step: 'Preparando proposta' });
      const call = async (body, session) => { const response = await fetch(tools.endpoint + '/mcp', { method: 'POST', headers: { Authorization: 'Bearer ' + tools.token, 'Content-Type': 'application/json', ...(session ? { 'Mcp-Session-Id': session } : {}) }, body: JSON.stringify(body) }); return { session: response.headers.get('mcp-session-id'), body: await response.json() }; };
      const init = await call({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
      const result = await call({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'task_create_item', arguments: { title: 'Conferir projeto' } } }, init.session);
      if (result.body.error || result.body.result?.isError) throw new Error(JSON.stringify(result.body));
    }
    if (input === 'Teste cancelamento') {
      onProgress?.({ step: 'Esperando cancelamento' });
      await new Promise((resolve, reject) => { if (signal.aborted) reject(new Error('parado')); else signal.addEventListener('abort', () => reject(new Error('parado')), { once: true }); });
    }
    return { text: 'Pronto.', ...selection };
  };
  const app = await createSupervisor({ directory: join(directory, 'sup'), port: 0, codex, execute });
  const bots = []; for (const name of ['Atlas', 'Clara', 'Nico']) bots.push(await app.rpc('bot.create', { name, instructions: `Bot ${name}.`, face: { seed: name }, ...selection }));
  app.tools.grant(bots[0].id, 'task.create_item', true);
  const previewDoc = app.tools.attachments.store(bots[0].id, { name: 'revisao.md', mime: 'text/markdown', bytes: Buffer.from('# Revisão visual\n\nArquivo dentro do app.') });
  const previewImage = app.tools.attachments.store(bots[0].id, { name: 'amostra.png', mime: 'image/png', bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a8ncAAAAASUVORK5CYII=', 'base64') });
  const previewVideo = app.tools.attachments.store(bots[0].id, { name: 'previa.webm', mime: 'video/webm', bytes: await readFile(new URL('./fixtures/preview.webm', import.meta.url)) });
  const previewZip = app.tools.attachments.store(bots[0].id, { name: 'projeto.zip', mime: 'application/zip', bytes: Buffer.from('PK archive') });
  app.db.appendMessage(bots[0].id, { id: crypto.randomUUID(), role: 'assistant', createdAt: new Date().toISOString(), text: '[Auto-revisão](revisao.md), [Vídeo](previa.webm) e [Projeto](projeto.zip)', status: 'complete', attachments: [previewDoc, previewImage, previewZip, previewVideo] });
  await app.rpc('person.update', { name: 'Augusto' });
// Spend over the last week: a few replies per day for the first two bots, none for the third.
const addUsage = (app, botId, daysAgo, input, cached, output, model = 'gpt-6.1-sol') => { const at = new Date(Date.now() - daysAgo * 86400000).toISOString(); app.db.run('INSERT INTO usage VALUES(?,?,?,?,?,?,?,?,?)', crypto.randomUUID(), botId, null, 'codex', model, input, cached, output, at); };
  for (let d = 0; d < 7; d++) { addUsage(app, bots[0].id, d, 1e6 * (d + 1), 8e5 * (d + 1), 1e5 * (d % 3 + 1)); addUsage(app, bots[1].id, d, 4e5, 1e5, 2e4); }
  const web = createServer(async (request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname); let file = normalize(join(ui, path === '/' ? 'index.html' : path));
    if (!file.startsWith(ui) || !existsSync(file) || !statSync(file).isFile()) file = join(ui, 'index.html');
    let body = await readFile(file);
    if (file.endsWith('index.html')) body = Buffer.from(body.toString('utf8').replace('<head>', `<head><script>window.MYBOTS_DESKTOP=${JSON.stringify({ port: app.port, token: app.token })}</script>`));
    response.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream' }).end(body);
  }).listen(0, '127.0.0.1');
  await new Promise(resolve => web.on('listening', resolve));
  const { chromium } = createRequire(new URL('../pc/package.json', import.meta.url))('playwright-core');
  const browser = await chromium.launch({ executablePath: browserPath, headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  t.after(async () => { await browser.close(); web.close(); await app.close(); await rm(directory, { recursive: true, force: true }); });
  await app.rpc('room.create', { name: 'Estudos', botIds: bots.slice(0, 2).map(bot => bot.id) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const seen = async (text, options = {}) => page.getByText(text, { exact: true }).first().waitFor({ timeout: 40000, ...options });
  await page.goto(`http://127.0.0.1:${web.address().port}/`);

  await page.getByLabel('Escritório', { exact: true }).click();
  await page.getByLabel('Conversar com Atlas no escritório').waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="Cena do escritório"] canvas'));
  await page.evaluate(() => { window.officeCanvas = document.querySelector('[aria-label="Cena do escritório"] canvas'); });
  await page.getByRole('button', { name: 'Selecionar bot Atlas', exact: true }).click();
  const composer = page.getByLabel('Sua mensagem', { exact: true });
  await composer.fill('Rascunho do Atlas');
  await page.getByRole('button', { name: 'Equipe', exact: true }).first().click();
  await page.getByLabel('Conversar com Clara no escritório').click();
  assert.equal(await composer.inputValue(), '');
  await composer.fill('Rascunho da Clara');
  await page.getByRole('button', { name: 'Equipe', exact: true }).first().click();
  await page.getByLabel('Conversar com Atlas no escritório').click();
  assert.equal(await composer.inputValue(), 'Rascunho do Atlas');
  await page.getByLabel('Recolher painel do escritório').click();
  await page.evaluate(() => { const data = new DataTransfer(); data.items.add(new File(['x'], 'oculto.txt', { type: 'text/plain' })); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  assert.equal(await page.getByText('oculto.txt', { exact: true }).count(), 0, 'hidden chat must not capture pasted files');
  assert.equal(await composer.inputValue(), 'Rascunho do Atlas');
  await page.getByLabel('Enviar mensagem', { exact: true }).click();
  await seen('Pronto.');
  assert.equal(await composer.inputValue(), '');
  await page.getByLabel('Abrir arquivo revisao.md').click();
  await seen('Revisão visual');
  assert.ok(await page.getByLabel('Cena do escritório', { exact: true }).isVisible());
  await page.keyboard.press('Escape');
  assert.equal(await page.getByText('Revisão visual', { exact: true }).count(), 0);
  assert.ok(await page.getByLabel('Recolher painel do escritório').isVisible());
  await page.getByLabel('Abrir sala Estudos', { exact: true }).click();
  await page.getByLabel('Mensagem para a sala', { exact: true }).fill('Rascunho da sala');
  await page.getByLabel('Recolher painel do escritório').click();
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  assert.equal(await page.getByLabel('Mensagem para a sala').inputValue(), 'Rascunho da sala');
  // A room's text and attachment survive switching away and back, and can actually be sent.
  const roomChooser = page.waitForEvent('filechooser'); await page.getByLabel('Anexar arquivo ou foto').click();
  await (await roomChooser).setFiles({ name: 'sala.txt', mimeType: 'text/plain', buffer: Buffer.from('anexo da sala') });
  await seen('sala.txt');
  await page.getByRole('button', { name: 'Equipe', exact: true }).first().click();
  await page.getByLabel('Conversar com Atlas no escritório').click();
  const botChooser = page.waitForEvent('filechooser'); await page.getByLabel('Anexar arquivo ou foto').click();
  await (await botChooser).setFiles({ name: 'bot.txt', mimeType: 'text/plain', buffer: Buffer.from('anexo do bot') });
  await seen('bot.txt');
  await page.getByLabel('Abrir sala Estudos', { exact: true }).click();
  assert.equal(await page.getByLabel('Mensagem para a sala').inputValue(), 'Rascunho da sala');
  await seen('sala.txt');
  await page.getByLabel('Enviar mensagem', { exact: true }).click();
  await page.getByText('Rascunho da sala', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Equipe', exact: true }).first().click();
  await page.getByLabel('Conversar com Atlas no escritório').click();
  await seen('bot.txt');
  await page.getByLabel('Remover bot.txt').click();
  await composer.fill('Aprovação real'); await page.getByLabel('Enviar mensagem', { exact: true }).click();
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click();
  for (let attempt = 0; attempt < 200 && !app.db.all('SELECT * FROM pending_items').some(item => item.bot_id === bots[0].id); attempt++) await page.waitForTimeout(20);
  assert.equal(app.state().approvals.length, 0);
  assert.equal(app.db.all('SELECT * FROM pending_items').some(item => item.bot_id === bots[0].id), true);
  await page.getByRole('button', { name: 'Atlas', exact: true }).click();
  await composer.fill('Teste cancelamento'); await page.getByLabel('Enviar mensagem', { exact: true }).click();
  await page.getByRole('button', { name: 'Tarefas', exact: true }).click();
  await page.getByLabel('Tarefas de Atlas').getByText('Esperando cancelamento', { exact: true }).waitFor(); await page.getByLabel('Tarefas de Atlas').getByText('Teste cancelamento', { exact: true }).waitFor();
  if (process.env.MYBOTS_OFFICE_SCREENSHOT) await page.screenshot({ path: process.env.MYBOTS_OFFICE_SCREENSHOT.replace('.png', '-task.png') });
  await page.getByRole('button', { name: 'Parar tarefa de Atlas' }).click();
  await page.waitForFunction(() => !document.body.innerText.includes('Esperando cancelamento'), null, { timeout: 30000 });
  assert.ok(app.db.tasks().some(task => task.bot_id === bots[0].id && task.state === 'cancelled'));
  await page.keyboard.press('Escape');
  assert.equal(await page.getByLabel('Recolher painel do escritório').isVisible(), false);
  await page.getByRole('button', { name: 'Conversa', exact: true }).click();
  await page.getByLabel('Abrir sala Estudos', { exact: true }).click();
  assert.ok(await page.evaluate(() => window.officeCanvas === document.querySelector('[aria-label="Cena do escritório"] canvas')), 'scene stays mounted');
  if (process.env.MYBOTS_OFFICE_SCREENSHOT) await page.screenshot({ path: process.env.MYBOTS_OFFICE_SCREENSHOT.replace('.png', '-wide.png') });
  await page.setViewportSize({ width: 900, height: 900 });
  assert.ok(await page.getByLabel('Mensagem para a sala').isVisible());
  assert.ok(await page.getByLabel('Cena do escritório', { exact: true }).isVisible());
  if (process.env.MYBOTS_OFFICE_SCREENSHOT) await page.screenshot({ path: process.env.MYBOTS_OFFICE_SCREENSHOT });
  assert.deepEqual(errors.filter(error => !/favicon|Failed to load resource/.test(error)), []);
});
