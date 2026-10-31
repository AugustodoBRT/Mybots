// The real browser inside the MyBots window: one Chromium view per tab, all in one persistent session (the bots' browser).
// The computer's node controls the same tabs through Chrome's DevTools protocol (remote debugging port) and asks this
// module, through a small local server, for what the protocol cannot do in Electron (opening and closing tabs).
const { app, WebContentsView, session } = require('electron');
const { randomBytes } = require('node:crypto');
const { createServer } = require('node:http');

const PARTITION = 'persist:mybots-browser';
const limit = (text, size) => String(text || '').slice(0, size);

function createTabs({ window, notify, downloads, log = () => {} }) {
  const tabs = new Map(); let order = [], active = null, serial = 0, place = null;
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
    platform: 'Linux', platformVersion: '6.0.0', architecture: 'x86', model: '', mobile: false, bitness: '64', wow64: false };
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
  };
  function create(url = 'about:blank', { owner = null, activate = true } = {}) {
    const id = ++serial, marker = randomBytes(6).toString('hex');
    const view = new WebContentsView({ webPreferences: { session: ses, sandbox: true, contextIsolation: true, nodeIntegration: false, spellcheck: false, backgroundThrottling: false } });
    view.setBackgroundColor('#ffffff');
    const contents = view.webContents, tab = { view, contents, marker, owner, icon: '' };
    tabs.set(id, tab); order.push(id);
    for (const event of ['page-title-updated', 'did-navigate', 'did-navigate-in-page', 'did-start-loading', 'did-stop-loading']) contents.on(event, changed);
    contents.on('page-favicon-updated', (_event, icons) => { tab.icon = icons[0] || ''; changed(); });
    // A link that wants a new window opens as a new tab, like in any browser.
    contents.setWindowOpenHandler(({ url: target }) => { if (/^https?:/i.test(target)) setImmediate(() => create(target, { owner })); return { action: 'deny' }; });
    contents.on('destroyed', () => { tabs.delete(id); order = order.filter(item => item !== id); if (active === id) active = order[order.length - 1] ?? null; layout(); changed(); if (!order.length && !window.isDestroyed()) setImmediate(() => create(HOME)); });
    present(contents);
    contents.loadURL(url === 'about:blank' ? `about:blank#${marker}` : url).catch(() => {});
    if (activate) active = id;
    layout(); changed(); return { id, marker };
  }
  function close(id) { const tab = tabs.get(id); if (!tab) return false; if (!tab.contents.isDestroyed()) tab.contents.close(); return true; }
  const activate = id => { if (!tabs.has(id)) return false; active = id; layout(); changed(); tabs.get(id).contents.focus(); return true; };
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
function controlServer({ tabs, token }) {
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
        else if (path === '/tab/activate') { const id = tabs.markerOf(input.marker); reply(200, { ok: id != null && tabs.activate(id) }); }
        else reply(404, { error: 'Não existe.' });
      } catch (error) { reply(400, { error: error.message }); }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

module.exports = { createTabs, controlServer, PARTITION };
