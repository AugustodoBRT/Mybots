import { chromium } from 'playwright-core';
import { generateKeyPairSync, randomBytes, privateDecrypt, createDecipheriv } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readPage, inspectPoint, markPage } from '../supervisor/browser-page.mjs';
import { safeUrl } from '../supervisor/browser.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';

// Keep password fields and their values out of reads; screenshots mask them as well.
export async function allowedUrl(value) {
  const url = new URL(safeUrl(value));
  const ips = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  for (const { address } of ips) safeUrl(`${url.protocol}//${address.includes(':') ? '[' + address + ']' : address}/`);
  return url.href;
}

export const CHROME_SETUP = 'Abra o Chrome e ligue a depuração em chrome://inspect/#remote-debugging (uma vez).';
export function chromeEndpoint(profile = join(homedir(), '.config/google-chrome')) {
  try {
    const lines = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').trim().split(/\r?\n/);
    if (lines.length !== 2 || !/^\d{1,5}$/.test(lines[0]) || Number(lines[0]) < 1 || Number(lines[0]) > 65535 || !/^\/devtools\/browser\/[a-zA-Z0-9-]{1,200}$/.test(lines[1])) throw new Error();
    return `ws://127.0.0.1:${lines[0]}${lines[1]}`;
  } catch { throw new Error(CHROME_SETUP); }
}
export async function connectMine(endpoint) {
  try { return await chromium.connectOverCDP(endpoint, { timeout: 30000, noDefaults: true }); }
  catch (error) { throw new Error(/403|denied|rejected|forbidden|1008|socket hang up|closed before the connection was established/i.test(error.message) ? 'Você recusou a conexão no Chrome.' : CHROME_SETUP); }
}

// Keys the person may press on the page from the MyBots app.
const KEYS = ['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Shift+Tab', 'Space'];

export class BrowserSession {
  // No window on the computer: the person watches and takes over inside MyBots, from the frames the page streams.
  constructor(profile, { headless = true, mode = 'own', connect } = {}) { this.profile = profile; this.mode = mode; this.connect = connect; this.headless = headless; this.login = null; this.secrets = new Set(); this.frame = null; }
  start() { if (this.context && !this.starting) return Promise.resolve(); return this.starting ||= this.launch().catch(error => { this.starting = null; throw error; }); }
  async launch() {
    if (this.mode === 'mine') {
      this.browser = await (this.connect ? this.connect() : connectMine(chromeEndpoint(this.profile)));
      this.context = this.browser.contexts()[0];
      if (!this.context) throw new Error(CHROME_SETUP);
    } else {
    const path = join(this.profile, 'Default'); mkdirSync(path, { recursive: true, mode: 0o700 });
    let prefs = {}; try { prefs = JSON.parse(readFileSync(join(path, 'Preferences'), 'utf8')); } catch {}
    prefs.credentials_enable_service = false;
    prefs.profile = { ...prefs.profile, password_manager_enabled: false };
    writeFileSync(join(path, 'Preferences'), JSON.stringify(prefs), { mode: 0o600 });
    this.context = await chromium.launchPersistentContext(this.profile, {
      executablePath: '/usr/bin/google-chrome-stable', headless: this.headless, viewport: { width: 1280, height: 800 },
      acceptDownloads: false, serviceWorkers: 'block', permissions: [],
      args: [...(this.headless ? [] : ['--ozone-platform=wayland']), '--disable-save-password-bubble', '--password-store=basic', '--disable-features=PasswordManagerOnboarding,PasswordLeakDetection', '--disable-extensions']
    });
    await this.context.clearPermissions();
    await this.context.route('**/*', route => this.route(route));
    }
    this.pages = []; this.metrics = new Map(); this.tabError = null; this.closing = false;
    const add = page => {
      if (this.pages.length >= 5) { this.tabError = 'Até 5 abas por bot. Feche uma aba antes de abrir outra.'; this.closePage(page).catch(() => {}); return; }
      this.pages.push(page);
      if (this.mode === 'mine') {
        page.on('popup', popup => { this.closePage(popup).catch(() => {}); this.tabError = 'Use browser_tabs para abrir uma nova aba com endereço conferido.'; });
      }
      page.on('domcontentloaded', () => { if (this.cdp) this.info().then(() => this.view(true)).catch(() => {}); });
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000);
      page.on('close', () => {
        this.metrics.get(page)?.detach().catch(() => {}); this.metrics.delete(page);
        this.pages = this.pages.filter(item => item !== page);
        if (!this.closing && this.page === page && this.pages.length) this.activate(this.pages[0]).catch(() => {});
      });
    };
    this.addPage = add;
    if (this.mode === 'mine') {
      this.page = await this.newPage();
    } else {
      this.context.pages().forEach(add);
      this.context.on('page', add);
      this.page = this.pages[0] || await this.context.newPage();
    }
    const closed = () => { this.context = null; this.page = null; this.login = null; this.cdp = null; this.starting = null; this.frame?.({ closed: true }); };
    if (this.mode === 'mine') { this.onDisconnect = closed; this.browser.on('disconnected', closed); } else this.context.on('close', closed);
  }
  async route(route) {
    try { await allowedUrl(route.request().url()); await route.continue(); } catch { await route.abort().catch(() => {}); }
  }
  async newPage(url) {
    if (this.closing) throw new Error('O navegador do bot foi interrompido.');
    if (this.pages.length >= 5) throw new Error('Até 5 abas por bot. Feche uma aba antes de abrir outra.');
    const safe = url ? await allowedUrl(url) : null;
    const page = await this.context.newPage();
    if (this.closing) { await this.closePage(page); throw new Error('O navegador do bot foi interrompido.'); }
    if (this.mode === 'mine') {
      this.addPage(page); await page.route('**/*', route => this.route(route));
      const metrics = await this.context.newCDPSession(page); this.metrics.set(page, metrics);
      await metrics.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await this.preparePopups(page);
    }
    if (safe) await page.goto(safe, { waitUntil: 'domcontentloaded' });
    return page;
  }
  async closePage(page) {
    if (page.isClosed()) return;
    if (this.mode !== 'mine') return page.close();
    const cdp = this.metrics.get(page) || await page.context().newCDPSession(page);
    const { targetInfo } = await cdp.send('Target.getTargetInfo');
    await cdp.send('Target.closeTarget', { targetId: targetInfo.targetId });
    await cdp.detach().catch(() => {});
  }
  async preparePopups(page) {
    // A page route cannot stop a popup's first request. Open it through the checked path instead.
    await page.exposeBinding('__mybotsOpen', async ({ frame }, url) => {
      if (frame !== page.mainFrame() || page.isClosed()) return;
      try { await this.newPage(new URL(url || 'about:blank', page.url()).href); if (this.cdp) await this.view(true); }
      catch (error) { this.tabError = /Até 5 abas/.test(error.message) ? error.message : 'Não consegui abrir a aba. Use browser_tabs com um endereço http ou https válido.'; }
    });
    await page.addInitScript(() => {
      window.open = url => { window.__mybotsOpen(String(url || '')).catch(() => {}); return null; };
      const submit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function() { this.target = '_self'; return submit.call(this); };
      document.addEventListener('submit', event => { event.target.target = '_self'; }, true);
      document.addEventListener('click', event => {
        if (event.target.closest?.('[formtarget]')) event.target.closest('[formtarget]').formTarget = '_self';
        const link = event.target.closest?.('a[target]');
        if (link && !['_self','_parent','_top',''].includes(link.target.toLowerCase())) { event.preventDefault(); window.__mybotsOpen(link.href).catch(() => {}); }
      }, true);
    });
  }
  /**
   * The live view: Chrome's screencast, about 8 frames a second at most and only when the page changes. Each frame
   * goes to `this.frame` (the node relays it to MyBots); acknowledging late is what paces Chrome.
   */
  async view(on) {
    await this.start();
    if (on && !this.cdp) {
      const cdp = this.cdp = await this.context.newCDPSession(this.page);
      cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        setTimeout(() => cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {}), 120);
        if (this.cdp === cdp) this.frame?.({ image: data, width: Math.round(metadata.deviceWidth), height: Math.round(metadata.deviceHeight), url: this.page?.url() || '', tabs: this.tabList() });
      });
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 60, maxWidth: 1280, maxHeight: 800 });
    } else if (on) {
      // Another viewer joined: the screencast only sends changes, so it gets the current page as one frame.
      const { width, height } = this.viewportSize();
      const { data } = await this.cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 60 });
      this.frame?.({ image: data, width, height, url: this.page.url(), tabs: this.tabList() });
    } else if (!on && this.cdp) {
      const cdp = this.cdp; this.cdp = null;
      await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.detach().catch(() => {});
    }
    return { watching: Boolean(this.cdp), ...await this.info() };
  }
  /** What the person does on the page in MyBots after "Assumir": points are fractions of the frame, so any screen size lands right. */
  async input(args = {}) {
    await this.start();
    const { width, height } = this.viewportSize();
    const at = (value, size) => Math.max(0, Math.min(1, Number(value) || 0)) * size;
    const delta = value => Math.max(-5000, Math.min(5000, Number(value) || 0));
    if (args.type === 'tab') return this.perform('tabs', { action: 'switch', tab: args.tab });
    if (args.type === 'tap') await this.page.mouse.click(at(args.x, width), at(args.y, height));
    else if (args.type === 'scroll') { await this.page.mouse.move(at(args.x, width), at(args.y, height)); await this.page.mouse.wheel(delta(args.dx), delta(args.dy)); }
    else if (args.type === 'text' && typeof args.text === 'string' && args.text.length <= 2000) await (args.text.length <= 200 ? this.page.keyboard.type(args.text) : this.page.keyboard.insertText(args.text));
    else if (args.type === 'key' && KEYS.includes(args.key)) await this.page.keyboard.press(args.key);
    else if (args.type === 'open' && typeof args.url === 'string' && args.url.length <= 2000) await this.page.goto(await allowedUrl(/^[a-z]+:\/\//i.test(args.url.trim()) ? args.url.trim() : 'https://' + args.url.trim()), { waitUntil: 'commit' });
    else if (args.type === 'back') await this.page.goBack({ waitUntil: 'commit' }).catch(() => {});
    else if (args.type === 'reload') await this.page.reload({ waitUntil: 'commit' }).catch(() => {});
    else throw new Error('Ação inválida.');
    return this.info();
  }
  viewportSize() { return this.page.viewportSize() || { width: 1280, height: 800 }; }
  tabList() { return (this.pages || []).map((page, n) => ({ tab: n + 1, title: this.tabTitles?.get(page) || page.url().slice(0, 100), active: page === this.page })); }
  async activate(page) {
    const watching = Boolean(this.cdp); if (watching) await this.view(false);
    this.page = page; this.login = null; this.elementFrames = null; await page.bringToFront();
    if (watching) await this.view(true);
  }
  async info() {
    if (this.pages) this.tabTitles = new Map(await Promise.all(this.pages.map(async page => [page, (await page.title().catch(() => '')).slice(0, 100)])));
    return { url: this.page.url(), title: (await this.page.title()).slice(0, 200), where: 'pc', tabs: this.tabList() }; }
  target(id) {
    const selector = `[data-mybots-id="${id}"]`;
    return (this.elementFrames?.get(id) || this.page).locator(selector);
  }
  async inspect(id) {
    const target = this.target(id);
    if (await target.count() !== 1) throw new Error('Elemento não encontrado. Use browser_read de novo.');
    return target.evaluate(el => ({ kind: el.type === 'password' ? 'password' : el.type === 'file' ? 'file' : el.type === 'submit' || el.type === 'image' || el.tagName === 'BUTTON' && el.type !== 'button' ? 'submit' : 'field', label: (el.getAttribute('aria-label') || el.textContent || el.name || '').slice(0, 200), url: location.href }));
  }
  async command(op, input = {}) {
    const result = await this.perform(op, input);
    if (op === 'login') return result; // Internal encryption material goes only to the phone's vault, never to MCP.
    const redact = value => {
      if (typeof value === 'string') { for (const secret of this.secrets) value = value.split(secret).join('[senha protegida]'); return value; }
      if (Array.isArray(value)) return value.map(redact);
      if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'image' ? item : redact(item)]));
      return value;
    };
    return redact(result);
  }
  async perform(op, input = {}) {
    if (op === 'login_cancel') { this.login = null; return { cancelled: true }; }
    await this.start();
    const { expectedTarget, ...publicInput } = input;
    const args = ['inspect', 'login_fill', 'login_cancel', 'upload'].includes(op) ? input : toolArguments('browser.' + op, publicInput);
    if (op === 'open') { await this.page.goto(await allowedUrl(args.url), { waitUntil: 'domcontentloaded' }); return this.info(); }
    if (op === 'read' || op === 'find') {
      const content = await this.page.evaluate(readPage, op === 'find' ? args : {});
      this.elementFrames = new Map();
      for (const frame of this.page.frames()) {
        if (frame.url() !== 'about:blank' && frame !== this.page.mainFrame() && new URL(frame.url()).origin !== new URL(this.page.url()).origin) continue;
        for (const id of await frame.evaluate(() => [...document.querySelectorAll('[data-mybots-id]')].map(el => Number(el.dataset.mybotsId))).catch(() => [])) this.elementFrames.set(id, frame);
      }
      return { ...await this.info(), ...content };
    }
    if (op === 'tabs') {
      if (this.tabError) { const error = this.tabError; this.tabError = null; throw new Error(error); }
      if (args.action === 'new') {
        if (this.pages.length >= 5) throw new Error('Até 5 abas por bot. Feche uma aba antes de abrir outra.');
        const url = args.url ? await allowedUrl(args.url) : null;
        const page = await this.newPage(); await this.activate(page);
        if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
      } else if (args.action === 'switch' || args.action === 'close') {
        const page = this.pages[args.tab - 1]; if (!page) throw new Error('Aba não encontrada.');
        if (args.action === 'switch') await this.activate(page);
        else {
          if (this.pages.length === 1) { await page.goto('about:blank'); this.login = null; }
          else { if (this.page === page) await this.activate(this.pages.find(item => item !== page)); await this.closePage(page); }
        }
      }
      return this.info();
    }
    if (op === 'act') {
      const target = await this.page.evaluate(inspectPoint, args);
      if (expectedTarget && ['kind','label','url'].some(key => target[key] !== expectedTarget[key])) throw new Error('O alvo mudou. Leia a página e tente de novo.');
      const mouse = this.page.mouse;
      if (args.action === 'key') await this.page.keyboard.press(args.key);
      else if (args.action === 'hover') await mouse.move(args.x, args.y);
      else if (args.action === 'scroll') { await mouse.move(args.x, args.y); await mouse.wheel(args.dx, args.dy); }
      else if (args.action === 'drag') { await mouse.move(args.x, args.y); await mouse.down(); try { await mouse.move(args.toX, args.toY, { steps: 10 }); } finally { await mouse.up(); } }
      else if (args.action === 'double_click') await mouse.dblclick(args.x, args.y);
      else await mouse.click(args.x, args.y, { button: args.action === 'right_click' ? 'right' : 'left' });
      return { ...await this.info(), target };
    }
    if (op === 'inspect') return args.action ? this.page.evaluate(inspectPoint, args) : this.inspect(args.id);
    if (op === 'click') { await this.inspect(args.id); await this.target(args.id).click({ noWaitAfter: true }); return this.info(); }
    if (op === 'type') {
      const target = this.target(args.id); const inspected = await this.inspect(args.id);
      if (inspected.kind === 'password') throw new Error('Senhas só por browser_login ou pela pessoa no Chrome.');
      if (await target.evaluate(el => el.tagName === 'SELECT')) await target.selectOption({ label: args.text });
      else await target.fill(args.text);
      if (args.submit) await target.press('Enter', { noWaitAfter: true });
      return this.info();
    }
    if (op === 'upload') {
      // File bytes were authorized on the phone; the worker never accepts a local path.
      if (!Number.isInteger(args.id) || typeof args.name !== 'string' || /[/\\\u0000]/.test(args.name) || typeof args.data !== 'string' || args.data.length > 14_000_000) throw new Error('Arquivo inválido.');
      if ((await this.inspect(args.id)).kind !== 'file') throw new Error('Escolha um campo de arquivo.');
      await this.target(args.id).setInputFiles({ name: args.name, mimeType: args.mime, buffer: Buffer.from(args.data, 'base64') });
      return { ...await this.info(), attached: args.name };
    }
    if (op === 'wait') {
      const timeout = args.timeoutSeconds * 1000;
      if (args.url) await this.page.waitForURL(url => url.href.includes(args.url), { timeout });
      else if (args.selector) await this.page.locator(args.selector).first().waitFor({ timeout });
      else if (args.text) await this.page.getByText(args.text, { exact: false }).first().waitFor({ timeout });
      else await this.page.waitForLoadState('domcontentloaded', { timeout });
      return this.info();
    }
    if (op === 'screenshot') {
      try {
        if (args.marks) { const read = await this.page.evaluate(readPage); await this.page.evaluate(markPage, read.elements); }
        return { ...await this.info(), ...this.viewportSize(), image: (await this.page.screenshot({ type: 'jpeg', quality: 65, mask: [...this.page.frames().map(frame => frame.locator('input[type=password]')), ...[...this.secrets].map(secret => this.page.getByText(secret, { exact: false }))] })).toString('base64') };
      } finally { if (args.marks) await this.page.evaluate(markPage, null).catch(() => {}); }
    }
    if (op === 'login') {
      const url = await allowedUrl(this.page.url());
      if (!url.startsWith('https://')) throw new Error('Senhas salvas só podem ser usadas em https.');
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const challenge = randomBytes(24).toString('base64url');
      this.login = { privateKey, url, challenge, until: Date.now() + 60000 };
      return { url, publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), challenge };
    }
    if (op === 'login_fill') {
      const pending = this.login; this.login = null;
      if (!pending || pending.until < Date.now() || pending.url !== this.page.url()) throw new Error('O pedido de login venceu ou a página mudou.');
      try {
        const key = privateDecrypt({ key: pending.privateKey, oaepHash: 'sha256' }, Buffer.from(args.key, 'base64'));
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(args.iv, 'base64'));
        decipher.setAAD(Buffer.from(pending.challenge)); decipher.setAuthTag(Buffer.from(args.tag, 'base64'));
        const bytes = Buffer.concat([decipher.update(Buffer.from(args.data, 'base64')), decipher.final()]);
        key.fill(0);
        const saved = JSON.parse(bytes.toString('utf8')); bytes.fill(0);
        if (saved.url !== pending.url || saved.challenge !== pending.challenge) throw new Error();
        if (typeof saved.password !== 'string' || !saved.password || saved.password.length > 500) throw new Error();
        this.secrets.add(saved.password);
        // Check URL again inside the page before handing the login to its fields.
        await this.page.evaluate(({ username, password, url }) => {
          if (location.href !== url) throw new Error();
          const pw = [...document.querySelectorAll('input[type=password]')].find(el => el.getBoundingClientRect().width > 0);
          if (!pw) throw new Error();
          const scope = pw.form || document;
          const user = [...scope.querySelectorAll('input:not([type=password]):not([type=hidden])')].filter(el => ['text','email','tel',''].includes(el.type) && el.getBoundingClientRect().width > 0).findLast(el => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
          const fill = (el, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); };
          if (user) fill(user, username); fill(pw, password);
          if (pw.form) pw.form.requestSubmit();
        }, { username: saved.username, password: saved.password, url: saved.url });
        return { filled: true, ...await this.info() };
      } catch { throw new Error('Não consegui preencher o login protegido. Confira a página de login e tente browser_login novamente.'); }
    }
    throw new Error('Comando do navegador inválido.');
  }
  async close() {
    this.login = null; this.closing = true;
    if (this.mode === 'mine') {
      if (this.onDisconnect) this.browser?.off('disconnected', this.onDisconnect);
      if (this.cdp) await this.view(false).catch(() => {});
      await Promise.all((this.pages || []).map(page => this.closePage(page).catch(() => {})));
      this.pages = []; this.page = null; this.context = null; this.starting = null;
      if (!this.connect) await this.browser?.close();
      this.frame?.({ closed: true });
    } else await this.context?.close();
  }
}

if (process.send && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mine = process.argv[3] === 'mine', sessions = new Map(), secrets = new Set(); let connection;
  const connect = () => connection ||= connectMine(process.argv[4]).then(browser => { browser.on('disconnected', () => { connection = null; }); return browser; }).catch(error => { connection = null; throw error; });
  const sessionFor = botId => {
    if (!sessions.has(botId)) {
      const session = new BrowserSession(process.argv[2], { mode: mine ? 'mine' : 'own', ...(mine ? { connect } : {}) });
      if (mine) session.secrets = secrets;
      session.frame = frame => process.send?.({ frame, botId }); sessions.set(botId, session);
    }
    return sessions.get(botId);
  };
  const commands = new Map(); const people = new Map();
  const handle = async ({ id, botId = basename(process.argv[2]), op, args }) => {
    if (!/^[0-9a-f-]{36}$/i.test(botId || '')) return;
    try {
      if (op === 'close') { await sessions.get(botId)?.close(); sessions.delete(botId); if (id) process.send?.({ id, result: { closed: true } }); return; }
      if (op === 'view' && !args?.on && !sessions.get(botId)?.cdp) { process.send?.({ id, result: { watching: false } }); return; }
      const session = sessionFor(botId);
      const result = op === 'view' ? await session.view(Boolean(args?.on)) : op === 'input' ? await session.input(args) : await session.command(op, args);
      process.send?.({ id, result });
    } catch (error) {
      process.send?.({ id, error: /Até 5 abas|Aba não encontrada|depuração|recusou a conexão|Endereço|navegador do bot|link|alvo mudou/.test(error.message) ? error.message : 'O navegador não conseguiu executar a ação. Confira a página e tente ler de novo; senhas só por browser_login.' });
    }
  };
  process.on('message', message => {
    if (message.op === 'view' || message.op === 'input' || message.op === 'close') { const pending = (people.get(message.botId) || Promise.resolve()).then(() => handle(message)); people.set(message.botId, pending); }
    // One bot's commands keep their order; bots that share this browser (Meu Chrome) do not wait for each other.
    else { const key = message.botId || ''; commands.set(key, (commands.get(key) || Promise.resolve()).then(() => handle(message))); }
  });
  const close = async () => { await Promise.all([...sessions.values()].map(session => session.close().catch(() => {}))); if (connection) await connection.then(browser => browser.close()).catch(() => {}); process.exit(); };
  process.on('disconnect', close); process.on('SIGTERM', close);
}
