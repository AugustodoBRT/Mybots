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
  await page.getByLabel('Opções da conversa').first().waitFor();
  assert.equal(await page.getByText('Aprovações e hoje').count(), 0, 'a barra direita começa fechada');
  // One button opens the right sidebar with the conversation's options; its rows lead to the model, browser, profile and what waits.
  await page.getByLabel('Opções da conversa').first().click(); for (const label of ['Navegador do bot', 'Perfil e permissões', 'Aprovações e hoje']) await seen(label);
  await page.getByText('Navegador do bot').first().click(); await seen('Navegador de Atlas · celular'); await seen('O navegador do bot fica no app MyBots, que não está ativo agora. Abra o MyBots no celular.');
  await page.getByText('Aprovações e hoje').first().click(); await seen('Esperando você'); await page.keyboard.press('Escape');
  assert.equal(await page.getByText('Esperando você').count(), 0, 'Esc fecha a barra');

  // A file is attached from the window (button) and shown in the tray; a file bigger than 10 MB attaches too (it goes in parts).
  const chooser = page.waitForEvent('filechooser'); await page.getByLabel('Anexar arquivo ou foto').click();
  await (await chooser).setFiles({ name: 'prova.txt', mimeType: 'text/plain', buffer: Buffer.from('oi, bot') }); await seen('prova.txt');
  const big = page.waitForEvent('filechooser'); await page.getByLabel('Anexar arquivo ou foto').click();
  await (await big).setFiles({ name: 'grande.dat', mimeType: 'application/octet-stream', buffer: Buffer.alloc(11 * 1024 * 1024) });
  await seen('grande.dat');

  // Pasting a picture (Ctrl+V) and dragging a file onto the window attach them too; pasted text stays text.
  await page.evaluate(() => { const data = new DataTransfer(); data.items.add(new File(['x'], 'colada.png', { type: 'image/png' })); window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })); });
  await seen('colada.png');
  await page.evaluate(() => { const data = new DataTransfer(); data.items.add(new File(['y'], 'arrastada.txt', { type: 'text/plain' })); window.dispatchEvent(new DragEvent('dragenter', { dataTransfer: data, bubbles: true, cancelable: true })); });
  await seen('Solte para anexar à mensagem');
  await page.evaluate(() => { const data = new DataTransfer(); data.items.add(new File(['y'], 'arrastada.txt', { type: 'text/plain' })); window.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true })); });
  await seen('arrastada.txt');
  assert.equal(await page.getByText('Solte para anexar à mensagem').count(), 0, 'a faixa some ao soltar');
  // The attached files go with the message to the bot: the message shows them.
  await page.getByLabel('Sua mensagem').fill('Veja os anexos'); await page.getByLabel('Enviar mensagem').click();
  await seen('Veja os anexos'); await page.getByLabel(/Imagem colada\.png/).first().waitFor(); await seen('arrastada.txt');

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
  for (const heading of ['Precisa de você', 'Em andamento', 'Concluído hoje', 'Gasto nos últimos 7 dias', 'Gasto de cada bot']) await seen(heading);
  // The week is a line (not columns) with dollars; every bot is listed with its own spend, also the one that spent nothing.
  const chart = page.getByLabel(/^Gasto estimado por dia: /); await chart.waitFor();
  assert.ok((await chart.locator('path').count()) >= 1, 'o gráfico é uma linha');
  assert.match(await chart.getAttribute('aria-label'), /US\$ \d/);
  await seen('Nenhuma resposta nesta semana');
  for (const name of ['Atlas', 'Clara', 'Nico']) assert.ok(await page.getByText(name, { exact: true }).count() >= 1, `${name} aparece no gasto`);
  const spend = await page.getByText(/^US\$ \d/).allInnerTexts(); assert.ok(spend.length >= 3, 'valores em dólar na página');
  const box = await page.getByText('Gasto nos últimos 7 dias', { exact: true }).first().boundingBox(); const side = await page.getByText('Precisa de você', { exact: true }).first().boundingBox();
  assert.ok(box.x < side.x && side.x > 700, 'o gasto ocupa a área principal e as listas ficam ao lado');
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

  // A phone still running the previous supervisor sends no dollars: the page must not show a misleading zero.
  const original = app.db.usage.bind(app.db);
  app.db.usage = (...args) => { const usage = original(...args); for (const entry of Object.values(usage.bots)) delete entry.cost; usage.days = usage.days.map(({ cost, ...rest }) => rest); return usage; };
  await page.setViewportSize({ width: 1440, height: 900 }); await page.reload();
  await page.getByLabel('Atividade', { exact: true }).first().click(); await seen('Uso nos últimos 7 dias');
  await page.getByText('O supervisor do celular ainda é de uma versão anterior', { exact: false }).first().waitFor();
  assert.ok(await page.getByText(/^≈ US\$ \d/).count() >= 1, 'o valor de cada bot vira estimativa local');
  assert.equal(await page.getByText('US$ 0,00', { exact: true }).count() < 4, true);
  assert.match(await page.getByLabel(/^Uso em tokens por dia/).getAttribute('aria-label'), /mi/);
  assert.deepEqual(errors.filter(error => !/favicon|Failed to load resource/.test(error)), []);
});
