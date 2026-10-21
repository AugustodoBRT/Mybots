import { chromium } from 'playwright-core';
import { generateKeyPairSync, randomBytes, privateDecrypt, createDecipheriv } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readPage, inspectPoint, markPage } from '../supervisor/browser-page.mjs';
import { safeUrl } from '../supervisor/browser.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Keep password fields and their values out of reads; screenshots mask them as well.
export async function allowedUrl(value) {
  const url = new URL(safeUrl(value));
  const ips = await lookup(url.hostname.replace(/^\[|\]$/g, ''), { all: true });
  for (const { address } of ips) safeUrl(`${url.protocol}//${address.includes(':') ? '[' + address + ']' : address}/`);
  return url.href;
}

// Keys the person may press on the page from the MyBots app.
const KEYS = ['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Shift+Tab', 'Space'];

export class BrowserSession {
  // No window on the computer: the person watches and takes over inside MyBots, from the frames the page streams.
  constructor(profile, { headless = true } = {}) { this.profile = profile; this.headless = headless; this.login = null; this.secrets = new Set(); this.frame = null; }
  start() { if (this.context && !this.starting) return Promise.resolve(); return this.starting ||= this.launch().catch(error => { this.starting = null; throw error; }); }
  async launch() {
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
    await this.context.route('**/*', async route => {
      try { await allowedUrl(route.request().url()); await route.continue(); }
      catch { await route.abort().catch(() => {}); }
    });
    this.pages = []; this.tabError = null;
    const add = page => {
      if (this.pages.length >= 5) { this.tabError = 'Até 5 abas por bot. Feche uma aba antes de abrir outra.'; page.close().catch(() => {}); return; }
      this.pages.push(page);
      page.on('domcontentloaded', () => { if (this.cdp) this.info().then(() => this.view(true)).catch(() => {}); });
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000);
      page.on('close', () => {
        this.pages = this.pages.filter(item => item !== page);
        if (this.page === page && this.pages.length) this.activate(this.pages[0]).catch(() => {});
      });
    };
    this.context.pages().forEach(add);
    this.context.on('page', add);
    this.page = this.pages[0] || await this.context.newPage();
    this.context.on('close', () => { this.context = null; this.page = null; this.login = null; this.cdp = null; this.starting = null; this.frame?.({ closed: true }); });
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
      const { width, height } = this.page.viewportSize();
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
    const { width, height } = this.page.viewportSize();
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
    await this.start();
    const { expectedTarget, ...publicInput } = input;
    const args = ['inspect', 'login_fill', 'login_cancel', 'upload'].includes(op) ? input : toolArguments('browser.' + op, publicInput);
    if (op === 'login_cancel') { this.login = null; return { cancelled: true }; }
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
        const page = await this.context.newPage(); await this.activate(page);
        if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
      } else if (args.action === 'switch' || args.action === 'close') {
        const page = this.pages[args.tab - 1]; if (!page) throw new Error('Aba não encontrada.');
        if (args.action === 'switch') await this.activate(page);
        else {
          if (this.pages.length === 1) { await page.goto('about:blank'); this.login = null; }
          else { if (this.page === page) await this.activate(this.pages.find(item => item !== page)); await page.close(); }
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
        return { ...await this.info(), ...this.page.viewportSize(), image: (await this.page.screenshot({ type: 'jpeg', quality: 65, mask: [...this.page.frames().map(frame => frame.locator('input[type=password]')), ...[...this.secrets].map(secret => this.page.getByText(secret, { exact: false }))] })).toString('base64') };
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
  async close() { this.login = null; await this.context?.close(); }
}

if (process.send && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const session = new BrowserSession(process.argv[2]);
  session.frame = frame => process.send?.({ frame });
  let busy = false, person = Promise.resolve();
  process.on('message', async ({ id, op, args }) => {
    // The live view and the person's own input run beside the bot's commands, one after another.
    if (op === 'view' || op === 'input') {
      person = person.then(() => op === 'view' ? session.view(Boolean(args?.on)) : session.input(args)).then(result => process.send?.({ id, result }),
        error => process.send?.({ id, error: /Endereço|navegador do bot|link/.test(error.message) ? error.message : 'O Chrome do bot não conseguiu fazer isso agora.' }));
      return;
    }
    if (busy) { process.send?.({ id, error: 'Aguarde a ação atual do navegador.' }); return; }
    busy = true;
    try { process.send?.({ id, result: await session.command(op, args) }); }
    catch (error) { process.send?.({ id, error: /Até 5 abas|Aba não encontrada/.test(error.message) ? error.message : 'O navegador não conseguiu executar a ação. Confira a página e tente ler de novo; senhas só por browser_login.' }); }
    finally { busy = false; }
  });
  process.on('disconnect', () => session.close().finally(() => process.exit()));
}
