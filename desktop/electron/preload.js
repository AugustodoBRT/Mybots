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
  thumb: id => ask('tabs:thumb', id)
});
