// Looks for a new version when the window opens and every few hours. AppImage and Windows download it by themselves
// (electron-updater, from the public feed); .deb and macOS only tell the person, with the link.
const { app, Notification, shell } = require('electron');
const { FEED, RELEASE_PAGE, feedFile, feedVersion, isNewer, updatesItself } = require('./updates-core');

const EVERY_MS = 6 * 3600 * 1000;

function createUpdates({ changed = () => {}, log = () => {} } = {}) {
  // state: { phase: 'none' | 'available' | 'downloading' | 'ready', version }
  let state = { phase: 'none', version: null }, timer = null, updater = null, announced = null;
  const set = next => { state = next; changed(state); };
  const tell = (title, body) => { try { if (Notification.isSupported()) new Notification({ title, body }).show(); } catch {} };

  function autoUpdater() {
    if (updater) return updater;
    ({ autoUpdater: updater } = require('electron-updater'));
    updater.autoDownload = true; updater.autoInstallOnAppQuit = true; updater.logger = { info: log, warn: log, error: log, debug() {} };
    updater.on('update-available', info => set({ phase: 'downloading', version: info.version }));
    updater.on('update-downloaded', info => { set({ phase: 'ready', version: info.version }); if (announced !== info.version) { announced = info.version; tell('MyBots atualizado', `A versão ${info.version} está pronta. Ela entra quando você reiniciar o MyBots.`); } });
    updater.on('error', error => log('Atualização: ' + (error?.message || error)));
    return updater;
  }

  async function check() {
    try {
      if (updatesItself(process.platform)) { await autoUpdater().checkForUpdates(); return; }
      const response = await fetch(`${FEED}/${feedFile(process.platform, process.arch)}`, { signal: AbortSignal.timeout(15000), redirect: 'follow' });
      if (!response.ok) return;
      const version = feedVersion(await response.text());
      if (version && isNewer(version, app.getVersion())) {
        set({ phase: 'available', version });
        if (announced !== version) { announced = version; tell('Há uma versão nova do MyBots', `A versão ${version} está disponível. Clique em "Baixar a versão nova" no menu da bandeja.`); }
      } else set({ phase: 'none', version: null });
    } catch (error) { log('Atualização: ' + (error?.message || error)); }
  }

  return {
    start() { setTimeout(check, 20000).unref?.(); timer = setInterval(check, EVERY_MS); timer.unref?.(); },
    check, state: () => state,
    /** The tray's menu entry for the current state, or null. */
    menuItem() {
      if (state.phase === 'ready') return { label: `Reiniciar para atualizar (${state.version})`, click: () => { try { autoUpdater().quitAndInstall(); } catch { app.quit(); } } };
      if (state.phase === 'downloading') return { label: `Baixando a versão ${state.version}…`, enabled: false };
      if (state.phase === 'available') return { label: `Baixar a versão nova (${state.version})`, click: () => shell.openExternal(RELEASE_PAGE) };
      return null;
    }
  };
}
module.exports = { createUpdates };
