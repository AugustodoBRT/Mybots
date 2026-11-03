// Looks for a new version when the window opens and every few hours, and updates the way the phone does: the window shows "Nova
// versão · Atualizar"; the click downloads it, installs it and restarts the app by itself. Windows and the AppImage do it
// (electron-updater, from the public feed); the .deb and macOS (not signed) cannot, so their button opens the download page.
const { app, Notification, shell } = require('electron');
const { FEED, RELEASE_PAGE, feedFile, feedVersion, isNewer, updatesItself, nextState, IDLE } = require('./updates-core');

const EVERY_MS = 6 * 3600 * 1000;

function createUpdates({ changed = () => {}, log = () => {}, beforeInstall = () => {} } = {}) {
  let state = { ...IDLE }, timer = null, updater = null, announced = null;
  const itself = updatesItself(process.platform);
  const apply = event => { state = nextState(state, event); changed(); };
  const tell = (title, body) => { try { if (Notification.isSupported()) new Notification({ title, body }).show(); } catch {} };

  function autoUpdater() {
    if (updater) return updater;
    ({ autoUpdater: updater } = require('electron-updater'));
    // Nothing is downloaded until the person clicks; after the download the app installs and restarts by itself.
    updater.autoDownload = false; updater.autoInstallOnAppQuit = false; updater.logger = { info: log, warn: log, error: log, debug() {} };
    updater.on('update-available', info => { apply({ type: 'available', version: info.version }); announce(info.version); });
    updater.on('update-not-available', () => apply({ type: 'none' }));
    updater.on('download-progress', progress => apply({ type: 'progress', percent: progress.percent }));
    updater.on('update-downloaded', () => {
      apply({ type: 'downloaded' });
      // A moment to show "Reiniciando…", then the installer takes over: silent, and the app opens again when it is done.
      setTimeout(() => { try { beforeInstall(); updater.quitAndInstall(true, true); } catch (error) { apply({ type: 'error', message: error?.message }); } }, 1200);
    });
    updater.on('error', error => { log('Atualização: ' + (error?.message || error)); apply({ type: 'error', message: error?.message }); });
    return updater;
  }
  const announce = version => { if (announced !== version) { announced = version; tell('Há uma versão nova do MyBots', `A versão ${version} está disponível. Abra o MyBots e clique em Atualizar.`); } };

  async function check() {
    if (state.phase === 'downloading' || state.phase === 'installing') return;
    try {
      if (itself) { await autoUpdater().checkForUpdates(); return; }
      const response = await fetch(`${FEED}/${feedFile(process.platform, process.arch)}`, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
      if (!response.ok) return;
      const version = feedVersion(await response.text());
      if (version && isNewer(version, app.getVersion())) { apply({ type: 'available', version }); announce(version); } else apply({ type: 'none' });
    } catch (error) { log('Atualização: ' + (error?.message || error)); }
  }

  /** The button: download and install by itself where the system lets it; otherwise the download page. */
  function install() {
    if (!itself) { shell.openExternal(RELEASE_PAGE); return; }
    if (state.phase !== 'available') return;
    apply({ type: 'start' });
    autoUpdater().downloadUpdate().catch(error => apply({ type: 'error', message: error?.message }));
  }

  return {
    start() { setTimeout(check, 20000).unref?.(); timer = setInterval(check, EVERY_MS); timer.unref?.(); },
    check, install,
    state: () => ({ ...state, current: app.getVersion(), mode: itself ? 'self' : 'manual' }),
    /** The tray's menu entry for the current state, or null. */
    menuItem() {
      if (state.phase === 'available') return { label: itself ? `Atualizar para a versão ${state.version}` : `Baixar a versão nova (${state.version})`, click: install };
      if (state.phase === 'downloading') return { label: `Baixando a versão ${state.version}… ${state.percent}%`, enabled: false };
      if (state.phase === 'installing') return { label: 'Instalando e reiniciando…', enabled: false };
      return null;
    }
  };
}
module.exports = { createUpdates };
