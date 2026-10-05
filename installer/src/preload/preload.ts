import { contextBridge, ipcRenderer } from 'electron';
import type { InstallerApi, Progress } from '../shared/api';

const api: InstallerApi = {
  info: () => ipcRenderer.invoke('info'),
  lookup: (input) => ipcRenderer.invoke('lookup', input),
  pickDir: (current) => ipcRenderer.invoke('pick-dir', current),
  install: (opts) => ipcRenderer.invoke('install', opts),
  cancel: () => ipcRenderer.invoke('cancel'),
  enrollFace: () => ipcRenderer.invoke('face:enroll'),
  cancelFace: () => ipcRenderer.invoke('face:cancel'),
  finishSetup: () => ipcRenderer.invoke('setup:finish'),
  launch: (dir) => ipcRenderer.invoke('launch', dir),
  onProgress: (cb) => ipcRenderer.on('progress', (_e, p: Progress) => cb(p)),
  win: {
    minimize: () => void ipcRenderer.invoke('win:minimize'),
    close: () => void ipcRenderer.invoke('win:close'),
  },
};

contextBridge.exposeInMainWorld('installer', api);
