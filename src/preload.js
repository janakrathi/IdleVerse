const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saver', {
  onTrack: (fn) => ipcRenderer.on('track', (_e, d) => fn(d)),
  onPosition: (fn) => ipcRenderer.on('position', (_e, d) => fn(d)),
  onMode: (fn) => ipcRenderer.on('mode', (_e, d) => fn(d)),
  dismiss: () => ipcRenderer.send('dismiss'),
  set: (patch) => ipcRenderer.send('set', patch)
});
