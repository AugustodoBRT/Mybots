import { chromium } from 'playwright-core';
import { generateKeyPairSync, randomBytes, privateDecrypt, createDecipheriv } from 'node:crypto';
import { lookup } from 'node:dns/promises';
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

export class BrowserSession {
  constructor(profile, { headless = false } = {}) { this.profile = profile; this.headless = headless; this.login = null; this.secrets = new Set(); }
  async start() {
    if (this.context) return;
    const path = join(this.profile, 'Default'); mkdirSync(path, { recursive: true, mode: 0o700 });
    let prefs = {}; try { prefs = JSON.parse(readFileSync(join(path, 'Preferences'), 'utf8')); } catch {}
    prefs.credentials_enable_service = false;
    prefs.profile = { ...prefs.profile, password_manager_enabled: false };
    writeFileSync(join(path, 'Preferences'), JSON.stringify(prefs), { mode: 0o600 });
    this.context = await chromium.launchPersistentContext(this.profile, {
      executablePath: '/usr/bin/google-chrome-stable', headless: this.headless, viewport: { width: 1280, height: 800 },
      acceptDownloads: false, serviceWorkers: 'block', permissions: [],
      args: ['--ozone-platform=wayland', '--disable-save-password-bubble', '--password-store=basic', '--disable-features=PasswordManagerOnboarding,PasswordLeakDetection', '--disable-extensions']
    });
    await this.context.clearPermissions();
    await this.context.route('**/*', async route => {
      try { await allowedUrl(route.request().url()); await route.continue(); }
      catch { await route.abort().catch(() => {}); }
    });
    this.page = this.context.pages()[0] || await this.context.newPage();
    this.context.on('page', page => { if (page !== this.page) page.close().catch(() => {}); });
    this.page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
    this.page.setDefaultTimeout(10000);
    this.page.setDefaultNavigationTimeout(30000);
    this.context.on('close', () => { this.context = null; this.page = null; this.login = null; });
  }
  async info() { return { url: this.page.url(), title: (await this.page.title()).slice(0, 200), where: 'pc' }; }
  target(id) { return this.page.locator(`[data-mybots-id="${id}"]`); }
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
    const args = ['inspect', 'login_fill', 'login_cancel', 'upload'].includes(op) ? input : toolArguments('browser.' + op, input);
    if (op === 'login_cancel') { this.login = null; return { cancelled: true }; }
    if (op === 'open') { await this.page.goto(await allowedUrl(args.url), { waitUntil: 'domcontentloaded' }); return this.info(); }
    if (op === 'read') {
      const content = await this.page.evaluate(() => {
        const visible = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        document.querySelectorAll('[data-mybots-id]').forEach(el => el.removeAttribute('data-mybots-id'));
        const elements = [...document.querySelectorAll('a[href], button, input:not([type=hidden]), textarea, select, [role=button]')].filter(visible).slice(0, 300).map((el, n) => {
          el.setAttribute('data-mybots-id', String(n + 1));
          return { id: n + 1, kind: el.type === 'password' ? 'password' : el.type === 'file' ? 'file' : el.type === 'submit' || el.tagName === 'BUTTON' && el.type !== 'button' ? 'submit' : el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.textContent || el.name || '').slice(0, 200), ...(el.tagName === 'SELECT' ? { options: [...el.options].map(o => o.text).slice(0, 50) } : {}) };
        });
        // Clone without form values; innerText on the original could expose a password textarea.
        const copy = document.body.cloneNode(true);
        copy.querySelectorAll('input, textarea, script, style, noscript').forEach(el => el.remove());
        return { text: (copy.textContent || '').replace(/\s+/g, ' ').slice(0, 20000), elements };
      });
      return { ...await this.info(), ...content };
    }
    if (op === 'inspect') return this.inspect(args.id);
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
      if (args.selector) await this.page.locator(args.selector).first().waitFor({ timeout });
      else if (args.text) await this.page.getByText(args.text, { exact: false }).first().waitFor({ timeout });
      else await this.page.waitForLoadState('domcontentloaded', { timeout });
      return this.info();
    }
    if (op === 'screenshot') return { ...await this.info(), image: (await this.page.screenshot({ type: 'jpeg', quality: 65, mask: [this.page.locator('input[type=password]'), ...[...this.secrets].map(secret => this.page.getByText(secret, { exact: false }))] })).toString('base64') };
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
  let busy = false;
  process.on('message', async ({ id, op, args }) => {
    if (busy) { process.send?.({ id, error: 'Aguarde a ação atual do navegador.' }); return; }
    busy = true;
    try { process.send?.({ id, result: await session.command(op, args) }); }
    catch { process.send?.({ id, error: 'O navegador não conseguiu executar a ação. Confira a página no Chrome e tente ler de novo; senhas só por browser_login.' }); }
    finally { busy = false; }
  });
  process.on('disconnect', () => session.close().finally(() => process.exit()));
}
