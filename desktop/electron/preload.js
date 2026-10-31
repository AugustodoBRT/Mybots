// What the MyBots interface (served by the computer's node) may ask of the window: the real browser tabs it hosts.
const { contextBridge, ipcRenderer } = require('electron');
const ask = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('mybotsNative', {
  tabs: () => ask('tabs:list'),
  onTabs: callback => { const handler = (_event, state) => callback(state); ipcRenderer.on('tabs:state', handler); return () => ipcRenderer.removeListener('tabs:state', handler); },
  create: url => ask('tabs:create', url),
  activate: id => ask('tabs:activate', id),
  close: id => ask('tabs:close', id),
  go: (id, url) => ask('tabs:go', id, url),
  nav: (id, action) => ask('tabs:nav', id, action),
  // The area of the interface the browser fills (CSS pixels of the window), or null to hide it.
  place: rect => ask('tabs:place', rect),
  thumb: id => ask('tabs:thumb', id),
  // The bot's face over the page (a view of its own above the tabs): the interface shows it and receives what is typed in it.
  overlayShow: state => ask('overlay:show', state),
  overlayHide: () => ask('overlay:hide'),
  onOverlayMessage: callback => { const handler = (_event, text) => callback(text); ipcRenderer.on('overlay:message', handler); return () => ipcRenderer.removeListener('overlay:message', handler); },
  // The face's own page.
  onOverlayState: callback => { const handler = (_event, state) => callback(state); ipcRenderer.on('overlay:state', handler); return () => ipcRenderer.removeListener('overlay:state', handler); },
  overlayExpand: open => ask('overlay:expand', Boolean(open)),
  overlaySend: text => ask('overlay:send', text)
});
