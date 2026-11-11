// The real browser inside the MyBots window: one Chromium view per tab, all in one persistent session (the bots' browser).
// The computer's node controls the same tabs through Chrome's DevTools protocol (remote debugging port) and asks this
// module, through a small local server, for what the protocol cannot do in Electron (opening and closing tabs).
const { app, WebContentsView, session } = require('electron');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:http');

const PARTITION = 'persist:mybots-browser';
const limit = (text, size) => String(text || '').slice(0, size);
const { returnsFocus } = require('./focus-rules');

function createTabs({ window, ui, notify, downloads, above = () => null, log = () => {} }) {
  const tabs = new Map(); let order = [], active = null, serial = 0, place = null;
  // A bot working in a page must not take the keyboard from someone writing in the interface.
  let typedAt = 0;
  ui?.webContents.on('before-input-event', (_event, input) => { if (input.type === 'keyDown') typedAt = Date.now(); });
  const ses = session.fromPartition(PARTITION);
  // A normal Chrome to the sites (Google refuses to sign in to anything that says "Electron").
  const agent = app.userAgentFallback.replace(/ Electron\/\S+/, '').replace(/ mybots-desktop\/\S+/, '');
  const major = (process.versions.chrome || '150').split('.')[0], full = process.versions.chrome || `${major}.0.0.0`;
  const LANGUAGES = 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7';
  ses.setUserAgent(agent, LANGUAGES);
  // Electron's client hints name only Chromium; Google's sign-in wants to see a Chrome. Same engine, same version.
  // Done at the person's request (they accept the risk to their Google account).
  const hints = { brands: [{ brand: 'Not?A_Brand', version: '24' }, { brand: 'Chromium', version: major }, { brand: 'Google Chrome', version: major }],
    fullVersionList: [{ brand: 'Not?A_Brand', version: '24.0.0.0' }, { brand: 'Chromium', version: full }, { brand: 'Google Chrome', version: full }],
    ...(process.platform === 'win32' ? { platform: 'Windows', platformVersion: '10.0.0' } : process.platform === 'darwin' ? { platform: 'macOS', platformVersion: '14.0.0' } : { platform: 'Linux', platformVersion: '6.0.0' }),
    architecture: process.arch === 'arm64' ? 'arm' : 'x86', model: '', mobile: false, bitness: '64', wow64: false };
  // Electron sends no client-hint headers at all; a Chrome sends these three on every request (done at the person's request).
  ses.webRequest.onBeforeSendHeaders((details, done) => {
    const headers = details.requestHeaders;
    headers['Sec-CH-UA'] = `"Not?A_Brand";v="24", "Chromium";v="${major}", "Google Chrome";v="${major}"`; headers['Sec-CH-UA-Mobile'] = '?0'; headers['Sec-CH-UA-Platform'] = '"Linux"';
    done({ requestHeaders: headers });
  });
  const present = contents => { try { if (!contents.debugger.isAttached()) contents.debugger.attach('1.3'); contents.debugger.sendCommand('Emulation.setUserAgentOverride', { userAgent: agent, acceptLanguage: 'pt-BR,pt,en-US,en', platform: 'Linux x86_64', userAgentMetadata: hints }).catch(() => {}); } catch {} };
  // The browser keeps its own rules: no permissions asked silently, downloads go to the bots' folder.
  ses.setPermissionRequestHandler((_contents, _permission, done) => done(false));
  ses.on('will-download', (_event, item) => { try { item.setSavePath(require('node:path').join(downloads, `${Date.now()}-${item.getFilename().replace(/[\/\\]/g, '_')}`)); } catch {} });
  const state = () => ({ active, tabs: order.map(id => { const tab = tabs.get(id), contents = tab.contents; return { id, marker: tab.marker, owner: tab.owner || null, title: limit(/^about:blank/.test(contents.getTitle()) ? '' : contents.getTitle(), 200), url: limit(contents.getURL().replace(/^about:blank#.*/, 'about:blank'), 2000), icon: tab.icon || '', loading: contents.isLoading(), back: contents.navigationHistory.canGoBack(), forward: contents.navigationHistory.canGoForward() }; }) });
  let timer = null;
  const changed = () => { clearTimeout(timer); timer = setTimeout(() => notify(state()), 40); };
  // A tab the person is not looking at is still a live page for the bots (screenshots, scripts): it stays visible, full
  // size, under the interface (which is a view too), so Chromium keeps painting it. The tab being shown goes on top of the
  // interface, only over the area the interface asks for.
  const layout = () => {
    const [width, height] = window.getContentSize();
    for (const [id, tab] of [...tabs]) {
      // A tab whose page is gone leaves the list before anything touches its view.
      if (tab.contents.isDestroyed()) { tabs.delete(id); order = order.filter(item => item !== id); if (active === id) active = order[order.length - 1] ?? null; continue; }
      const shown = Boolean(place) && id === active;
      if (shown) window.contentView.addChildView(tab.view); else window.contentView.addChildView(tab.view, 0);
      tab.view.setBounds(shown ? place : { x: 0, y: 0, width, height }); tab.view.setVisible(true);
    }
    // What floats over the page (the bot's face) stays on top of the tab that was just brought forward.
    const floating = above(); if (floating) window.contentView.addChildView(floating);
  };
  function create(url = 'about:blank', { owner = null, activate = true } = {}) {
    const id = ++serial, marker = randomBytes(6).toString('hex');
    const view = new WebContentsView({ webPreferences: { session: ses, // window.chrome, as a Chrome has it, comes from tab-preload.js
    preload: require('node:path').join(__dirname, 'tab-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
    view.setBackgroundColor('#ffffff');
    const contents = view.webContents, tab = { view, contents, marker, owner, icon: '', lastUse: Date.now() };
    tabs.set(id, tab); order.push(id);
    for (const event of ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) contents.on(event, () => { tab.lastUse = Date.now(); changed(); });
    contents.on('page-favicon-updated', (_event, icons) => { tab.icon = icons[0] || ''; changed(); });
    // A link that wants a new window opens as a new tab, like in any browser.
    contents.setWindowOpenHandler(({ url: target }) => { if (/^https?:/i.test(target)) setImmediate(() => create(target, { owner })); return { action: 'deny' }; });
    contents.on('destroyed', () => { tabs.delete(id); order = order.filter(item => item !== id); if (active === id) active = order[order.length - 1] ?? null; layout(); changed(); if (!order.length && !window.isDestroyed()) setImmediate(() => create(HOME)); });
    contents.on('before-mouse-event', (_event, input) => { if (input.type === 'mouseDown') tab.pressedAt = Date.now(); });
    contents.on('focus', () => { if (ui && !ui.webContents.isDestroyed() && returnsFocus({ typedAt, pressedAt: tab.pressedAt, chosenAt: tab.chosenAt, now: Date.now() })) ui.webContents.focus(); });
    present(contents);
    contents.loadURL(url === 'about:blank' ? `about:blank#${marker}` : url).catch(() => {});
    if (activate) active = id;
    layout(); changed(); enforceLimit(id); return { id, marker };
  }
  // Every tab is a whole page kept painting at full size under the interface: with several bots browsing at once they pile up and the
  // graphics process gives out (the window went black). Over this many, the ones touched longest ago (never the active one) are closed.
  const MAX_TABS = 10;
  const enforceLimit = keep => {
    const excess = order.length - MAX_TABS; if (excess <= 0) return;
    const victims = order.filter(id => id !== active && id !== keep && tabs.has(id)).sort((a, b) => (tabs.get(a).lastUse || 0) - (tabs.get(b).lastUse || 0)).slice(0, excess);
    for (const id of victims) close(id);
  };
  // A tab nobody has touched for a long time (no page change, not brought forward) is closed: each one is a whole page in memory.
  // The tab being shown and the last one stay; the idle time is long enough for a bot reading a page between steps.
  const IDLE_TAB_MS = 30 * 60000;
  const sweep = setInterval(() => {
    if (window.isDestroyed()) { clearInterval(sweep); return; }
    if (order.length <= 1) return;
    for (const id of [...order]) { const tab = tabs.get(id); if (tab && id !== active && !tab.contents.isDestroyed() && Date.now() - (tab.lastUse || 0) > IDLE_TAB_MS && order.length > 1) close(id); }
  }, 60000); sweep.unref?.();
  function close(id) { const tab = tabs.get(id); if (!tab) return false; if (!tab.contents.isDestroyed()) tab.contents.close(); return true; }
  // `focus` only when the person chose the tab; a bot changing tabs leaves the keyboard where it is.
  const activate = (id, { focus = true } = {}) => { if (!tabs.has(id)) return false; const tab = tabs.get(id); active = id; tab.lastUse = Date.now(); layout(); changed(); if (focus) { tab.chosenAt = Date.now(); tab.contents.focus(); } return true; };
  const go = (id, url) => { const contents = tabs.get(id)?.contents; if (!contents || contents.isDestroyed()) return false; const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : /^[^\s/]+\.[^\s/]+/.test(url) ? `https://${url}` : `https://www.google.com/search?q=${encodeURIComponent(url)}`; if (!/^https?:/i.test(target)) return false; contents.loadURL(target).catch(() => {}); return true; };
  const nav = (id, action) => { const contents = tabs.get(id)?.contents; if (!contents || contents.isDestroyed()) return false; if (action === 'back') contents.navigationHistory.goBack(); else if (action === 'forward') contents.navigationHistory.goForward(); else if (action === 'reload') contents.reload(); else return false; return true; };
  const thumb = async id => { const contents = tabs.get(id)?.contents; if (!contents || contents.isDestroyed()) return null; const image = await contents.capturePage(); const small = image.resize({ width: 480 }); return small.toDataURL(); };
  const setPlace = rect => { place = rect && [rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) ? { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.max(1, Math.round(rect.width)), height: Math.max(1, Math.round(rect.height)) } : null; layout(); };
  window.on('resize', () => place && layout());
  // The browser always has a tab, and a new one the person opens lands on Google, like the first run of Chrome.
  const HOME = 'https://www.google.com/';
  create(HOME, { activate: false });
  return { state, create, close, activate, go, nav, thumb, place: setPlace, tabs, ses, markerOf: marker => [...tabs.entries()].find(([, tab]) => tab.marker === marker)?.[0] };
}

/** The local server the node's browser worker uses to open and close tabs (token in the node's private folder). */
function controlServer({ tabs, token, updates = () => null }) {
  const server = createServer((request, response) => {
    const reply = (code, body) => response.writeHead(code, { 'Content-Type': 'application/json' }).end(JSON.stringify(body));
    if (request.headers.authorization !== `Bearer ${token}` || request.headers.origin) { reply(403, { error: 'Acesso negado.' }); return; }
    let body = ''; request.on('data', chunk => { body += chunk; if (body.length > 10000) request.destroy(); });
    request.on('end', () => {
      try {
        const input = body ? JSON.parse(body) : {}, path = new URL(request.url, 'http://x').pathname;
        if (path === '/tabs') reply(200, tabs.state());
        else if (path === '/tab/create') { const url = typeof input.url === 'string' && /^https?:/i.test(input.url) ? input.url : 'about:blank'; reply(200, tabs.create(url, { owner: typeof input.owner === 'string' ? input.owner : null, activate: input.activate !== false })); }
        else if (path === '/tab/close') { const id = tabs.markerOf(input.marker); reply(200, { closed: id != null && tabs.close(id) }); }
        else if (path === '/tab/activate') { const id = tabs.markerOf(input.marker); reply(200, { ok: id != null && tabs.activate(id, { focus: false }) }); }
        // The phone asks the computer to update (through the node): look, and install, exactly like the window's own button.
        else if (path === '/update/state' || path === '/update/check' || path === '/update/install') {
          const up = updates(); if (!up) { reply(200, { phase: 'none', unavailable: true }); return; }
          Promise.resolve(path === '/update/check' ? up.check() : path === '/update/install' ? up.install() : null).then(() => reply(200, up.state()), error => reply(500, { error: error.message }));
        }
        else reply(404, { error: 'Não existe.' });
      } catch (error) { reply(400, { error: error.message }); }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

module.exports = { createTabs, controlServer, PARTITION };
