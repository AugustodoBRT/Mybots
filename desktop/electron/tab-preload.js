// The page object a Chrome has (Electron's is empty); part of presenting the window's browser as Chrome, at the person's request.
const { webFrame } = require('electron');
webFrame.executeJavaScript(`(() => {
  const t = performance.timeOrigin / 1000, chrome = window.chrome || {};
  Object.assign(chrome, {
    app: { isInstalled: false, InstallState: { DISABLED: 'disabled', INSTALLED: 'installed', NOT_INSTALLED: 'not_installed' }, RunningState: { CANNOT_RUN: 'cannot_run', READY_TO_RUN: 'ready_to_run', RUNNING: 'running' } },
    csi() { return { startE: Math.round(t * 1000), onloadT: Date.now(), pageT: performance.now(), tran: 15 }; },
    loadTimes() { return { requestTime: t, startLoadTime: t, commitLoadTime: t, finishDocumentLoadTime: 0, finishLoadTime: 0, firstPaintTime: 0, firstPaintAfterLoadTime: 0, navigationType: 'Other', wasFetchedViaSpdy: true, wasNpnNegotiated: true, npnNegotiatedProtocol: 'h2', wasAlternateProtocolAvailable: false, connectionInfo: 'h2' }; }
  });
  if (!window.chrome) window.chrome = chrome;
})();`).catch(error => console.error('preload chrome:', error.message));
