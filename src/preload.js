const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('saver', {
  onTrack: (fn) => ipcRenderer.on('track', (_e, d) => fn(d)),
  onPosition: (fn) => ipcRenderer.on('position', (_e, d) => fn(d)),
  onMode: (fn) => ipcRenderer.on('mode', (_e, d) => fn(d)),
  dismiss: () => ipcRenderer.send('dismiss'),
  control: (action) => ipcRenderer.send('control', action),   // 'toggle' | 'next' | 'prev'
  set: (patch) => ipcRenderer.send('set', patch)
});
