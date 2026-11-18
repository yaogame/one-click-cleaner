'use strict';
const { contextBridge, ipcRenderer } = require('electron');
const on = (ch) => (cb) => { const f = (e, d) => cb(d); ipcRenderer.on(ch, f); return () => ipcRenderer.removeListener(ch, f); };
contextBridge.exposeInMainWorld('api', {
  info: () => ipcRenderer.invoke('info'),
  scan: () => ipcRenderer.invoke('scan'),
  deepScan: (opts) => ipcRenderer.invoke('deep-scan', opts),
  deepAbort: () => ipcRenderer.invoke('deep-abort'),
  listDir: (dir) => ipcRenderer.invoke('list-dir', dir),
  reveal: (p) => ipcRenderer.invoke('reveal', p),
  openPath: (p) => ipcRenderer.invoke('open-path', p),
  trashPath: (p) => ipcRenderer.invoke('trash-path', p),
  clean: (ids, opts) => ipcRenderer.invoke('clean', ids, opts),
  diskUsage: () => ipcRenderer.invoke('disk-usage'),
  confirm: (msg, detail) => ipcRenderer.invoke('confirm', msg, detail),
  runTool: (id) => ipcRenderer.invoke('run-tool', id),
  relaunchAdmin: () => ipcRenderer.invoke('relaunch-admin'),
  onScanItem: on('scan-item'),
  onScanProgress: on('scan-progress'),
  onDeepProgress: on('deep-progress'),
  onCleanProgress: on('clean-progress'),
});
