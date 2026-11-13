import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BrowserSession } from '../pc/browser-worker.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { DEV_PORTS } from '../supervisor/browser.mjs';

// The bot's browser opens only the usual development ports on this computer: take two free ones.
async function listen(server) {
  for (const port of [...DEV_PORTS].reverse()) {
    const ok = await new Promise(resolve => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
    if (ok) return;
  }
  throw new Error('Nenhuma porta de desenvolvimento livre.');
}

test('browser_act type takes text (and submit) only, with a click point', () => {
  assert.deepEqual(toolArguments('browser.act', { action: 'type', x: 10, y: 20, text: 'Uma tela de equipe', submit: true }), { action: 'type', x: 10, y: 20, text: 'Uma tela de equipe', submit: true });
  assert.throws(() => toolArguments('browser.act', { action: 'type', x: 10, y: 20 }), /text/);
  assert.throws(() => toolArguments('browser.act', { action: 'type', text: 'x' }), /Coordenadas/);
  assert.throws(() => toolArguments('browser.act', { action: 'type', x: 1, y: 1, text: 'a'.repeat(4001) }), /4\.000/);
  assert.throws(() => toolArguments('browser.act', { action: 'click', x: 1, y: 1, text: 'oi' }), /só valem com action "type"/);
});

// 13/11/2026: Google Stitch draws its prompt inside another site's frame, so browser_read lists nothing and no bot could type in it.
test('Chrome: a bot types where it clicks, inside another site\'s frame and shadow roots, never in passwords or card fields', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async t => {
  const inner = createServer((req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<body style="margin:0"><textarea id="prompt" style="position:absolute;left:10px;top:10px;width:300px;height:60px"></textarea>
      <input id="senha" type="password" style="position:absolute;left:10px;top:100px;width:200px;height:30px">
      <input id="cartao" autocomplete="cc-number" style="position:absolute;left:10px;top:150px;width:200px;height:30px">
      <div id="host" style="position:absolute;left:10px;top:200px"></div>
      <script>const r = document.querySelector('#host').attachShadow({ mode: 'open' }); r.innerHTML = '<div contenteditable="true" id="rich" style="width:300px;height:40px"></div>';
      document.querySelector('#prompt').addEventListener('keydown', e => { if (e.key === 'Enter') document.title = 'enviado'; });</script></body>`);
  });
  await listen(inner);
  const outer = createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<body style="margin:0"><iframe src="http://127.0.0.1:${inner.address().port}/" style="position:absolute;left:100px;top:50px;width:600px;height:400px;border:0"></iframe></body>`); });
  await listen(outer);
  const directory = await mkdtemp(join(tmpdir(), 'mybots-browser-type-'));
  const s = new BrowserSession(directory);
  t.after(async () => { await s.close(); inner.close(); outer.close(); await rm(directory, { recursive: true, force: true }); });
  await s.start();
  // The frame comes from another port: another origin, which a script of the page cannot reach.
  await s.page.goto(`http://127.0.0.1:${outer.address().port}/`);
  const frame = await (await s.page.waitForSelector('iframe')).contentFrame(); await frame.waitForSelector('#prompt');
  assert.equal((await s.command('read')).elements.filter(el => el.kind === 'text').length, 0, 'the fields are not listed, as in Stitch');

  await s.command('act', { action: 'type', x: 150, y: 80, text: 'Tela inicial ousada', submit: true });
  assert.match(await frame.locator('#prompt').inputValue(), /^Tela inicial ousada/);
  assert.equal(await frame.evaluate(() => document.title), 'enviado');

  await s.command('act', { action: 'type', x: 150, y: 270, text: 'texto rico' });
  assert.equal(await frame.evaluate(() => document.querySelector('#host').shadowRoot.querySelector('#rich').textContent), 'texto rico');

  await assert.rejects(s.command('act', { action: 'type', x: 150, y: 165, text: 'segredo' }), /Senhas/);
  assert.equal(await frame.locator('#senha').inputValue(), '');
  await assert.rejects(s.command('act', { action: 'type', x: 150, y: 215, text: '4111111111111111' }), /cartão/);
  assert.equal(await frame.locator('#cartao').inputValue(), '');
  await assert.rejects(s.command('act', { action: 'type', x: 650, y: 420, text: 'nada' }), /Nenhum campo de texto/);
});

// 13/11/2026: bots started local servers just to look at their own mockups; the computer's browser now opens them from the file.
test('Chrome: a bot opens its own HTML file from the home folder, with its CSS; files outside home or secrets do not open', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async t => {
  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { homedir } = await import('node:os');
  const { localFileUrl, safeUrl } = await import('../supervisor/browser.mjs');
  mkdirSync(join(homedir(), '.cache'), { recursive: true });
  const folder = mkdtempSync(join(homedir(), '.cache', 'mybots-file-test-'));
  const directory = await mkdtemp(join(tmpdir(), 'mybots-browser-file-'));
  const s = new BrowserSession(directory);
  t.after(async () => { await s.close(); rmSync(folder, { recursive: true, force: true }); await rm(directory, { recursive: true, force: true }); });
  writeFileSync(join(folder, 'estilo.css'), 'h1 { color: rgb(255, 0, 0); }');
  writeFileSync(join(folder, 'tela inicial.html'), '<link rel="stylesheet" href="estilo.css"><h1>Tela do bot</h1>');
  assert.equal(toolArguments('browser.open', { url: join(folder, 'tela inicial.html') }).url, localFileUrl(join(folder, 'tela inicial.html')));
  assert.throws(() => toolArguments('browser.open', { url: '/home/x/.ssh/config.html' }), /senhas ou chaves/);
  assert.throws(() => safeUrl('/home/x/notas.html'), /inválido|http ou https/, 'outside browser_open (a person typing, a redirect) the old rule holds');
  await s.start();
  const opened = await s.command('open', { url: toolArguments('browser.open', { url: join(folder, 'tela inicial.html') }).url });
  assert.match(opened.url, /^file:\/\/.*tela%20inicial\.html$/);
  assert.match((await s.command('read', {})).text, /Tela do bot/);
  assert.equal(await s.page.evaluate(() => getComputedStyle(document.querySelector('h1')).color), 'rgb(255, 0, 0)', 'its own CSS loads');
  await assert.rejects(s.command('open', { url: 'file:///etc/hostname.txt' }), /não achei|pasta pessoal/i);
  await assert.rejects(s.command('open', { url: localFileUrl(join(folder, 'nao-existe.html')) }), /Não achei/);
});

// 13/11/2026: Google Stitch's "Copy code" said "Failed to copy HTML" and its ZIP never reached the bot.
test('Chrome: what a site copies (even inside another site\'s frame) reaches the bot as a file, and "Save as" becomes a download', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async t => {
  const inner = createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<body style="margin:0">
    <button id="copiar" style="position:absolute;left:10px;top:10px;width:200px;height:40px" onclick="navigator.clipboard.writeText('<html><body>Tela gerada</body></html>').then(() => document.title = 'copiou', () => document.title = 'falhou')">Copiar código</button>
    <button id="salvar" style="position:absolute;left:10px;top:70px;width:200px;height:40px" onclick="(async () => { const h = await showSaveFilePicker({ suggestedName: 'tela.zip' }); const w = await h.createWritable(); await w.write(new Blob(['PK conteúdo'])); await w.close(); })()">Baixar ZIP</button></body>`); });
  await listen(inner);
  const outer = createServer((req, res) => { res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(`<body style="margin:0"><iframe src="http://127.0.0.1:${inner.address().port}/" style="position:absolute;left:0;top:0;width:600px;height:300px;border:0"></iframe></body>`); });
  await listen(outer);
  const directory = await mkdtemp(join(tmpdir(), 'mybots-browser-copy-')), downloads = await mkdtemp(join(tmpdir(), 'mybots-downloads-'));
  const previous = process.env.MYBOTS_DOWNLOADS; process.env.MYBOTS_DOWNLOADS = downloads;
  const s = new BrowserSession(directory, { botId: 'bot1' });
  t.after(async () => { await s.close(); inner.close(); outer.close(); if (previous === undefined) delete process.env.MYBOTS_DOWNLOADS; else process.env.MYBOTS_DOWNLOADS = previous; await rm(directory, { recursive: true, force: true }); await rm(downloads, { recursive: true, force: true }); });
  await s.start();
  await s.page.goto(`http://127.0.0.1:${outer.address().port}/`);
  const frame = await (await s.page.waitForSelector('iframe')).contentFrame(); await frame.waitForSelector('#copiar');
  const copied = await s.command('act', { action: 'click', x: 100, y: 30 });
  assert.equal(await frame.evaluate(() => document.title), 'copiou', 'the site is told the copy worked');
  assert.match(copied.copied.start, /Tela gerada/); assert.match(copied.copied.file.name, /^copiado-.*\.html$/);
  const { readFileSync } = await import('node:fs');
  assert.equal(readFileSync(join(downloads, 'bot1', copied.copied.file.name), 'utf8'), '<html><body>Tela gerada</body></html>');
  assert.equal((await s.command('read', {})).copied, undefined, 'reported once');
  const saved = await s.command('act', { action: 'click', x: 100, y: 90 });
  assert.equal(saved.download?.name, 'tela.zip');
  assert.equal(readFileSync(join(downloads, 'bot1', 'tela.zip'), 'utf8'), 'PK conteúdo');
});
