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
