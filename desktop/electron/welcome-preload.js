// What the first-run assistant may ask of the window (nothing else of the system).
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('mybotsWelcome', {
  doctor: () => ipcRenderer.invoke('welcome:doctor'),
  pair: () => ipcRenderer.invoke('welcome:pair'),
  open: url => ipcRenderer.invoke('welcome:open', url),
  copy: text => ipcRenderer.invoke('welcome:copy', text),
  finish: () => ipcRenderer.invoke('welcome:finish'),
  info: () => ipcRenderer.invoke('welcome:info')
});
