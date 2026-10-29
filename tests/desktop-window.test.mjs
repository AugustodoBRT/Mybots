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
const hasChrome = existsSync('/usr/bin/google-chrome-stable');
const selection = { model: 'test', reasoningEffort: 'low' };
const codex = { status: async () => ({ available: true, loggedIn: true }), models: async () => [{ ...selection, displayName: 'Test', isDefault: true, efforts: ['low'], defaultEffort: 'low' }],
  limits: async () => ({ plan: 'plus', windows: [{ key: 'five_hour', used: 32, resetsAt: Date.now() + 3600000 }] }) };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf', '.png': 'image/png' };

// The computer's window, for real: the exported web app in Chrome, talking to a real supervisor with fake bots.
test('janela do PC: lista, abas, Ctrl+K, Ctrl+N, Ajustes em duas colunas, Atividade em colunas e janela estreita', { skip: !hasChrome, timeout: 600000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-pcwin-')); const ui = join(directory, 'ui');
  await run('npx', ['expo', 'export', '--platform', 'web', '--output-dir', ui], { cwd: new URL('../mobile', import.meta.url).pathname, timeout: 400000, maxBuffer: 1 << 26 });
  const app = await createSupervisor({ directory: join(directory, 'sup'), port: 0, codex, execute: async () => ({ text: 'Pronto.', ...selection }) });
  const bots = []; for (const name of ['Atlas', 'Clara', 'Nico']) bots.push(await app.rpc('bot.create', { name, instructions: `Bot ${name}.`, access: 'ask', face: { seed: name }, ...selection }));
  await app.rpc('person.update', { name: 'Augusto' });
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
  const errors = []; page.on('pageerror', error => errors.push(error.message)); page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const seen = async (text, options = {}) => page.getByText(text, { exact: true }).first().waitFor({ timeout: 40000, ...options });
  await page.goto(`http://127.0.0.1:${web.address().port}/`);

  // Nothing open: the greeting, the day in a sentence and three quiet actions.
  await page.getByText(/^(Bom dia|Boa tarde|Boa noite), Augusto\.$/).first().waitFor({ timeout: 60000 });
  for (const label of ['Novo bot', 'Nova sala', 'Buscar · Ctrl+K']) await seen(label);
  for (const name of ['Atlas', 'Clara', 'Nico']) await page.getByLabel(`Conversar com ${name}`).first().waitFor();
  for (const label of ['Conversas', 'Atividade', 'Rotinas', 'Negociações', 'Ajustes', 'Ajuda e atalhos']) await page.getByLabel(label).first().waitFor();

  // A conversation opens in a tab; the toolbar and the closed side panel are there.
  await page.getByLabel('Conversar com Atlas').first().click();
  await page.getByRole('tab', { name: /Atlas/ }).waitFor();
  for (const label of ['Abrir navegador', 'Perfil']) await seen(label);
  assert.equal(await page.getByText('Aprovações e hoje').count(), 0, 'o painel direito começa fechado');
  await page.getByText('Aprovações', { exact: false }).first().click(); await seen('Aprovações e hoje'); await page.keyboard.press('Escape');
  assert.equal(await page.getByText('Aprovações e hoje').count(), 0, 'Esc fecha o painel');

  // A file is attached from the window (button) and shown in the tray; one over the limit is refused with a clear message.
  const chooser = page.waitForEvent('filechooser'); await page.getByLabel('Anexar arquivo ou foto').click();
  await (await chooser).setFiles({ name: 'prova.txt', mimeType: 'text/plain', buffer: Buffer.from('oi, bot') }); await seen('prova.txt');
  const big = page.waitForEvent('filechooser'); await page.getByLabel('Anexar arquivo ou foto').click();
  await (await big).setFiles({ name: 'grande.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(3 * 1024 * 1024) });
  await page.getByText('No computador, os anexos de uma mensagem podem somar até 2,5 MB. Para arquivos maiores, use o celular.', { exact: true }).waitFor({ timeout: 30000 });

  // Ctrl+K searches and Enter opens the first match.
  await page.keyboard.press('Control+k'); await page.getByLabel('Buscar e trocar de bot').fill('nic'); await seen('↑ ↓ escolhem · Enter abre · Esc fecha · Ctrl+N cria um bot');
  await page.keyboard.press('Enter'); await page.getByRole('tab', { name: /Nico/ }).waitFor();
  assert.equal(await page.getByRole('tab').count(), 2, 'uma aba por conversa aberta');

  // Ctrl+N starts the new bot; Esc/close leaves.
  await page.keyboard.press('Control+n'); await seen('Passo 1 de 3 · Rosto'); await page.getByLabel('Cancelar').first().click();

  // Ajustes, Atividade, Rotinas and Negociações are whole pages beside the icon bar (not dialogs): the bar stays, the list goes.
  const railStays = async () => { for (const label of ['Conversas', 'Atividade', 'Rotinas', 'Negociações', 'Ajustes']) await page.getByLabel(label, { exact: true }).first().waitFor({ state: 'visible' }); };
  await page.getByLabel('Ajustes', { exact: true }).first().click(); await seen('Conta e IA', { state: 'visible' }); await railStays();
  assert.equal(await page.getByLabel('Conversar com Atlas').count(), 0, 'a lista de conversas sai da frente');
  assert.equal(await page.getByLabel('Fechar os ajustes').count(), 0, 'não é um diálogo com botão de fechar');
  assert.equal(await page.getByText('Senhas e carteira').count(), 0);
  for (const label of ['Bots', 'Celular', 'Sobre']) await page.getByLabel(new RegExp(`^${label}\\.`)).first().waitFor();
  await seen('Aparência');
  const settingsBox = await page.getByText('Aparência', { exact: true }).first().boundingBox(); assert.ok(settingsBox.x > 300, 'o conteúdo ocupa o espaço ao lado das categorias');

  await page.getByLabel('Atividade', { exact: true }).first().click(); await railStays();
  for (const heading of ['Precisa de você', 'Em andamento', 'Concluído hoje']) await seen(heading);
  const columns = await Promise.all(['Precisa de você', 'Em andamento', 'Concluído hoje'].map(text => page.getByText(text, { exact: true }).first().boundingBox()));
  assert.ok(columns[2].x > 900, 'a terceira coluna usa a largura da janela');
  await page.getByLabel('Rotinas', { exact: true }).first().click(); await seen('Nenhuma rotina ainda. Abra um bot e crie uma em Rotinas.'); await railStays();
  await page.getByLabel('Negociações', { exact: true }).first().click(); await seen('Nenhuma negociação ainda. Abra um bot e crie uma em Negociar.');
  // The plans' limits are the AI's own symbol in a ring, not names.
  await page.getByLabel(/^Codex: \d+% livre$/).first().waitFor();
  assert.equal(await page.getByText('Codex', { exact: true }).count(), 0, 'sem o nome escrito');
  await page.getByLabel('Conversas', { exact: true }).first().click(); await page.getByLabel('Conversar com Atlas').first().waitFor();

  // Narrow window: the list keeps only the faces and still opens conversations.
  await page.setViewportSize({ width: 860, height: 800 });
  await page.waitForFunction(() => !document.body.innerText.includes('Buscar bot ou sala'));
  await page.getByLabel('Conversar com Clara').first().click(); await page.getByRole('tab', { name: /Clara/ }).waitFor();
  assert.deepEqual(errors.filter(error => !/favicon|Failed to load resource/.test(error)), []);
});
