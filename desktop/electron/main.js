// The MyBots window on the computer. The interface is served by the computer's node (pc/), which keeps the bots online
// with or without this window; closing the window only hides it to the tray. The bots' browser is real Chromium inside
// this same window (tabs.js), so the taskbar shows one app and the page behaves exactly like a browser.
const { app, BrowserWindow, WebContentsView, Tray, Menu, ipcMain, shell, nativeImage, clipboard } = require('electron');
const { randomBytes } = require('node:crypto');
const { execFile, spawn } = require('node:child_process');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, chmodSync, createWriteStream, readdirSync, statSync } = require('node:fs');
const { createTabs, controlServer } = require('./tabs');
const { chooseRenderNode } = require('./gpu');
const { createUpdates } = require('./updates');
const { isOurs, PARK_RULE } = require('./hypr-core');

const UI_PORT = Number(process.env.MYBOTS_PC_UI_PORT) || 3232;
const UI = `http://127.0.0.1:${UI_PORT}`;
// The node's folder: the same rule as pc/platform.mjs (dataDirectory).
const node = process.env.MYBOTS_PC_DIR || (process.platform === 'win32' ? join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'MyBots') : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'MyBots') : join(homedir(), '.mybots-pc'));
const hidden = process.argv.includes('--hidden');
// The installed app (AppImage, .deb, .exe, .dmg) carries its own node: it starts pc/node.mjs itself, with this same Electron
// running as plain Node. In the development setup the node is the user's systemd service and the window only attaches to it.
const embedded = app.isPackaged || process.env.MYBOTS_EMBED === '1';
let child = null;
const icon = nativeImage.createFromPath(join(__dirname, 'icon.png'));

app.setName('mybots-desktop');
// A fault in a tab must never become a dialog that blocks the window: it goes to the log.
process.on('uncaughtException', error => console.error('MyBots:', error));
// Chromium listens for the node's browser worker on a random local port (written to DevToolsActivePort).
app.commandLine.appendSwitch('remote-debugging-port', '0');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
// The remote debugging port would otherwise tell every page it is automated (navigator.webdriver).
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');
app.commandLine.appendSwitch('lang', 'pt-BR');
// Notebooks with two graphics cards: the integrated one draws the screen, not the NVIDIA one Chromium picked (see gpu.js).
const renderNode = chooseRenderNode();
if (renderNode) app.commandLine.appendSwitch('render-node-override', renderNode);
// Warnings and errors of Chromium itself (graphics process, GPU, tabs) go to a file, so a black window leaves a trace.
try { mkdirSync(node, { recursive: true, mode: 0o700 }); app.commandLine.appendSwitch('enable-logging', 'file'); app.commandLine.appendSwitch('log-file', join(node, 'electron.log')); app.commandLine.appendSwitch('log-level', '1'); } catch {}
const first = app.requestSingleInstanceLock();
if (!first) app.quit();
// A leftover from the last run would point the node at a port nobody listens on.
else try { unlinkSync(join(app.getPath('userData'), 'DevToolsActivePort')); } catch {}

// A launcher named `node` for what the IAs start (the tools server): Electron's binary only acts as Node with ELECTRON_RUN_AS_NODE.
function nodeLauncher() {
  const bin = join(node, 'bin'); mkdirSync(bin, { recursive: true, mode: 0o700 });
  if (process.platform === 'win32') { const file = join(bin, 'node.cmd'); writeFileSync(file, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" %*\r\n`); return file; }
  const file = join(bin, 'node'); writeFileSync(file, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "$@"\n`, { mode: 0o700 }); chmodSync(file, 0o700); return file;
}
// The PATH of the user's login shell (where npm's global programs and the AIs' commands live): an app opened from the menu
// does not inherit it, and the AIs would look "not installed".
function loginPath() {
  if (process.platform === 'win32') return process.env.PATH;
  try { return require('node:child_process').execFileSync(process.env.SHELL || '/bin/sh', ['-lc', 'echo "$PATH"'], { encoding: 'utf8', timeout: 5000 }).trim().split('\n').pop() || process.env.PATH; } catch { return process.env.PATH; }
}
const nodeEnvironment = () => ({ ...process.env, PATH: [loginPath(), join(homedir(), '.local', 'bin')].join(process.platform === 'win32' ? ';' : ':'), ELECTRON_RUN_AS_NODE: '1', MYBOTS_NODE: nodeLauncher(), MYBOTS_PC_HOME: node });
// Runs one command of the node (doctor, pair --json) and gives back its JSON.
function nodeCommand(...args) {
  return new Promise((resolve, reject) => {
    const run = spawn(process.execPath, [join(__dirname, '..', '..', 'pc', 'node.mjs'), ...args], { env: nodeEnvironment(), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = ''; run.stdout.on('data', data => { out += data; }); run.stderr.on('data', data => { err += data; });
    const timer = setTimeout(() => { run.kill(); reject(new Error('Demorou demais.')); }, 60000);
    run.on('exit', () => { clearTimeout(timer); try { resolve(JSON.parse(out.trim().split('\n').pop())); } catch { reject(new Error(err.trim().split('\n').pop() || 'Sem resposta.')); } });
  });
}
let welcome = null;
function openWelcome() {
  if (welcome && !welcome.isDestroyed()) { welcome.focus(); return; }
  welcome = new BrowserWindow({ title: 'Bem-vindo ao MyBots', width: 700, height: 820, minWidth: 460, backgroundColor: '#090B10', autoHideMenuBar: true, icon, webPreferences: { preload: join(__dirname, 'welcome-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  welcome.setMenuBarVisibility(false); welcome.loadFile(join(__dirname, 'welcome.html'));
  welcome.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); welcome.webContents.on('will-navigate', event => event.preventDefault());
}
const fromWelcome = event => Boolean(welcome) && !welcome.isDestroyed() && event.sender === welcome.webContents;
function welcomeHandlers() {
  const done = join(node, 'welcome.done');
  ipcMain.handle('welcome:doctor', event => fromWelcome(event) ? nodeCommand('doctor') : null);
  ipcMain.handle('welcome:pair', event => fromWelcome(event) ? nodeCommand('pair', '--json') : null);
  ipcMain.handle('welcome:open', (event, url) => { if (fromWelcome(event) && typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url); });
  ipcMain.handle('welcome:copy', (event, text) => { if (fromWelcome(event) && typeof text === 'string' && text.length < 200) clipboard.writeText(text); });
  ipcMain.handle('welcome:finish', event => { if (!fromWelcome(event)) return; try { writeFileSync(done, new Date().toISOString()); } catch {} welcome.close(); });
  return existsSync(done);
}
async function nodeAnswers() { try { return (await fetch(`${UI}/health`, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }
async function startNode() {
  if (!embedded || await nodeAnswers()) return;
  const root = join(__dirname, '..', '..'); mkdirSync(node, { recursive: true, mode: 0o700 });
  const log = createWriteStream(join(node, 'node.log'), { flags: 'a' });
  const env = nodeEnvironment();
  const launch = () => {
    child = spawn(process.execPath, [join(root, 'pc', 'node.mjs')], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const mine = child; child.on('exit', () => { if (child === mine) child = null; if (!quitting) setTimeout(() => { if (!quitting && !child) launch(); }, 5000); });
  };
  launch();
}
// Linux has no login-item API in Electron: the app's own entry in the session's autostart, once (Windows and macOS use theirs).
function autostart() {
  // Only the installed app, once, and never over an entry that is already there (the development setup has its own).
  if (!app.isPackaged) return;
  const flag = join(node, 'autostart.done'); if (existsSync(flag)) return;
  // Windows and macOS have a login-item API: the installed app registers itself once (the person can turn it off in the system's settings).
  if (process.platform !== 'linux') { try { app.setLoginItemSettings({ openAtLogin: true, args: ['--hidden'] }); mkdirSync(node, { recursive: true }); writeFileSync(flag, new Date().toISOString()); } catch {} return; }
  try {
    const dir = join(homedir(), '.config', 'autostart'); mkdirSync(dir, { recursive: true });
    if (existsSync(join(dir, 'mybots.desktop'))) { writeFileSync(flag, 'existing'); return; }
    writeFileSync(join(dir, 'mybots.desktop'), `[Desktop Entry]\nType=Application\nName=MyBots\nComment=Seus bots pessoais\nExec="${process.env.APPIMAGE || process.execPath}" --hidden\nIcon=mybots\nTerminal=false\nCategories=Utility;\n`);
    writeFileSync(flag, new Date().toISOString());
  } catch {}
}
let updates = null;
let window = null, ui = null, overlay = null, overlayState = null, overlayOpen = false, tray = null, tabs = null, control = null, quitting = false;
// The bots browse in this window's tabs, and Chromium only paints a window that is not hidden. Where the compositor is
// Hyprland the window is therefore parked on a special workspace instead of hidden, so the bots keep working in the tray.
const hypr = (...args) => new Promise(resolve => execFile('hyprctl', args, { timeout: 3000 }, (error, out) => resolve(error ? null : String(out))));
const PARK = 'special:mybots';
// Started from a launcher or systemd the session's variable may be missing: the running Hyprland's own socket folder says which it is.
function findHypr() {
  if (process.env.HYPRLAND_INSTANCE_SIGNATURE) return true;
  try {
    const base = join(process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid()}`, 'hypr');
    const live = readdirSync(base).filter(name => existsSync(join(base, name, '.socket.sock'))).sort((a, b) => statSync(join(base, b)).mtimeMs - statSync(join(base, a)).mtimeMs)[0];
    if (live) { process.env.HYPRLAND_INSTANCE_SIGNATURE = live; return true; }
  } catch {}
  return false;
}
const onHypr = () => process.platform === 'linux' && findHypr();
async function client() { try { return JSON.parse(await hypr('clients', '-j') || '[]').find(item => isOurs(item, process.pid)); } catch { return null; } }
async function park() {
  if (!onHypr()) { window.hide(); return; }
  const mine = await client(); if (mine) await hypr('dispatch', 'movetoworkspacesilent', `${PARK},address:${mine.address}`); else window.hide();
}
async function show() {
  if (!window) return;
  updates?.checkIfStale();   // the person is looking: a new version shows up without restarting the app
  if (!window.isVisible()) window.show();
  if (window.isMinimized()) window.restore();
  if (onHypr()) {
    // The window may not be mapped yet right after it opens.
    let mine = await client(); for (let n = 0; !mine && n < 15; n++) { await new Promise(resolve => setTimeout(resolve, 200)); mine = await client(); }
    if (mine?.workspace?.name === PARK) { const now = JSON.parse(await hypr('activeworkspace', '-j') || '{}'); if (now.id) await hypr('dispatch', 'movetoworkspace', `${now.id},address:${mine.address}`); }
  }
  window.focus();
}
const trusted = event => { try { return event.sender === ui?.webContents && new URL(event.senderFrame.url).origin === UI; } catch { return false; } };

function advertise(port) {
  mkdirSync(node, { recursive: true, mode: 0o700 });
  const file = join(app.getPath('userData'), 'DevToolsActivePort');
  const cdp = Number(readFileSync(file, 'utf8').split('\n')[0]);
  writeFileSync(join(node, 'electron.json'), JSON.stringify({ pid: process.pid, cdp, control: port.port, token: port.token }), { mode: 0o600 });
  chmodSync(join(node, 'electron.json'), 0o600);
}

app.on('second-instance', show);
if (first) app.whenReady().then(async () => {
  autostart(); await startNode(); const welcomed = welcomeHandlers();
  window = new BrowserWindow({ title: 'MyBots', width: 1000, height: 760, minWidth: 420, minHeight: 560, show: false, backgroundColor: '#090B10', autoHideMenuBar: true, icon });
  window.setMenuBarVisibility(false);
  // The interface is a view of its own so the browser's tabs can sit under it (see tabs.js).
  ui = new WebContentsView({ webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  ui.setBackgroundColor('#090B10'); window.contentView.addChildView(ui);
  const fit = () => { const [width, height] = window.getContentSize(); ui.setBounds({ x: 0, y: 0, width, height }); };
  fit(); window.on('resize', fit);
  ui.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  ui.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(UI) && !url.startsWith('file://')) event.preventDefault(); });
  window.on('focus', () => updates?.checkIfStale());
  window.on('close', event => { if (!quitting) { event.preventDefault(); park(); } });
  // A reloaded interface knows nothing of the area it asked for: the browser goes back under it.
  ui.webContents.on('did-start-loading', () => tabs?.place(null));
  // A blank interface (its page process crashed or hung, or the graphics process died) used to leave a black window until the person
  // closed the app. It reloads by itself: nothing is lost, the data is in the supervisor.
  const reloadUi = why => { if (ui.webContents.isDestroyed()) return; console.error('[MyBots] recarregando a interface:', why); setTimeout(() => { if (!ui.webContents.isDestroyed()) ui.webContents.reload(); }, 400); };
  ui.webContents.on('render-process-gone', (_event, details) => { if (details.reason !== 'clean-exit') reloadUi(details.reason); });
  let hung = null;
  ui.webContents.on('unresponsive', () => { clearTimeout(hung); hung = setTimeout(() => reloadUi('sem resposta por 10 s'), 10000); });
  ui.webContents.on('responsive', () => clearTimeout(hung));
  ui.webContents.on('did-fail-load', (_event, code, _text, url, isMainFrame) => { if (isMainFrame && code !== -3) setTimeout(() => { if (!ui.webContents.isDestroyed()) ui.webContents.reload(); }, 2000); });
  app.on('child-process-gone', (_event, details) => { if (details.type === 'GPU' && details.reason !== 'clean-exit') reloadUi('GPU ' + details.reason); });
  ui.webContents.loadFile(join(__dirname, '..', 'loader', 'index.html'), { query: { port: String(UI_PORT), embedded: embedded ? '1' : '' } });

  const downloads = join(node, 'downloads'); mkdirSync(downloads, { recursive: true, mode: 0o700 });
  // The bot's face over the page: a transparent view above the tabs, shown only while the interface asks for it.
  overlay = new WebContentsView({ webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  overlay.setBackgroundColor('#00000000'); overlay.setVisible(false); window.contentView.addChildView(overlay);
  const placeOverlay = () => {
    if (!overlayState) { overlay.setVisible(false); return; }
    const [width, height] = window.getContentSize(), wide = overlayOpen ? Math.min(480, width - 40) : 56, tall = overlayOpen ? 64 : 56;
    overlay.setBounds({ x: width - wide - 20, y: height - tall - 20, width: wide, height: tall }); overlay.setVisible(true); window.contentView.addChildView(overlay);
  };
  window.on('resize', placeOverlay);
  tabs = createTabs({ window, ui, downloads, above: () => (overlayState ? overlay : null), notify: state => { if (!window.isDestroyed() && !ui.webContents.isDestroyed()) ui.webContents.send('tabs:state', state); } });
  const token = randomBytes(32).toString('hex');
  control = await controlServer({ tabs, token, updates: () => updates });
  // The DevToolsActivePort file appears a moment after the app is ready.
  for (let n = 0; n < 80 && !existsSync(join(app.getPath('userData'), 'DevToolsActivePort')); n++) await new Promise(resolve => setTimeout(resolve, 100));
  advertise({ port: control.port, token });

  ipcMain.handle('tabs:list', event => trusted(event) ? tabs.state() : null);
  ipcMain.handle('tabs:create', (event, url) => trusted(event) ? tabs.create(typeof url === 'string' && /^https?:/i.test(url) ? url : 'https://www.google.com/').id : null);
  ipcMain.handle('tabs:activate', (event, id) => trusted(event) && tabs.activate(id));
  ipcMain.handle('tabs:close', (event, id) => trusted(event) && tabs.close(id));
  ipcMain.handle('tabs:go', (event, id, url) => trusted(event) && typeof url === 'string' && tabs.go(id, url.slice(0, 2000)));
  ipcMain.handle('tabs:nav', (event, id, action) => trusted(event) && tabs.nav(id, action));
  ipcMain.handle('tabs:place', (event, rect) => { if (trusted(event)) tabs.place(rect); });
  const fromOverlay = event => { try { return event.sender === overlay?.webContents && new URL(event.senderFrame.url).origin === UI; } catch { return false; } };
  ipcMain.handle('overlay:show', (event, state) => {
    if (!trusted(event) || !state || typeof state !== 'object') return;
    overlayState = { bot: state.bot, working: Boolean(state.working) };
    if (!overlay.webContents.getURL()) overlay.webContents.loadURL(`${UI}/?overlay=1`).catch(() => {});
    placeOverlay(); overlay.webContents.send('overlay:state', overlayState);
  });
  ipcMain.handle('overlay:hide', event => { if (!trusted(event)) return; overlayState = null; overlayOpen = false; placeOverlay(); });
  ipcMain.handle('overlay:expand', (event, open) => { if (!fromOverlay(event)) return; overlayOpen = Boolean(open); placeOverlay(); if (overlayOpen) overlay.webContents.focus(); });
  ipcMain.handle('overlay:send', (event, text) => { if (fromOverlay(event) && typeof text === 'string' && text.trim() && !ui.webContents.isDestroyed()) ui.webContents.send('overlay:message', text.slice(0, 4000)); });
  ipcMain.handle('tabs:thumb', (event, id) => trusted(event) ? tabs.thumb(id) : null);

  tray = new Tray(icon.resize({ width: 32, height: 32 })); tray.setToolTip('MyBots');
  const trayMenu = () => Menu.buildFromTemplate([{ label: 'Abrir o MyBots', click: show }, ...[updates?.menuItem()].filter(Boolean), { label: 'Assistente de primeira execução', click: openWelcome }, { type: 'separator' }, { label: embedded ? 'Sair do MyBots (os bots ficam offline)' : 'Fechar a janela (os bots continuam online)', click: () => { quitting = true; app.quit(); } }]);
  if (embedded) {
    updates = createUpdates({ log: line => console.log('[atualização]', line), beforeInstall: () => { quitting = true; },
      changed: () => { tray?.setContextMenu(trayMenu()); try { if (ui && !ui.webContents.isDestroyed()) ui.webContents.send('update:state', updates.state()); } catch {} } });
    updates.start();
  }
  // The window's "Atualizar" button and the check in Ajustes → Sobre.
  ipcMain.handle('update:state', event => trusted(event) ? updates?.state() ?? null : null);
  ipcMain.handle('update:check', async event => { if (!trusted(event) || !updates) return null; await updates.check(); return updates.state(); });
  ipcMain.handle('update:install', event => { if (trusted(event)) updates?.install(); });
  tray.setContextMenu(trayMenu());
  tray.on('click', show);
  if (!hidden) show();
  // Started with the session it waits in the tray, but still mapped (parked) so the bots' tabs paint.
  else if (onHypr()) { await hypr('keyword', 'windowrule', PARK_RULE()); window.showInactive(); }
  else window.showInactive();
  if (embedded && !welcomed) openWelcome();
});
app.on('before-quit', () => { quitting = true; try { child?.kill(); } catch {} if (first) try { unlinkSync(join(node, 'electron.json')); } catch {} });
app.on('window-all-closed', () => {});
