const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('imuseumNative', {
  pickFolder: () => ipcRenderer.invoke('pick-folder'),
  scan: (root, opts) => ipcRenderer.invoke('scan', root, opts),
  rescan: (root) => ipcRenderer.invoke('rescan', root),
  onRescanProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('rescan-progress', handler);
    return () => ipcRenderer.off('rescan-progress', handler);
  },
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
  appInfo: () => ipcRenderer.invoke('app-info'),
  checkUpdate: () => ipcRenderer.invoke('update-check'),
  downloadUpdate: () => ipcRenderer.invoke('update-download'),
  onUpdateProgress: (cb) => {
    const handler = (_e, p) => cb(p);
    ipcRenderer.on('update-progress', handler);
    return () => ipcRenderer.off('update-progress', handler);
  },
  installUpdate: () => ipcRenderer.send('update-install'),
  openReleases: () => ipcRenderer.send('open-releases'),
  mediaBase: 'imuseum://app/',
});
