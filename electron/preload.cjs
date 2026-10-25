const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('imuseumNative', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scan: (root) => ipcRenderer.invoke('scan', root),
  cancelScan: () => ipcRenderer.send('scan-cancel'),
  onScanProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('scan-progress', handler);
    return () => ipcRenderer.off('scan-progress', handler);
  },
  recentFolders: () => ipcRenderer.invoke('recent-folders'),
  removeRecent: (root) => ipcRenderer.invoke('remove-recent', root),
  clearRecent: () => ipcRenderer.invoke('clear-recent'),
  saveThumb: (id, data, size) => ipcRenderer.send('save-thumb', id, data, size),
  reveal: (id) => ipcRenderer.send('reveal', id),
  cacheInfo: () => ipcRenderer.invoke('cache-info'),
  clearCache: () => ipcRenderer.invoke('clear-cache'),
  mediaBase: 'imuseum://app/',
});
