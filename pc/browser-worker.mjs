import { chromium } from 'playwright-core';
import { generateKeyPairSync, randomBytes, privateDecrypt, createDecipheriv } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { readPage, inspectPoint, markPage, captchaState } from '../supervisor/browser-page.mjs';
import { viewSize } from '../supervisor/browser-frame.mjs';
import { redactCardNumbers } from '../supervisor/card-pan.mjs';
import { readCheckoutTotal } from '../supervisor/wallet-checkout.mjs';
import { safeUrl, stepCaption, BLOCKED } from '../supervisor/browser.mjs';
import { toolArguments } from '../supervisor/tool-policy.mjs';
import { mkdirSync, readFileSync, writeFileSync, existsSync, statSync, readdirSync, unlinkSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// The WebView reads the same function from this bundled asset.
export const CARD_FIELD_SOURCE = readFileSync(new URL('../mobile/modules/termux-bridge/android/src/main/assets/card-field.js', import.meta.url), 'utf8').trim();
const CARD_FILL_SOURCE = readFileSync(new URL('../mobile/modules/termux-bridge/android/src/main/assets/card-fill.js', import.meta.url), 'utf8').trim().replace('__MYBOTS_CARD_FIELD__', CARD_FIELD_SOURCE);
// Payment processors whose card frames may receive the card, besides the checkout's own site (same list as the phone).
const PROCESSORS = ['stripe.com', 'stripe.network', 'mercadopago.com', 'mercadopago.com.br', 'mercadolibre.com', 'adyen.com', 'pagseguro.uol.com.br', 'pagbank.com.br', 'paypal.com', 'braintreegateway.com', 'cielo.com.br', 'getnet.com.br', 'pagar.me', 'checkout.com', 'ebanx.com', 'iugu.com', 'vindi.com.br', 'asaas.com'];
const cardFrame = (frameUrl, pageHost) => { try { const url = new URL(frameUrl); return url.protocol === 'https:' && (url.hostname === pageHost || PROCESSORS.some(domain => url.hostname === domain || url.hostname.endsWith('.' + domain))); } catch { return frameUrl === 'about:srcdoc' || frameUrl === 'about:blank'; } };
const CARD_MARK = '[data-mybots-card]';

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

export const IMPORTED = 'mybots-imported-to-shared';
const downloadsRoot = () => process.env.MYBOTS_DOWNLOADS || join(homedir(), '.mybots-pc', 'downloads'), MAX_DOWNLOAD = 100 * 1024 * 1024;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
// A tab's icon, fetched once per address: the page's own <link rel=icon> or /favicon.ico, small raster images only.
const ICONS = new Map();
function iconData(type, body) {
  // Most .ico files carry a PNG inside; Android shows PNG everywhere.
  if (/icon/.test(type) && body.length > 6 && body.readUInt16LE(0) === 0 && body.readUInt16LE(2) === 1) {
    for (let n = 0; n < Math.min(body.readUInt16LE(4), 16); n++) {
      const entry = 6 + n * 16; if (entry + 16 > body.length) break;
      const size = body.readUInt32LE(entry + 8), offset = body.readUInt32LE(entry + 12);
      if (offset + size <= body.length && body.readUInt32BE(offset) === 0x89504e47) return 'data:image/png;base64,' + body.subarray(offset, offset + size).toString('base64');
    }
  }
  return `data:${type};base64,${body.toString('base64')}`;
}
/** A download's name inside the bot's folder: no paths, no executables, never overwriting another file. */
export function downloadName(value, folder) {
  let name = String(value || 'arquivo').replace(/[\u0000-\u001f/\\]/g, '_').replace(/^\.+/, '').trim().slice(0, 120) || 'arquivo';
  if (BLOCKED.test(name)) throw new Error('Arquivos executáveis são bloqueados.');
  const ext = extname(name), base = name.slice(0, name.length - ext.length);
  for (let n = 2; existsSync(join(folder, name)); n++) name = `${base} (${n})${ext}`;
  return name;
}
async function checkRoute(route) {
  try { await allowedUrl(route.request().url()); await route.continue(); } catch { await route.abort().catch(() => {}); }
}
// Google refuses to sign in on a browser that says it is automated ("este navegador pode não ser seguro"): no
// --enable-automation flag, no navigator.webdriver, and a user agent that is not "HeadlessChrome" (the person
// asked for this, like the embedded browsers of other agent apps).
let chromeUserAgent;
function normalUserAgent() {
  if (chromeUserAgent !== undefined) return chromeUserAgent;
  try { const major = /(\d+)\./.exec(execFileSync('/usr/bin/google-chrome-stable', ['--version'], { encoding: 'utf8', timeout: 5000 }))?.[1]; chromeUserAgent = major ? `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36` : null; } catch { chromeUserAgent = null; }
  return chromeUserAgent;
}
// A Chrome of MyBots (a separate bot's or the shared one): no window, no saved passwords, every address checked.
export async function launchContext(profile, headless = true) {
  const path = join(profile, 'Default'); mkdirSync(path, { recursive: true, mode: 0o700 });
  let prefs = {}; try { prefs = JSON.parse(readFileSync(join(path, 'Preferences'), 'utf8')); } catch {}
  prefs.credentials_enable_service = false;
  prefs.profile = { ...prefs.profile, password_manager_enabled: false };
  writeFileSync(join(path, 'Preferences'), JSON.stringify(prefs), { mode: 0o600 });
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: '/usr/bin/google-chrome-stable', headless, viewport: { width: 1280, height: 800 },
    acceptDownloads: true, serviceWorkers: 'block', permissions: [], ignoreDefaultArgs: ['--enable-automation'],
    args: [...(normalUserAgent() ? [`--user-agent=${normalUserAgent()}`] : []), '--disable-blink-features=AutomationControlled', ...(headless ? [] : ['--ozone-platform=wayland']), '--disable-save-password-bubble', '--password-store=basic', '--disable-features=PasswordManagerOnboarding,PasswordLeakDetection', '--disable-extensions']
  });
  await context.clearPermissions();
  await context.route('**/*', checkRoute);
  return context;
}
/** Copies the cookies (the logins) of a bot's pre-v58 Chrome into the shared one, once; the old profile is kept. */
export async function importLogins(context, profile) {
  if (existsSync(join(profile, IMPORTED)) || !existsSync(join(profile, 'Default'))) return 0;
  const old = await launchContext(profile);
  try {
    const cookies = await old.cookies();
    if (cookies.length) await context.addCookies(cookies);
    writeFileSync(join(profile, IMPORTED), new Date().toISOString(), { mode: 0o600 });
    return cookies.length;
  } finally { await old.close().catch(() => {}); }
}

// The same vendors as captchaState (which runs inside the page and cannot share code).
function challengeFrame(value) {
  try { const url = new URL(value), host = url.hostname; return host === 'challenges.cloudflare.com' || (host === 'google.com' || host.endsWith('.google.com')) && url.pathname.includes('/recaptcha/') || host === 'hcaptcha.com' || host.endsWith('.hcaptcha.com'); } catch { return false; }
}

// Keys the person may press on the page from the MyBots app.
const KEYS = ['Enter', 'Tab', 'Backspace', 'Delete', 'Escape', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown', 'Shift+Tab', 'Space'];

export class BrowserSession {
  // No window on the computer: the person watches and takes over inside MyBots, from the frames the page streams.
  constructor(profile, { headless = true, mode = 'own', connect, botId = basename(profile) } = {}) { this.profile = profile; this.mode = mode; this.botId = botId; this.downloadSerial = 0; this.connect = connect; this.headless = headless; this.login = null; this.payment = null; this.secrets = new Set(); this.cardSecrets = new Set(); this.frame = null; this.seq = 0; this.devices = new Map(); this.device = null;
    try { this.siteViews = JSON.parse(readFileSync(join(profile, 'site-views.json'), 'utf8')); } catch { this.siteViews = {}; }
    this.autoReturn = this.siteViews.__autoReturn === true;
  }
  start() { if (this.context && !this.starting) return Promise.resolve(); return this.starting ||= this.launch().catch(error => { this.starting = null; throw error; }); }
  async launch() {
    if (this.mode === 'mine') {
      this.browser = await (this.connect ? this.connect() : connectMine(chromeEndpoint(this.profile)));
      this.context = this.browser.contexts()[0];
      if (!this.context) throw new Error(CHROME_SETUP);
    } else if (this.mode === 'shared') this.context = await this.connect();
    else this.context = await launchContext(this.profile, this.headless);
    this.pages = []; this.metrics = new Map(); this.tabError = null; this.closing = false;
    const add = page => {
      if (this.pages.length >= 5) { this.tabError = 'Até 5 abas por bot. Feche uma aba antes de abrir outra.'; this.closePage(page).catch(() => {}); return; }
      this.pages.push(page); this.observe(page).catch(() => {});
      if (this.mode === 'mine') {
        page.on('popup', popup => { this.closePage(popup).catch(() => {}); this.tabError = 'Use browser_tabs para abrir uma nova aba com endereço conferido.'; });
      }
      // In the shared Chrome a popup belongs to the bot whose page opened it (the context's route checks its address).
      if (this.mode === 'shared') page.on('popup', add);
      if (this.mode !== 'mine') page.on('download', download => this.saveDownload(download));
      page.on('request', request => { if (request.isNavigationRequest() && request.frame() === page.mainFrame()) (this.cdp || this.device) && this.emitFrame({ loading: true }); });
      page.on('domcontentloaded', () => { if (this.cdp || this.device) this.emitFrame({ loading: false }); if (this.device && page === this.page) this.deviceView(this.device).catch(() => {}); if (this.cdp) this.info().then(() => this.view(true)).catch(() => {}); });
      page.on('dialog', dialog => dialog.dismiss().catch(() => {}));
      page.on('framenavigated', frame => { if (frame === page.mainFrame() && page === this.page) this.syncCardSite(); if (frame === page.mainFrame()) this.tabBar().catch(() => {}); if (this.cdp && page === this.page) this.maskFields().catch(() => {}); });
      page.setDefaultTimeout(10000); page.setDefaultNavigationTimeout(30000);
      page.on('close', () => {
        this.metrics.get(page)?.detach().catch(() => {}); this.metrics.delete(page);
        this.pages = this.pages.filter(item => item !== page);
        if (!this.closing && this.page === page && this.pages.length) this.activate(this.pages[0]).catch(() => {});
      });
    };
    this.addPage = add;
    if (this.mode === 'mine' || this.mode === 'shared') {
      this.page = await this.newPage();
    } else {
      this.context.pages().forEach(add);
      this.context.on('page', add);
      this.page = this.pages[0] || await this.context.newPage();
    }
    await Promise.all(this.pages.map(page => this.observe(page)));
    const closed = () => { this.context = null; this.page = null; this.login = null; this.cdp = null; this.starting = null; this.emitFrame({ closed: true }); };
    this.onDisconnect = closed;
    if (this.mode === 'mine') this.browser.on('disconnected', closed); else this.context.on('close', closed);
  }
  route(route) { return checkRoute(route); }
  async newPage(url) {
    if (this.closing) throw new Error('O navegador do bot foi interrompido.');
    if (this.pages.length >= 5) throw new Error('Até 5 abas por bot. Feche uma aba antes de abrir outra.');
    const safe = url ? await allowedUrl(url) : null;
    const page = await this.context.newPage();
    if (this.closing) { await this.closePage(page); throw new Error('O navegador do bot foi interrompido.'); }
    if (this.mode === 'shared') this.addPage(page);
    if (this.mode === 'mine') {
      this.addPage(page); await page.route('**/*', route => this.route(route));
      const metrics = await this.context.newCDPSession(page); this.metrics.set(page, metrics);
      await metrics.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await this.preparePopups(page);
    }
    await this.observe(page);
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
  // Keep view changes in order, including navigation, resizing and congestion updates.
  view(on, options) {
    const work = (this.viewing || Promise.resolve()).catch(() => {}).then(() => this.setView(on, options));
    this.viewing = work; return work;
  }
  async setView(on, options) {
    await this.start();
    // The person opening the browser from the window does not depend on a bot: an empty browser starts on a search page.
    if (on && options?.home && !this.opened && this.page.url() === 'about:blank') { this.opened = true; this.page.goto('https://www.google.com/', { timeout: 15000 }).catch(() => {}); }
    const wanted = { ...this.viewOptions, ...options }; Object.assign(wanted, viewSize(wanted));
    wanted.interactive = Boolean(wanted.interactive); wanted.congested = Boolean(wanted.congested);
    const changed = !this.viewOptions || ['maxWidth','maxHeight','interactive','congested'].some(key => wanted[key] !== this.viewOptions[key]);
    this.viewOptions = wanted;
    if ((!on || changed) && this.cdp) {
      const cdp = this.cdp; this.cdp = null; clearTimeout(this.frameTimer); this.frameTimer = null; this.pendingFrame = null;
      await cdp.send('Page.stopScreencast').catch(() => {}); await cdp.detach().catch(() => {});
    }
    if (on && !this.pageTimer) this.pageTimer = setInterval(() => this.checkChallenge().catch(() => {}), 500);
    if (!on) { clearInterval(this.pageTimer); this.pageTimer = null; }
    if (on) await this.maskFields();
    const quality = (wanted.interactive ? 70 : 55) - (wanted.congested ? 20 : 0);
    if (on && !this.cdp) {
      const cdp = this.cdp = await this.context.newCDPSession(this.page);
      this.lastFrameAt = 0;
      cdp.on('Page.screencastFrame', ({ data, metadata, sessionId }) => {
        const ack = () => cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => {});
        if (wanted.interactive) ack(); else setTimeout(ack, 200);
        if (this.cdp !== cdp) return;
        const scale = Math.min(1, wanted.maxWidth / metadata.deviceWidth, wanted.maxHeight / metadata.deviceHeight);
        this.queueFrame(cdp, { image: Buffer.from(data, 'base64'), width: Math.max(1, Math.round(metadata.deviceWidth * scale)), height: Math.max(1, Math.round(metadata.deviceHeight * scale)) });
      });
      const before = this.seq;
      await cdp.send('Page.startScreencast', { format: 'jpeg', quality, maxWidth: wanted.maxWidth, maxHeight: wanted.maxHeight });
      // A screencast of a still page may send nothing: then the viewer gets a picture of it, taken apart from the screencast.
      await sleep(400);
      if (this.cdp === cdp && this.seq === before && !this.pendingFrame) {
        try {
          const shot = await this.context.newCDPSession(this.page);
          try { const picture = await this.picture(shot, quality); if (this.cdp === cdp && this.seq === before) this.queueFrame(cdp, picture); }
          finally { await shot.detach().catch(() => {}); }
        } catch {}
      }
    } else if (on) {
      // A new viewer gets the current page even when it has stopped changing.
      const cdp = this.cdp, picture = await this.picture(cdp, quality);
      if (this.cdp === cdp) this.queueFrame(cdp, picture);
    }
    return { watching: Boolean(this.cdp), ...await this.info() };
  }
  // The page as it is now, at its own size. A scaled clip makes Chrome resize the page for the capture, and with other
  // sessions changing the tab's size (takeover, another bot) the page could stay at the picture's size.
  async picture(cdp, quality) {
    const { width, height } = this.viewportSize(), { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality });
    return { image: Buffer.from(data, 'base64'), width, height };
  }
  // Pictures of the page (live view, timeline) hide password, code and card fields.
  async maskFields() {
    for (const frame of this.page.frames()) await frame.evaluate(source => {
      const cardField = (0, eval)(`(${source})`);
      const mark = () => {
        for (const el of document.querySelectorAll('input,textarea,select')) {
          if (cardField(el)) { if (!el.hasAttribute('data-mybots-card')) el.setAttribute('data-mybots-card', ''); } else if (el.hasAttribute('data-mybots-card')) el.removeAttribute('data-mybots-card');
        }
      };
      let style = document.querySelector('style[data-mybots-live-mask]');
      if (!style) { style = document.createElement('style'); style.setAttribute('data-mybots-live-mask', ''); document.documentElement.append(style); }
      style.textContent = 'input[type=password],input[autocomplete=one-time-code] { -webkit-text-security:disc!important; text-shadow:none!important; } [data-mybots-card] { color:transparent!important; background:#000!important; text-shadow:none!important; caret-color:transparent!important; }';
      mark();
      if (!document.__mybotsCardObserver) {
        document.__mybotsCardObserver = new MutationObserver(mark);
        document.__mybotsCardObserver.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['autocomplete', 'name', 'id', 'aria-label', 'placeholder'] });
      }
    }, CARD_FIELD_SOURCE).catch(() => {});
  }
  syncCardSite() {
    let site; try { site = new URL(this.page.url()).origin; } catch { site = ''; }
    if (this.cardSite !== site) { this.cardSecrets.clear(); this.cardSite = site; }
  }
  async rememberCards() {
    this.syncCardSite();
    for (const frame of this.page.frames()) {
      const values = await frame.locator('input,textarea,select').evaluateAll((els, source) => {
        const cardField = (0, eval)(`(${source})`);
        return els.map(el => [cardField(el), String(el.value || '')]).filter(([kind, value]) => kind && (kind === 'number' ? value.replace(/\D/g, '').length >= 12 : value.length >= 3)).map(([, value]) => value);
      }, CARD_FIELD_SOURCE).catch(() => []);
      for (const value of values) this.cardSecrets.add(value);
    }
  }
  // Read and redact within one browser task, so a changing field cannot slip between reading and collecting its value.
  async pageData(fn, args) {
    return this.page.evaluate(({ source, input, cardSource, panSource }) => {
      const redactCardNumbers = (0, eval)(`(${panSource})`), cardField = (0, eval)(`(${cardSource})`);
      const values = new Set(), protectedIds = new Set();
      const collect = doc => {
        for (const el of doc.querySelectorAll('input,textarea,select')) {
          const kind = cardField(el), value = String(el.value || '');
          if (!kind) continue;
          if (kind === 'number' ? value.replace(/\D/g, '').length >= 12 : value.length >= 3) values.add(value);
          if (el.dataset.mybotsId) protectedIds.add(Number(el.dataset.mybotsId));
        }
        for (const frame of doc.querySelectorAll('iframe')) try { if (frame.contentDocument) collect(frame.contentDocument); } catch {}
      };
      collect(document);
      const result = (0, eval)(`(${source})`)(input);
      collect(document);
      const hide = value => {
        if (typeof value === 'string') {
          for (const secret of values) value = value.split(secret).join('[cartão protegido]');
          return redactCardNumbers(value);
        }
        if (Array.isArray(value)) return value.map(hide);
        if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'label' && protectedIds.has(value.id) ? 'Campo de cartão' : hide(item)]));
        return value;
      };
      return hide(result);
    }, { source: fn.toString(), input: args, cardSource: CARD_FIELD_SOURCE, panSource: redactCardNumbers.toString() });
  }
  /** Where the bot is about to act, for the person watching: a cursor, the element's outline and a caption. */
  async showAction(op, args, target, rect, point) {
    if (!this.cdp && !this.device) return;
    const { width, height } = this.viewportSize();
    this.emitFrame({ action: { caption: stepCaption(op, args, target), rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null, point: point || (rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null), width, height, at: Date.now() } });
    // A moment for the eye to follow the cursor before the page changes.
    await sleep(350);
  }
  saveDownload(download) {
    this.downloadSerial++;
    this.downloading = (async () => {
      const folder = join(downloadsRoot(), this.botId); mkdirSync(folder, { recursive: true, mode: 0o700 });
      let name;
      try { name = downloadName(download.suggestedFilename(), folder); } catch (error) { await download.cancel().catch(() => {}); throw error; }
      await download.saveAs(join(folder, name));
      const size = statSync(join(folder, name)).size;
      if (size > MAX_DOWNLOAD) { unlinkSync(join(folder, name)); throw new Error('O arquivo passa de 100 MB.'); }
      const file = { name, size, at: new Date().toISOString(), where: 'pc' };
      this.emitFrame({ download: file }); return file;
    })().catch(error => ({ error: /executáveis|100 MB/.test(error.message) ? error.message : 'O download falhou.' }));
    return this.downloading;
  }
  // A download starts a moment after the click; when one starts, wait for it (up to 90 s) and report the saved file.
  async awaitDownload(before) {
    for (let start = Date.now(); this.downloadSerial === before && Date.now() - start < 1500;) await sleep(100);
    if (this.downloadSerial === before) return null;
    let timer;
    const late = new Promise(resolve => { timer = setTimeout(() => resolve({ error: 'O download ainda não terminou.' }), 90000); timer.unref(); });
    try { return await Promise.race([this.downloading, late]); } finally { clearTimeout(timer); }
  }
  withDownload(result, file) { return file ? { ...result, download: file, ...(file.error ? {} : { next: 'O arquivo foi salvo nos downloads deste bot no computador. A pessoa pode abri-lo ou enviá-lo a você pela lista de downloads do navegador.' }) } : result; }
  queueFrame(cdp, frame) {
    this.pendingFrame = frame;
    if (this.frameTimer) return;
    const flush = () => {
      this.frameTimer = null;
      if (this.cdp !== cdp || !this.pendingFrame) return;
      const next = this.pendingFrame; this.pendingFrame = null; this.lastFrameAt = Date.now();
      if (Date.now() - (this.lastInfoAt || 0) >= 500) { this.lastInfoAt = Date.now(); this.info().catch(() => {}); }
      this.emitFrame({ ...next, seq: ++this.seq, url: this.page?.url() || '', title: this.tabTitles?.get(this.page) || '', tabs: this.tabList() });
    };
    const delay = Math.max(0, Math.ceil(1000 / (this.viewOptions.interactive ? 15 : 5)) - (Date.now() - this.lastFrameAt));
    if (delay) this.frameTimer = setTimeout(flush, delay); else flush();
  }
  async checkChallenge() {
    if (!this.page || this.checkingChallenge) return;
    this.checkingChallenge = true;
    try {
      const state = await this.page.evaluate(captchaState, { reveal: Boolean(this.viewOptions?.interactive) });
      // Cloudflare's interstitial keeps Turnstile in a closed shadow root, out of the page's reach: Chrome's frame list still has it.
      if (!state.present) for (const frame of this.page.frames()) {
        if (frame === this.page.mainFrame() || !challengeFrame(frame.url())) continue;
        const element = await frame.frameElement().catch(() => null);
        if (this.viewOptions?.interactive && this.revealedChallenge !== this.page.url()) { this.revealedChallenge = this.page.url(); await element?.scrollIntoViewIfNeeded().catch(() => {}); }
        const box = await element?.boundingBox().catch(() => null);
        if (box?.width > 0 && box.height > 0) { state.present = true; state.rect = { x: box.x, y: box.y, width: box.width, height: box.height }; break; }
      }
      // reCAPTCHA opens its image challenge beside the checkbox, out of a phone-wide page: the tab turns desktop
      // while it is open (not saved as the site's choice) and back to the phone when it closes.
      const r = state.rect, area = r ? r.width * r.height : 0, origin = new URL(this.page.url()).origin;
      if (this.device && !this.desktop && r && (r.x < -1 || r.x + r.width > this.device.width + 1)) { this.challengeDesktop = { origin, area }; await this.deviceView(this.device); return; }
      if (this.challengeDesktop && (this.challengeDesktop.origin !== origin || state.solved || area < this.challengeDesktop.area / 2)) { this.challengeDesktop = null; if (this.device) { await this.deviceView(this.device); return; } }
      for (const frame of this.page.frames()) if (frame !== this.page.mainFrame()) { const child = await frame.evaluate(captchaState).catch(() => null); if (child?.solved) state.solved = true; }
      // A challenge that vanished counts as solved only on the page that showed it, not after leaving that page.
      if (this.challengeSeen && this.challengeSeen !== this.page.url()) this.challengeSeen = null;
      const captcha = { ...state, solved: state.solved || !!this.challengeSeen && !state.present, width: this.viewportSize().width, height: this.viewportSize().height, autoReturn: this.autoReturn };
      if (state.present) this.challengeSeen = this.page.url();
      const signature = JSON.stringify(captcha);
      if (signature !== this.lastChallenge) { this.lastChallenge = signature; this.emitFrame({ captcha }); }
    } finally { this.checkingChallenge = false; }
  }
  redact(value) {
    // Fragments shorter than 4 characters would replace ordinary letters all over URLs, titles and reads.
    if (typeof value === 'string') {
      for (const secret of this.secrets) if (secret.length >= 4) value = value.split(secret).join('[senha protegida]');
      for (const secret of this.cardSecrets) value = value.split(secret).join('[cartão protegido]');
      return redactCardNumbers(value);
    }
    if (Array.isArray(value)) return value.map(item => this.redact(item));
    if (value && typeof value === 'object' && !Buffer.isBuffer(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ['image','inputKey'].includes(key) ? item : this.redact(item)]));
    return value;
  }
  emitFrame(frame) { this.frame?.(this.redact(frame)); }
  observe(page) {
    if (page.__mybotsObservation) return page.__mybotsObservation;
    return page.__mybotsObservation = (async () => {
      await page.exposeBinding('__mybotsFocus', async ({ frame }) => {
        if (page !== this.page || !this.device || page.isClosed()) return;
        const focus = await frame.evaluate(source => {
          const el = document.activeElement;
          const active = !!el && (['INPUT','TEXTAREA'].includes(el.tagName) || el.isContentEditable) && !el.disabled && !el.readOnly;
          const secret = active && (el.type === 'password' || el.autocomplete === 'one-time-code' || /otp|token|codigo|código|verification/i.test(el.name + ' ' + el.id + ' ' + el.autocomplete + ' ' + el.getAttribute('aria-label')) || !!(0, eval)(`(${source})`)(el));
          const r = active ? el.getBoundingClientRect() : null;
          return { active, type: active ? el.type || 'text' : '', secret: !!secret, rect: r ? { x:r.x,y:r.y,width:r.width,height:r.height } : null };
        }, CARD_FIELD_SOURCE).catch(() => ({ active: false, secret: false }));
        if (frame !== page.mainFrame() && focus.rect) { const box = await (await frame.frameElement()).boundingBox().catch(() => null); if (box) { focus.rect.x += box.x; focus.rect.y += box.y; } }
        this.focus = focus; this.emitFrame({ focus });
      });
      const script = () => {
        if (window.__mybotsNotify) document.removeEventListener('focusin', window.__mybotsNotify, true);
        const notify = window.__mybotsNotify = () => window.__mybotsFocus().catch(() => {});
        document.addEventListener('focusin', notify, true);
        document.addEventListener('focusout', () => setTimeout(notify, 0), true);
      };
      await page.addInitScript(script); page.on('domcontentloaded', () => page.evaluate(script).catch(() => {})); await page.evaluate(script).catch(() => {});
    })();
  }
  async protectedEdit(args) {
    if (!this.inputKeys || !this.device) throw new Error('Assuma o navegador de novo.');
    try {
      const key = privateDecrypt({ key: this.inputKeys.privateKey, oaepHash: 'sha256' }, Buffer.from(args.key, 'base64'));
      const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(args.iv, 'base64'));
      decipher.setAuthTag(Buffer.from(args.tag, 'base64')); decipher.setAAD(Buffer.from('mybots-input'));
      const bytes = Buffer.concat([decipher.update(Buffer.from(args.data, 'base64')), decipher.final()]); key.fill(0);
      const edit = JSON.parse(bytes.toString('utf8')); bytes.fill(0);
      if (!Number.isInteger(edit.delete) || edit.delete < 0 || edit.delete > 2000 || typeof edit.text !== 'string' || edit.text.length > 2000) throw new Error();
      const sensitive = await this.sensitiveFocus() || this.focus?.secret || edit.secret;
      // A pasted chunk is retained before touching the page; typed letters are covered by the field's whole value below.
      if (sensitive && edit.text.length >= 4) this.secrets.add(edit.text);
      for (let i = 0; i < edit.delete; i++) await this.page.keyboard.press('Backspace');
      if (edit.text) await this.page.keyboard.insertText(edit.text);
      if (sensitive) await this.rememberField();
      return { sent: true };
    } catch { throw new Error('Não consegui digitar no campo protegido.'); }
  }
  sensitiveFocus() {
    return this.page.evaluate(() => { let el = document.activeElement; while (el?.tagName === 'IFRAME') { try { el = el.contentDocument.activeElement; } catch { return true; } } return el?.type === 'password' || el?.autocomplete === 'one-time-code'; });
  }
  /** The private field's current value replaces the one kept while it was being typed ("S", "Se"… never pile up). */
  async rememberField() {
    for (const frame of this.page.frames()) {
      const value = await frame.evaluate(() => { const el = document.activeElement; return ['INPUT','TEXTAREA'].includes(el?.tagName) ? el.value : ''; }).catch(() => '');
      if (!value) continue;
      if (this.typedSecret && (value.startsWith(this.typedSecret) || this.typedSecret.startsWith(value))) this.secrets.delete(this.typedSecret);
      this.secrets.add(value); this.typedSecret = value;
    }
  }
  async deviceView(args) {
    if (!this.page) return;
    const page = this.page;
    let saved = this.devices.get(page);
    if (!saved && !args.restore) {
      const cdp = await this.context.newCDPSession(page);
      const original = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, deviceScaleFactor: devicePixelRatio, mobile: false }));
      saved = { cdp, original }; this.devices.set(page, saved);
    }
    if (args.restore) {
      this.device = null; this.fit = false;
      for (const [tab, state] of this.devices) {
        if (!tab.isClosed()) {
          await state.cdp.send('Emulation.setDeviceMetricsOverride', this.mode === 'mine' ? state.original : { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
          await state.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false });
        }
      }
      return;
    }
    const origin = new URL(page.url()).origin;
    if (typeof args.desktop === 'boolean') {
      this.siteViews[origin] = args.desktop;
      mkdirSync(this.profile, { recursive: true, mode: 0o700 });
      writeFileSync(join(this.profile, 'site-views.json'), JSON.stringify(this.siteViews), { mode: 0o600 });
    }
    this.inputKeys ||= generateKeyPairSync('rsa', { modulusLength: 2048 });
    this.device = { width: args.width, height: args.height, deviceScaleFactor: args.deviceScaleFactor };
    // The computer's window sizes the page to its own area as a normal desktop browser (no phone emulation, no fixed 1280x800).
    this.fit = args.fit === true;
    this.desktop = this.fit || this.siteViews[origin] === true || this.challengeDesktop?.origin === origin;
    const metrics = this.fit ? { width: args.width, height: args.height, deviceScaleFactor: 1, mobile: false } : this.desktop ? { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false } : { ...this.device, mobile: true };
    await saved.cdp.send('Emulation.setDeviceMetricsOverride', metrics);
    await saved.cdp.send('Emulation.setTouchEmulationEnabled', { enabled: !this.desktop, maxTouchPoints: 5 });
    this.emitFrame({ desktop: this.desktop, viewport: metrics, inputKey: this.inputKeys.publicKey.export({ type: 'spki', format: 'der' }).toString('base64') });
    await this.page.evaluate(() => window.__mybotsFocus?.()).catch(() => {}); this.lastChallenge = null; await this.checkChallenge();
  }
  /** What the person does on the page in MyBots after "Assumir": points are fractions of the frame, so any screen size lands right. */
  async input(args = {}) {
    await this.start();
    const { width, height } = this.viewportSize();
    const at = (value, size) => Math.max(0, Math.min(1, Number(value) || 0)) * size;
    const delta = value => Math.max(-5000, Math.min(5000, Number(value) || 0));
    if (args.type === 'captcha') { this.autoReturn = args.autoReturn; this.siteViews.__autoReturn = args.autoReturn; mkdirSync(this.profile, { recursive:true,mode:0o700 }); writeFileSync(join(this.profile, 'site-views.json'), JSON.stringify(this.siteViews), { mode:0o600 }); await this.checkChallenge(); return { sent:true }; }
    if (args.type === 'encrypted') return this.protectedEdit(args);
    if (args.type === 'touch') {
      const cdp = this.devices.get(this.page)?.cdp || this.cdp; if (!cdp || this.desktop) throw new Error('Ative o modo celular.');
      await cdp.send('Input.dispatchTouchEvent', { type: args.phase, touchPoints: args.points.map(p => ({ x: p.x * width, y: p.y * height, id: p.id, radiusX: 1, radiusY: 1, force: 1 })) }); return { sent: true };
    }
    if (args.type === 'viewport') { await this.deviceView(args); return { sent: true }; }
    if (args.type === 'tab') return this.perform('tabs', { action: 'switch', tab: args.tab });
    if (args.type === 'tab_close') return this.perform('tabs', { action: 'close', tab: args.tab });
    if (args.type === 'tab_new') { if (this.pages.length >= 5) throw new Error('Até 5 abas por bot. Feche uma aba antes de abrir outra.'); await this.activate(await this.newPage()); return { sent: true }; }
    if (args.type === 'forward') { await this.page.goForward({ waitUntil: 'commit' }).catch(() => {}); return { sent: true }; }
    if (args.type === 'tap') await this.page.mouse.click(at(args.x, width), at(args.y, height));
    else if (args.type === 'scroll') { await this.page.mouse.move(at(args.x, width), at(args.y, height)); await this.page.mouse.wheel(delta(args.dx), delta(args.dy)); }
    else if (args.type === 'text' && typeof args.text === 'string' && args.text.length <= 2000) { const sensitive = await this.sensitiveFocus(); await this.page.keyboard.insertText(args.text); if (sensitive) await this.rememberField(); }
    else if (args.type === 'key' && KEYS.includes(args.key)) await this.page.keyboard.press(args.key);
    else if (args.type === 'open' && typeof args.url === 'string' && args.url.length <= 2000) await this.page.goto(await allowedUrl(/^[a-z]+:\/\//i.test(args.url.trim()) ? args.url.trim() : 'https://' + args.url.trim()), { waitUntil: 'commit' });
    else if (args.type === 'back') await this.page.goBack({ waitUntil: 'commit' }).catch(() => {});
    else if (args.type === 'reload') await this.page.reload({ waitUntil: 'commit' }).catch(() => {});
    else throw new Error('Ação inválida.');
    return { sent: true };
  }
  viewportSize() { return this.device ? (this.fit ? { width: this.device.width, height: this.device.height } : this.desktop ? { width: 1280, height: 800 } : this.device) : this.page.viewportSize() || { width: 1280, height: 800 }; }
  tabList() { return (this.pages || []).map((page, n) => ({ tab: n + 1, title: this.tabTitles?.get(page) || page.url().slice(0, 100), active: page === this.page })); }
  async activate(page) {
    const watching = Boolean(this.cdp); if (watching) await this.view(false);
    this.page = page; if (this.device) await this.deviceView({ ...this.device, fit: this.fit }); this.login = null; this.elementFrames = null; await page.bringToFront();
    if (watching) await this.view(true);
  }
  async info() {
    if (this.pages) this.tabTitles = new Map(await Promise.all(this.pages.map(async page => [page, (await page.title().catch(() => '')).slice(0, 100)])));
    this.tabBar().catch(() => {});
    return { url: this.page.url(), title: (await this.page.title()).slice(0, 200), where: 'pc', tabs: this.tabList() }; }
  /** The tab strip of the live view: icon, title and address of each tab, and whether back and forward go anywhere. */
  async tabBar() {
    if (!this.pages || !(this.cdp || this.device)) return;
    const page = this.page, cdp = this.history?.page === page && !page.isClosed() ? this.history.cdp : null;
    if (!cdp) { await this.history?.cdp.detach().catch(() => {}); this.history = { page, cdp: await this.context.newCDPSession(page) }; return this.tabBar(); }
    const { currentIndex, entries } = await cdp.send('Page.getNavigationHistory');
    const tabs = await Promise.all(this.pages.map(async (tab, n) => ({ tab: n + 1, title: this.tabTitles?.get(tab) || '', url: tab.url().slice(0, 500), active: tab === page, icon: await this.icon(tab) })));
    const bar = { tabs, back: currentIndex > 0, forward: currentIndex < entries.length - 1 }, signature = JSON.stringify(bar);
    if (signature !== this.lastBar) { this.lastBar = signature; this.emitFrame({ tabbar: bar }); }
  }
  async icon(page) {
    const href = await page.evaluate(() => { const link = [...document.querySelectorAll('link[rel~="icon"],link[rel="shortcut icon"]')].find(item => item.href && !/svg/i.test(item.type + item.href)); return link?.href || (/^https?:/.test(location.protocol) ? location.origin + '/favicon.ico' : ''); }).catch(() => '');
    if (!href || href.length > 2000) return '';
    if (ICONS.size > 300) ICONS.clear();
    if (!ICONS.has(href)) {
      ICONS.set(href, '');
      (async () => {
        if (/^data:image\/(png|jpeg|gif|webp|x-icon)/.test(href)) { if (href.length < 22000) ICONS.set(href, href); return; }
        // Checked like any page address, and no redirects: an icon can never reach this computer's own services.
        const response = await this.context.request.get(await allowedUrl(href), { timeout: 5000, maxRedirects: 0 });
        const type = (response.headers()['content-type'] || '').split(';')[0].trim().toLowerCase(), body = await response.body();
        if (response.ok() && /^image\/(png|jpeg|gif|webp|x-icon|vnd\.microsoft\.icon)$/.test(type) && body.length < 16000) { ICONS.set(href, iconData(type, body)); this.lastBar = null; this.tabBar().catch(() => {}); }
      })().catch(() => {});
    }
    return ICONS.get(href);
  }
  target(id) {
    const selector = `[data-mybots-id="${id}"]`;
    return (this.elementFrames?.get(id) || this.page).locator(selector);
  }
  async inspect(id) {
    const target = this.target(id);
    if (await target.count() !== 1) throw new Error('Elemento não encontrado. Use browser_read de novo.');
    return target.evaluate((el, source) => ({ kind: el.type === 'password' ? 'password' : el.type === 'file' ? 'file' : el.type === 'submit' || el.type === 'image' || el.tagName === 'BUTTON' && el.type !== 'button' ? 'submit' : 'field', label: (0, eval)(`(${source})`)(el) ? 'Campo de cartão' : (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.placeholder || el.textContent || el.name || '').replace(/\s+/g, ' ').trim().slice(0, 200), url: location.href }), CARD_FIELD_SOURCE);
  }
  async command(op, input = {}) {
    if (this.page && op !== 'login' && op !== 'pay') await this.rememberCards();
    const result = await this.perform(op, input);
    if (op === 'login' || op === 'pay') return result; // Internal encryption material goes only to the phone's vault, never to MCP.
    return this.redact(result);
  }

  async perform(op, input = {}) {
    if (op === 'login_cancel') { this.login = null; this.payment = null; return { cancelled: true }; }
    if (op === 'pay_clear') { this.payment = null; if (this.page) await this.fillCard({ clear: true }).catch(() => {}); return { cleared: true }; }
    await this.start();
    const { expectedTarget, ...publicInput } = input;
    const args = ['inspect', 'login_fill', 'login_cancel', 'pay', 'pay_fill', 'pay_clear', 'upload', 'thumb'].includes(op) ? input : toolArguments('browser.' + op, publicInput);
    if (op === 'thumb') {
      // The timeline's picture of this moment, with password fields as dots.
      await this.maskFields();
      const cdp = await this.context.newCDPSession(this.page);
      try { const { image, width, height } = await this.picture(cdp, 40); return { image: image.toString('base64'), width, height }; }
      finally { await cdp.detach().catch(() => {}); }
    }
    if (op === 'open') {
      const safe = await allowedUrl(args.url), before = this.downloadSerial;
      await this.showAction('open', args);
      // A link straight to a file starts a download instead of a page.
      try { await this.page.goto(safe, { waitUntil: 'domcontentloaded' }); } catch (error) { if (!/Download is starting/i.test(error.message)) throw error; }
      return this.withDownload(await this.info(), await this.awaitDownload(before));
    }
    if (op === 'read' || op === 'find') {
      const content = await this.pageData(readPage, op === 'find' ? args : {});
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
      const target = await this.pageData(inspectPoint, args);
      if (expectedTarget && ['kind','label','url'].some(key => target[key] !== expectedTarget[key])) throw new Error('O alvo mudou. Leia a página e tente de novo.');
      const mouse = this.page.mouse, before = this.downloadSerial;
      await this.showAction('act', args, target, target.rect, ['key','scroll'].includes(args.action) ? null : { x: args.x, y: args.y });
      if (args.action === 'key') await this.page.keyboard.press(args.key);
      else if (args.action === 'hover') await mouse.move(args.x, args.y);
      else if (args.action === 'scroll') { await mouse.move(args.x, args.y); await mouse.wheel(args.dx, args.dy); }
      else if (args.action === 'drag') { await mouse.move(args.x, args.y); await mouse.down(); try { await mouse.move(args.toX, args.toY, { steps: 10 }); } finally { await mouse.up(); } }
      else if (args.action === 'double_click') await mouse.dblclick(args.x, args.y);
      else await mouse.click(args.x, args.y, { button: args.action === 'right_click' ? 'right' : 'left' });
      const { rect, ...shown } = target;
      return this.withDownload({ ...await this.info(), target: shown }, await this.awaitDownload(before));
    }
    if (op === 'inspect') return args.action ? this.pageData(inspectPoint, args) : this.inspect(args.id);
    if (op === 'click') {
      const inspected = await this.inspect(args.id), before = this.downloadSerial;
      await this.showAction('click', args, inspected, await this.target(args.id).boundingBox().catch(() => null));
      await this.target(args.id).click({ noWaitAfter: true });
      return this.withDownload(await this.info(), await this.awaitDownload(before));
    }
    if (op === 'type') {
      const target = this.target(args.id); const inspected = await this.inspect(args.id);
      if (inspected.kind === 'password') throw new Error('Senhas só por browser_login ou pela pessoa no Chrome.');
      if (await target.evaluate((el, source) => !!(0, eval)(`(${source})`)(el), CARD_FIELD_SOURCE)) throw new Error('Campos de cartão só podem ser preenchidos pela carteira ou pela pessoa.');
      await this.showAction('type', args, inspected, await target.boundingBox().catch(() => null));
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
        await this.rememberCards(); await this.maskFields();
        if (args.marks) { const read = await this.pageData(readPage); await this.page.evaluate(markPage, read.elements); }
        return { ...await this.info(), ...this.viewportSize(), image: (await this.page.screenshot({ type: 'jpeg', quality: 65, mask: [...this.page.frames().map(frame => frame.locator(`input[type=password],${CARD_MARK}`)), ...[...this.secrets, ...this.cardSecrets].map(secret => this.page.getByText(secret, { exact: false }))], maskColor: '#000000' })).toString('base64') };
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
    // browser_pay: the address and the total come from this page, read here, never from the bot.
    if (op === 'pay') {
      const url = await allowedUrl(this.page.url());
      if (!url.startsWith('https://')) throw new Error('O pagamento só é feito numa página https.');
      const { total } = await this.page.evaluate(readCheckoutTotal);
      const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const challenge = randomBytes(24).toString('base64url');
      this.payment = { privateKey, url, challenge, total, until: Date.now() + 60000 };
      return { url, pageTotal: total, publicKey: publicKey.export({ type: 'spki', format: 'der' }).toString('base64'), challenge };
    }
    if (op === 'pay_fill') {
      const pending = this.payment; this.payment = null;
      if (!pending || pending.until < Date.now() || pending.url !== this.page.url()) throw new Error('O pedido de pagamento venceu ou a página mudou.');
      let card;
      try {
        const key = privateDecrypt({ key: pending.privateKey, oaepHash: 'sha256' }, Buffer.from(args.key, 'base64'));
        const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(args.iv, 'base64'));
        decipher.setAAD(Buffer.from(pending.challenge)); decipher.setAuthTag(Buffer.from(args.tag, 'base64'));
        const bytes = Buffer.concat([decipher.update(Buffer.from(args.data, 'base64')), decipher.final()]);
        key.fill(0); card = JSON.parse(bytes.toString('utf8')); bytes.fill(0);
      } catch { throw new Error('Não consegui abrir o cartão enviado pelo celular. Nada foi preenchido.'); }
      if (card.url !== pending.url || card.challenge !== pending.challenge || card.total !== pending.total || !/^\d{12,19}$/.test(card.number)) throw new Error('O pedido de pagamento não confere com esta página. Nada foi preenchido.');
      // Known before it is typed: no echo of the card in reads, titles or pictures.
      for (const value of [card.number, card.number.replace(/(\d{4})(?=\d)/g, '$1 '), card.cvv]) this.cardSecrets.add(value);
      if ((await this.page.evaluate(readCheckoutTotal)).total !== pending.total) throw new Error('O total da página mudou. Nada foi preenchido.');
      const filled = await this.fillCard({ ...card, url: pending.url });
      if (!filled.includes('number')) { await this.fillCard({ clear: true }).catch(() => {}); throw new Error('Não encontrei o campo do número do cartão nesta página. Abra a etapa de pagamento com cartão; se ela estiver num quadro que o MyBots não conhece, use browser_ask_user.'); }
      return { paid: true, filled: [...new Set(filled)], ...await this.info() };
    }
    throw new Error('Comando do navegador inválido.');
  }
  /** The card into the checkout's own fields and its payment processor's frames (any origin), or empty again. */
  async fillCard(card) {
    const pageHost = new URL(this.page.url()).hostname, filled = [];
    for (const frame of this.page.frames()) {
      if (frame !== this.page.mainFrame() && !cardFrame(frame.url(), pageHost)) continue;
      const result = await frame.evaluate(({ source, card, main }) => (0, eval)(`(${source})`)(main ? card : { ...card, url: '' }), { source: CARD_FILL_SOURCE, card, main: frame === this.page.mainFrame() }).catch(() => ({ filled: [] }));
      if (result.moved) throw new Error('A página mudou. Nada foi preenchido.');
      filled.push(...result.filled);
    }
    return filled;
  }
  async close() {
    clearInterval(this.pageTimer); this.pageTimer = null; this.login = null; this.payment = null; this.closing = true; clearTimeout(this.frameTimer); this.frameTimer = null; this.pendingFrame = null;
    if (this.mode === 'mine' || this.mode === 'shared') {
      // Only this bot's tabs close: Meu Chrome and the shared Chrome keep running for the person and the other bots.
      if (this.onDisconnect) (this.mode === 'mine' ? this.browser : this.context)?.off(this.mode === 'mine' ? 'disconnected' : 'close', this.onDisconnect);
      if (this.cdp) await this.view(false).catch(() => {});
      await Promise.all((this.pages || []).map(page => this.closePage(page).catch(() => {})));
      this.pages = []; this.page = null; this.context = null; this.starting = null;
      if (this.mode === 'mine' && !this.connect) await this.browser?.close();
      this.emitFrame({ closed: true });
    } else await this.context?.close();
  }
}

if (process.send && process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const kind = process.argv[3], mine = kind === 'mine', shared = kind === 'shared', sessions = new Map(), secrets = new Set(); let connection, sharedContext;
  const connect = () => connection ||= connectMine(process.argv[4]).then(browser => { browser.on('disconnected', () => { connection = null; }); return browser; }).catch(error => { connection = null; throw error; });
  // The shared Chrome (the default): one profile for every bot that uses it, so a login made by one serves all of them.
  // Old logins are copied in before any bot's page opens.
  const imports = [];
  const open = () => sharedContext ||= launchContext(join(process.argv[2], 'chrome')).then(async context => {
    context.on('close', () => { sharedContext = null; });
    for (let n = 0; n < imports.length; n++) await imports[n](context).catch(() => {});
    return context;
  }).catch(error => { sharedContext = null; throw error; });
  const sessionFor = botId => {
    if (!sessions.has(botId)) {
      const session = mine ? new BrowserSession(join(process.argv[2], botId), { mode: 'mine', connect, botId })
        : shared ? new BrowserSession(join(process.argv[2], 'bots', botId), { mode: 'shared', connect: open, botId })
        : new BrowserSession(process.argv[2], { mode: 'own', botId });
      if (mine || shared) session.secrets = secrets;
      session.frame = frame => process.send?.({ frame, botId }); sessions.set(botId, session);
    }
    return sessions.get(botId);
  };
  const commands = new Map(); const people = new Map();
  const handle = async ({ id, botId = basename(process.argv[2]), op, args }) => {
    if (op === 'import') {
      if (!shared || typeof args?.profile !== 'string') return;
      const copy = context => importLogins(context, args.profile);
      imports.push(copy); if (sharedContext) await sharedContext.then(copy).catch(() => {});
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(botId || '')) return;
    try {
      if (op === 'close') { await sessions.get(botId)?.close(); sessions.delete(botId); if (id) process.send?.({ id, result: { closed: true } }); return; }
      if (op === 'view' && !args?.on && !sessions.get(botId)?.cdp) { process.send?.({ id, result: { watching: false } }); return; }
      const session = sessionFor(botId);
      const result = op === 'device' ? await session.deviceView(args) || { restored: true } : op === 'view' ? await session.view(Boolean(args?.on), args) : op === 'input' ? await session.input(args) : await session.command(op, args);
      process.send?.({ id, result });
    } catch (error) {
      process.send?.({ id, error: /Até 5 abas|Aba não encontrada|depuração|recusou a conexão|Endereço|navegador do bot|link|alvo mudou|executáveis|pagamento|cartão|Nada foi preenchido/.test(error.message) ? error.message : 'O navegador não conseguiu executar a ação. Confira a página e tente ler de novo; senhas só por browser_login.' });
    }
  };
  process.on('message', message => {
    if (message.op === 'view' || message.op === 'input' || message.op === 'close' || message.op === 'device') { const pending = (people.get(message.botId) || Promise.resolve()).then(() => handle(message)); people.set(message.botId, pending); }
    // One bot's commands keep their order; bots that share this browser do not wait for each other.
    else { const key = message.botId || ''; commands.set(key, (commands.get(key) || Promise.resolve()).then(() => handle(message))); }
  });
  const close = async () => { await Promise.all([...sessions.values()].map(session => session.close().catch(() => {}))); if (connection) await connection.then(browser => browser.close()).catch(() => {}); if (sharedContext) await sharedContext.then(context => context.close()).catch(() => {}); process.exit(); };
  process.on('disconnect', close); process.on('SIGTERM', close);
}
