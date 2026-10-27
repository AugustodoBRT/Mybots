import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { BrowserSession, launchContext, importLogins, downloadName, IMPORTED } from '../pc/browser-worker.mjs';
import { PcBrowser } from '../pc/browser.mjs';
import { browserFiles } from '../pc/server.mjs';
import { personInput, stepCaption, Browser } from '../supervisor/browser.mjs';
import { browserMode, validateProfile } from '../supervisor/tool-policy.mjs';
import { validateBackup } from '../mobile/local.js';
import { Database } from '../supervisor/database.mjs';

const chrome = { skip: !existsSync('/usr/bin/google-chrome-stable'), timeout: 60000 };
const wait = async check => { for (let n = 0; n < 300; n++) { if (await check()) return; await new Promise(r => setTimeout(r, 20)); } assert.fail('Estado esperado não chegou.'); };

test('modes: shared is the default, old own bots move to it, Pouco acesso stays separate; phone commands carry the profile', async t => {
  assert.equal(browserMode({}), 'shared'); assert.equal(browserMode({ browserMode: 'own' }), 'shared'); assert.equal(browserMode({ browserMode: 'separate' }), 'separate');
  validateProfile({ browserMode: 'separate' }); validateProfile({ browserMode: 'own' }); assert.throws(() => validateProfile({ browserMode: 'named' }));
  const directory = await mkdtemp(join(tmpdir(), 'mybots-shared-modes-')), db = new Database(join(directory, 'db'));
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const selection = { model: 'test', reasoningEffort: 'low' };
  const old = db.create({ name: 'Antigo' }, selection); db.putBot({ ...old, browserMode: 'own' });
  assert.equal(db.requireBot(old.id).browserMode, 'shared');
  assert.equal(db.create({ name: 'Novo' }, selection).browserMode, 'shared');
  assert.equal(db.create({ name: 'Pouco', access: 'basic' }, selection).browserMode, 'separate');
  assert.equal(db.configure(old.id, selection, { access: 'basic' }).browserMode, 'separate');
  const backup = { schema: 1, bots: [{ id: randomUUID(), name: 'B', instructions: '', color: 'green', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), messages: [], browserMode: 'separate' }] };
  validateBackup(backup); validateBackup({ ...backup, bots: [{ ...backup.bots[0], browserMode: 'own' }] });
  const shared = randomUUID(), separate = randomUUID(), sent = [];
  const browser = new Browser({ profile: id => id === separate ? 'separate' : 'shared' });
  browser.poll(commands => sent.push(...commands));
  browser.queue({ botId: shared, op: 'read', args: {} }).catch(() => {}); browser.poll(commands => sent.push(...commands));
  browser.queue({ botId: separate, op: 'read', args: {} }).catch(() => {});
  assert.deepEqual(sent.map(command => command.profile), ['shared', 'separate']); browser.close();
});

test('captions, person inputs and download names', async t => {
  assert.equal(stepCaption('open', { url: 'https://www.example.com/x' }), 'Abrindo example.com');
  assert.equal(stepCaption('click', { id: 3 }, { label: '  Entrar\n agora ' }), 'Clicando em ‘Entrar agora’');
  assert.equal(stepCaption('type', { id: 2, text: 'segredo' }, { label: 'E-mail' }), 'Digitando em ‘E-mail’');
  assert.equal(stepCaption('act', { action: 'scroll' }), 'Rolando a página');
  assert.equal(stepCaption('tabs', { action: 'close', tab: 2 }), 'Fechando a aba 2');
  for (const input of [{ type: 'forward' }, { type: 'tab_new' }]) assert.deepEqual(personInput({ ...input, url: 'x' }), input);
  assert.deepEqual(personInput({ type: 'tab_close', tab: 3 }), { type: 'tab_close', tab: 3 });
  assert.throws(() => personInput({ type: 'tab_close', tab: 9 }));
  const folder = await mkdtemp(join(tmpdir(), 'mybots-names-')); t.after(() => rm(folder, { recursive: true, force: true }));
  assert.equal(downloadName('../../etc/passwd', folder), '.._.._etc_passwd'.replace(/^\.+/, ''));
  assert.throws(() => downloadName('instalar.exe', folder), /executáveis/);
  writeFileSync(join(folder, 'nota.pdf'), 'x'); assert.equal(downloadName('nota.pdf', folder), 'nota (2).pdf');
});

test('downloads on the computer: listed newest first, read and removed only inside the bot folder', async t => {
  const root = await mkdtemp(join(tmpdir(), 'mybots-files-')), bot = randomUUID(), other = randomUUID();
  t.after(() => rm(root, { recursive: true, force: true }));
  mkdirSync(join(root, bot), { recursive: true }); mkdirSync(join(root, other), { recursive: true });
  writeFileSync(join(root, bot, 'boleto.pdf'), 'pdf'); writeFileSync(join(root, other, 'outro.txt'), 'não');
  assert.deepEqual(browserFiles(root, bot, 'list').files.map(file => file.name), ['boleto.pdf']);
  const file = browserFiles(root, bot, 'get', 'boleto.pdf');
  assert.equal(file.mime, 'application/pdf'); assert.equal(Buffer.from(file.data, 'base64').toString(), 'pdf');
  for (const name of ['../' + other + '/outro.txt', 'outro.txt', '']) assert.throws(() => browserFiles(root, bot, 'get', name), /não encontrado/);
  assert.throws(() => browserFiles(root, '../x', 'list'));
  assert.deepEqual(browserFiles(root, bot, 'delete', 'boleto.pdf'), { deleted: true }); assert.equal(browserFiles(root, bot, 'list').files.length, 0);
});

test('timeline keeps the latest 120 steps of each bot, pages back and drops a deleted bot', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-steps-')), db = new Database(join(directory, 'db'));
  t.after(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
  const a = db.create({ name: 'A' }, { model: 'test', reasoningEffort: 'low' }), b = db.create({ name: 'B' }, { model: 'test', reasoningEffort: 'low' });
  for (let n = 1; n <= 130; n++) db.addBrowserStep(a.id, null, { caption: 'Passo ' + n, url: 'https://example.com/' + n, image: n === 130 ? Buffer.from('jpeg') : null });
  db.addBrowserStep(b.id, null, { caption: 'Outro' });
  const latest = db.browserSteps(a.id, { limit: 40 });
  assert.equal(latest.length, 40); assert.equal(latest.at(-1).caption, 'Passo 130'); assert.equal(latest[0].caption, 'Passo 91');
  const earlier = db.browserSteps(a.id, { before: latest[0].id, limit: 120 });
  assert.equal(earlier.length, 80); assert.equal(earlier[0].caption, 'Passo 11');
  assert.equal(Buffer.from(db.browserStepImage(latest.at(-1).id).image, 'base64').toString(), 'jpeg'); assert.equal(db.browserStepImage(latest[0].id), null);
  db.delete(a.id); assert.equal(db.browserSteps(a.id).length, 0); assert.equal(db.browserSteps(b.id).length, 1);
});

test('shared Chrome: a login made by one bot serves another, a separate bot stays logged out; tabs, popups and takeover stay per bot', chrome, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-shared-'));
  let context;
  const open = () => context ||= launchContext(join(directory, 'shared', 'chrome'));
  const a = new BrowserSession(join(directory, 'shared', 'bots', 'a'), { mode: 'shared', connect: open, botId: randomUUID() });
  const b = new BrowserSession(join(directory, 'shared', 'bots', 'b'), { mode: 'shared', connect: open, botId: randomUUID() });
  const separate = new BrowserSession(join(directory, 'separado'), { botId: randomUUID() });
  t.after(async () => { await Promise.all([a, b, separate].map(s => s.close().catch(() => {}))); await (await context)?.close().catch(() => {}); await rm(directory, { recursive: true, force: true }); });
  await a.command('open', { url: 'https://example.com/' });
  await a.page.evaluate(() => { document.cookie = 'sessao=bot-a; max-age=3600; path=/'; });
  await b.command('open', { url: 'https://example.com/' });
  assert.match(await b.page.evaluate(() => document.cookie), /sessao=bot-a/);
  await separate.command('open', { url: 'https://example.com/' });
  assert.doesNotMatch(await separate.page.evaluate(() => document.cookie), /sessao/);
  // A's popup becomes A's tab; B never sees it.
  await a.page.evaluate(() => { const button = document.createElement('button'); button.id = 'abrir'; button.onclick = () => window.open('https://example.com/#popup'); document.body.append(button); });
  await a.page.click('#abrir'); await wait(() => a.tabList().length === 2);
  assert.equal(b.tabList().length, 1); assert.match((await a.command('tabs', { action: 'switch', tab: 2 })).url, /#popup$/);
  // Taking over A (phone size) leaves B's page as it was.
  await a.deviceView({ width: 360, height: 640, deviceScaleFactor: 2 });
  assert.equal(await a.page.evaluate(() => innerWidth), 360); assert.equal(await b.page.evaluate(() => innerWidth), 1280);
  // Stopping A closes only A's tabs; B and the shared Chrome keep running.
  await a.close(); assert.equal(b.page.isClosed(), false); assert.match((await b.command('read', {})).url, /example\.com/);
});

test('logins of the old Chrome of each bot are copied once into the shared one', chrome, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-import-')), legacy = join(directory, 'browsers', randomUUID());
  t.after(() => rm(directory, { recursive: true, force: true }));
  const old = await launchContext(legacy);
  await old.addCookies([{ name: 'login', value: 'antigo', domain: 'example.com', path: '/', expires: Math.floor(Date.now() / 1000) + 3600, secure: true, httpOnly: true, sameSite: 'Lax' }]);
  await old.close();
  const shared = await launchContext(join(directory, 'shared'));
  t.after(() => shared.close().catch(() => {}));
  assert.ok(await importLogins(shared, legacy) >= 1); assert.ok(existsSync(join(legacy, IMPORTED)));
  assert.equal((await shared.cookies('https://example.com')).find(cookie => cookie.name === 'login')?.value, 'antigo');
  assert.equal(await importLogins(shared, legacy), 0);
  // The node asks the shared worker for it only while the bot is in the shared browser.
  const pc = new PcBrowser(directory), bot = legacy.split('/').at(-1);
  pc.configure(bot, 'own'); assert.equal(pc.key(bot), 'shared'); assert.equal(pc.imports.size, 0);
  pc.configure(bot, 'separate'); assert.equal(pc.key(bot), bot);
});

test('live view: tab strip with back/forward, cursor and caption before a click, timeline picture and downloads of the bot', chrome, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-live-v58-')), downloads = join(directory, 'downloads'), frames = [];
  const previous = process.env.MYBOTS_DOWNLOADS; process.env.MYBOTS_DOWNLOADS = downloads;
  const botId = randomUUID(), s = new BrowserSession(join(directory, 'perfil'), { botId });
  s.frame = frame => frames.push(frame);
  t.after(async () => { process.env.MYBOTS_DOWNLOADS = previous; await s.close(); await rm(directory, { recursive: true, force: true }); });
  await s.command('open', { url: 'https://example.com/' });
  await s.view(true, { maxWidth: 640, maxHeight: 400 });
  await s.page.evaluate(() => { document.body.innerHTML = '<button id="b" aria-label="Baixar nota" onclick="const a = document.createElement(\'a\'); a.href = window.URL.createObjectURL(new Blob([\'conteúdo\'], { type: \'text/plain\' })); a.download = \'nota.txt\'; document.body.append(a); a.click()">Baixar</button>'; });
  const read = await s.command('read', {});
  const id = read.elements.find(item => /Baixar/.test(item.label || item.name || item.text || '')).id;
  const clicked = await s.command('click', { id });
  const action = frames.find(frame => frame.action)?.action;
  assert.equal(action.caption, 'Clicando em ‘Baixar nota’'); assert.ok(action.rect.width > 0 && action.point.x > 0); assert.equal(action.width, 1280);
  assert.equal(clicked.download.name, 'nota.txt'); assert.equal(readFileSync(join(downloads, botId, 'nota.txt'), 'utf8'), 'conteúdo');
  assert.ok(frames.some(frame => frame.download?.name === 'nota.txt'));
  const thumb = await s.command('thumb');
  assert.deepEqual([thumb.width, thumb.height], [1280, 800]); assert.equal(Buffer.from(thumb.image, 'base64').readUInt16BE(0), 0xffd8);
  // Taking it never leaves the page at another size.
  assert.deepEqual(await s.page.evaluate(() => [innerWidth, innerHeight]), [1280, 800]);
  // Tabs and history the person drives after "Assumir".
  await s.command('open', { url: 'https://example.com/#dois' });
  await s.input({ type: 'back' });
  await wait(() => frames.some(frame => frame.tabbar?.forward === true));
  await s.input({ type: 'forward' }); await wait(() => s.page.url().endsWith('#dois'));
  await s.input({ type: 'tab_new' }); await wait(() => frames.some(frame => frame.tabbar?.tabs.length === 2 && frame.tabbar.tabs[1].active));
  await s.input({ type: 'tab_close', tab: 2 }); await wait(() => frames.at(-1)?.tabbar?.tabs.length === 1 || s.tabList().length === 1);
  assert.equal(s.tabList().length, 1);
});

test('watching again a page that stopped changing shows it: the pacing timer of the old view never blocks the new one', chrome, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'mybots-rewatch-')), frames = [];
  const s = new BrowserSession(directory, { botId: randomUUID() }); s.frame = frame => { if (frame.image) frames.push(frame); };
  t.after(async () => { await s.close(); await rm(directory, { recursive: true, force: true }); });
  await s.command('open', { url: 'https://example.com/' });
  for (let round = 0; round < 3; round++) {
    const before = frames.length;
    await s.view(true, { maxWidth: 640, maxHeight: 400 });
    await wait(() => frames.length > before);
    // A frame waiting for its turn when the view stops is the case that used to leave the timer set.
    s.queueFrame(s.cdp, frames.at(-1)); s.queueFrame(s.cdp, frames.at(-1)); assert.ok(s.frameTimer); await s.view(false);
  }
});
