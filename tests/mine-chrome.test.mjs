import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chromium } from '../pc/node_modules/playwright-core/index.mjs';
import { BrowserSession, chromeEndpoint, CHROME_SETUP } from '../pc/browser-worker.mjs';
import { PcBrowser } from '../pc/browser.mjs';
import { browserMode, validateProfile } from '../supervisor/tool-policy.mjs';
import { Database } from '../supervisor/database.mjs';

async function chrome(t) {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-mine-'));
  const child = spawn('/usr/bin/google-chrome-stable', ['--headless=new','--no-sandbox','--no-first-run','--no-default-browser-check','--remote-debugging-port=0', '--user-data-dir=' + directory], { stdio: 'ignore' });
  let browser;
  t.after(async () => { await browser?.close().catch(() => {}); if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited; } await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  let endpoint;
  for (let n = 0; n < 200; n++) { try { endpoint = chromeEndpoint(directory); break; } catch { await new Promise(r => setTimeout(r, 20)); } }
  assert.ok(endpoint, 'Chrome publicou o endereço de depuração');
  browser = await chromium.connectOverCDP(endpoint, { noDefaults: true });
  const personal = browser.contexts()[0].pages()[0] || await browser.contexts()[0].newPage();
  await personal.goto('about:blank');
  await personal.setContent('<title>Aba da pessoa</title><p>conteúdo pessoal que não deve aparecer nos resultados do bot</p>');
  return { directory, browser, personal, child };
}

test('Meu Chrome: endpoint is loopback only, malformed files refused; modes validate and legacy profiles migrate on read', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-modes-')); const db = new Database(join(directory, 'db'));
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  assert.equal(browserMode({}), 'shared'); assert.equal(browserMode({ browserMode: 'own' }), 'shared'); assert.equal(browserMode({ provider: 'claude', mainChrome: true }), 'claude');
  assert.throws(() => validateProfile({ browserMode: 'other' }));
  assert.throws(() => validateProfile({ browserMode: 'claude', provider: 'codex' }));
  assert.throws(() => validateProfile({ browserMode: 'mine', access: 'basic' }));
  const bot = db.create({ name: 'Antigo' }, { provider: 'claude', model: 'haiku', reasoningEffort: 'low' });
  const legacy = { ...bot, mainChrome: true }; delete legacy.browserMode;
  db.putBot(legacy);
  assert.equal(db.requireBot(bot.id).browserMode, 'claude'); assert.equal(db.requireBot(bot.id).mainChrome, undefined);
  db.session(bot.id, randomUUID()); db.configure(bot.id, { provider: 'claude' }, { browserMode: 'mine' });
  assert.equal(db.requireBot(bot.id).codexSessionId, undefined);
  const pc = new PcBrowser(directory, { mineProfile: join(directory, 'ausente') }); const id = randomUUID(); pc.configure(id, 'mine');
  assert.deepEqual(await pc.command(id, 'view', { on: false }), { watching: false }); assert.equal(pc.workers.size, 0);
  const unstarted = new BrowserSession('/ausente', { mode: 'mine' }); assert.deepEqual(await unstarted.command('login_cancel'), { cancelled: true }); assert.equal(unstarted.browser, undefined);
  const profile = join(directory, 'chrome'); await mkdir(profile);
  assert.throws(() => chromeEndpoint(profile), { message: CHROME_SETUP });
  for (const value of ['0\n/devtools/browser/id', '9222\nws://outro/browser/id', '99999\n/devtools/browser/id', '9222\n/devtools/browser/id\nextra']) {
    await writeFile(join(profile, 'DevToolsActivePort'), value); assert.throws(() => chromeEndpoint(profile));
  }
  await writeFile(join(profile, 'DevToolsActivePort'), '9222\n/devtools/browser/test-id');
  assert.equal(chromeEndpoint(profile), 'ws://127.0.0.1:9222/devtools/browser/test-id');
});

test('Meu Chrome real: only bot tabs are read/routed/closed, popups become checked tabs; Chrome and personal page survive disconnect', { skip: !existsSync('/usr/bin/google-chrome-stable'), timeout: 30000 }, async t => {
  const c = await chrome(t), s = new BrowserSession(c.directory, { mode: 'mine' });
  t.after(() => s.close());
  const personalSize = await c.personal.evaluate(() => [innerWidth, innerHeight]);
  await s.start();
  assert.deepEqual(await c.personal.evaluate(() => [innerWidth, innerHeight]), personalSize);
  assert.deepEqual(await s.page.evaluate(() => [innerWidth, innerHeight]), [1280, 800]);
  await s.page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">');
  await s.input({ type: 'viewport', width: 390, height: 720, deviceScaleFactor: 3 });
  assert.equal(await s.page.evaluate(() => innerWidth), 390);
  assert.deepEqual(await c.personal.evaluate(() => [innerWidth, innerHeight]), personalSize);
  await s.deviceView({ restore: true });
  assert.deepEqual(await s.page.evaluate(() => [innerWidth,innerHeight,devicePixelRatio]), [1280,800,1]);
  assert.notEqual(s.page, c.personal); assert.equal((await s.command('tabs', { action: 'list' })).tabs.length, 1);
  await c.browser.contexts()[0].addCookies([{ name: 'mybots_test', value: 'conta_de_teste', domain: 'example.com', path: '/' }]);
  await s.page.goto('https://example.com');
  assert.match(await s.page.evaluate(() => document.cookie), /mybots_test=conta_de_teste/);
  const read = await s.command('read'); assert.doesNotMatch(JSON.stringify(read), /conteúdo pessoal|Aba da pessoa/);
  await s.command('tabs', { action: 'new', url: 'https://example.com/#segunda' });
  assert.equal((await s.command('tabs', { action: 'list' })).tabs.length, 2);
  const active = s.page, originalRoute = s.route.bind(s);
  let release, started; const held = new Promise(resolve => { release = resolve; }); const paused = new Promise(resolve => { started = resolve; });
  t.signal.addEventListener('abort', () => release(), { once: true });
  s.route = async route => { if (route.request().url().includes('/never')) { started(); await held; await route.abort().catch(() => {}); } else await originalRoute(route); };
  await active.evaluate(() => window.open('https://example.com/never#popup'));
  await paused;
  for (let n = 0; n < 100 && s.pages.length < 3; n++) await new Promise(r => setTimeout(r, 20));
  assert.equal(s.pages.length, 3);
  assert.equal(await c.personal.title(), 'Aba da pessoa'); assert.equal(c.personal.url(), 'about:blank');
  await assert.rejects(s.command('tabs', { action: 'new', url: 'http://127.0.0.1' }));
  const { createServer } = await import('node:http');
  const local = createServer((request, response) => { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end('<title>Página pessoal local</title><p>pessoa</p>'); });
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  t.after(() => { local.closeAllConnections(); return new Promise(resolve => local.close(resolve)); });
  const localUrl = `http://127.0.0.1:${local.address().port}`;
  await c.personal.goto(localUrl); assert.equal(await c.personal.title(), 'Página pessoal local');
  await assert.rejects(s.page.goto(localUrl));
  await s.close(); release(); assert.equal(c.child.exitCode, null); assert.equal(c.child.signalCode, null); assert.equal(c.personal.isClosed(), false);
  assert.equal(await c.personal.innerText('body'), 'pessoa');
  assert.equal(c.browser.contexts()[0].pages().length, 1);
});

test('Meu Chrome shared worker: two bots have distinct tabs and frames; stopping one preserves the other and the personal tab', { skip: !existsSync('/usr/bin/google-chrome-stable') }, async t => {
  const c = await chrome(t), frames = [], pc = new PcBrowser(join(c.directory, 'node'), { mineProfile: c.directory, onFrame: (botId, frame) => frames.push({ botId, ...frame }) });
  t.after(() => pc.close());
  const a = randomUUID(), b = randomUUID(); pc.configure(a, 'mine'); pc.configure(b, 'mine');
  await pc.command(a, 'open', { url: 'https://example.com/#a' });
  await pc.command(b, 'open', { url: 'https://example.com/#b' });
  assert.equal(pc.workers.size, 1); assert.ok(pc.workers.has('mine'));
  assert.match((await pc.command(a, 'read', {})).url, /#a$/); assert.match((await pc.command(b, 'read', {})).url, /#b$/);
  await pc.command(a, 'view', { on: true }); await pc.command(b, 'view', { on: true });
  for (let n = 0; n < 100 && !frames.some(f => f.botId === b && f.image); n++) await new Promise(r => setTimeout(r, 20));
  assert.ok(frames.some(f => f.botId === a && f.url?.endsWith('#a'))); assert.ok(frames.some(f => f.botId === b && f.url?.endsWith('#b')));
  assert.ok(frames.every(f => !f.url || f.url !== c.personal.url()));
  pc.stop(a); assert.match((await pc.command(b, 'read', {})).url, /#b$/);
  await pc.close(); assert.equal(c.child.exitCode, null); assert.equal(c.child.signalCode, null); assert.equal(c.personal.isClosed(), false);
  assert.equal(c.browser.contexts()[0].pages().length, 1);
});
