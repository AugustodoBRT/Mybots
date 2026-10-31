// The MyBots window on the computer. The interface is served by the computer's node (pc/), which keeps the bots online
// with or without this window; closing the window only hides it to the tray. The bots' browser is real Chromium inside
// this same window (tabs.js), so the taskbar shows one app and the page behaves exactly like a browser.
const { app, BrowserWindow, WebContentsView, Tray, Menu, ipcMain, shell, nativeImage } = require('electron');
const { randomBytes } = require('node:crypto');
const { execFile } = require('node:child_process');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, chmodSync } = require('node:fs');
const { createTabs, controlServer } = require('./tabs');

const UI = 'http://127.0.0.1:3232';
const node = process.env.MYBOTS_PC_DIR || join(homedir(), '.mybots-pc');
const hidden = process.argv.includes('--hidden');
const icon = nativeImage.createFromPath(join(__dirname, 'icon.png'));

app.setName('mybots-desktop');
// A fault in a tab must never become a dialog that blocks the window: it goes to the log.
process.on('uncaughtException', error => console.error('MyBots:', error));
// Chromium listens for the node's browser worker on a random local port (written to DevToolsActivePort).
app.commandLine.appendSwitch('remote-debugging-port', '0');
app.commandLine.appendSwitch('ozone-platform-hint', 'auto');
const first = app.requestSingleInstanceLock();
if (!first) app.quit();
// A leftover from the last run would point the node at a port nobody listens on.
else try { unlinkSync(join(app.getPath('userData'), 'DevToolsActivePort')); } catch {}

let window = null, ui = null, tray = null, tabs = null, control = null, quitting = false;
// The bots browse in this window's tabs, and Chromium only paints a window that is not hidden. Where the compositor is
// Hyprland the window is therefore parked on a special workspace instead of hidden, so the bots keep working in the tray.
const hypr = (...args) => new Promise(resolve => execFile('hyprctl', args, { timeout: 3000 }, (error, out) => resolve(error ? null : String(out))));
const PARK = 'special:mybots';
const onHypr = () => Boolean(process.env.HYPRLAND_INSTANCE_SIGNATURE);
async function client() { try { return JSON.parse(await hypr('clients', '-j') || '[]').find(item => item.pid === process.pid && item.class === 'mybots-desktop'); } catch { return null; } }
async function park() {
  if (!onHypr()) { window.hide(); return; }
  const mine = await client(); if (mine) await hypr('dispatch', 'movetoworkspacesilent', `${PARK},address:${mine.address}`); else window.hide();
}
async function show() {
  if (!window) return;
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
  window = new BrowserWindow({ title: 'MyBots', width: 1000, height: 760, minWidth: 420, minHeight: 560, show: false, backgroundColor: '#090B10', autoHideMenuBar: true, icon });
  window.setMenuBarVisibility(false);
  // The interface is a view of its own so the browser's tabs can sit under it (see tabs.js).
  ui = new WebContentsView({ webPreferences: { preload: join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  ui.setBackgroundColor('#090B10'); window.contentView.addChildView(ui);
  const fit = () => { const [width, height] = window.getContentSize(); ui.setBounds({ x: 0, y: 0, width, height }); };
  fit(); window.on('resize', fit);
  ui.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  ui.webContents.on('will-navigate', (event, url) => { if (!url.startsWith(UI) && !url.startsWith('file://')) event.preventDefault(); });
  window.on('close', event => { if (!quitting) { event.preventDefault(); park(); } });
  // A reloaded interface knows nothing of the area it asked for: the browser goes back under it.
  ui.webContents.on('did-start-loading', () => tabs?.place(null));
  ui.webContents.loadFile(join(__dirname, '..', 'loader', 'index.html'));

  const downloads = join(node, 'downloads'); mkdirSync(downloads, { recursive: true, mode: 0o700 });
  tabs = createTabs({ window, downloads, notify: state => { if (!window.isDestroyed() && !ui.webContents.isDestroyed()) ui.webContents.send('tabs:state', state); } });
  const token = randomBytes(32).toString('hex');
  control = await controlServer({ tabs, token });
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
  ipcMain.handle('tabs:thumb', (event, id) => trusted(event) ? tabs.thumb(id) : null);

  tray = new Tray(icon.resize({ width: 32, height: 32 })); tray.setToolTip('MyBots');
  tray.setContextMenu(Menu.buildFromTemplate([{ label: 'Abrir o MyBots', click: show }, { label: 'Fechar a janela (os bots continuam online)', click: () => { quitting = true; app.quit(); } }]));
  tray.on('click', show);
  if (!hidden) show();
  // Started with the session it waits in the tray, but still mapped (parked) so the bots' tabs paint.
  else if (onHypr()) { await hypr('keyword', 'windowrule', 'match:class ^(mybots-desktop)$, workspace special:mybots silent'); window.showInactive(); }
  else window.showInactive();
});
app.on('before-quit', () => { quitting = true; if (first) try { unlinkSync(join(node, 'electron.json')); } catch {} });
app.on('window-all-closed', () => {});
