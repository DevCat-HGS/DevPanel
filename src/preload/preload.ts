import { contextBridge, ipcRenderer } from 'electron';
import type { DevPanelApi, UpdateStatus } from '../shared/api';

const api: DevPanelApi = {
  version: () => ipcRenderer.invoke('app:version'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  github: {
    repos: () => ipcRenderer.invoke('github:repos'),
    commits: (repo) => ipcRenderer.invoke('github:commits', repo),
    runs: (repo) => ipcRenderer.invoke('github:runs', repo),
  },
  face: {
    status: () => ipcRenderer.invoke('face:status'),
    enroll: (pin) => ipcRenderer.invoke('face:enroll', pin),
    verify: () => ipcRenderer.invoke('face:verify'),
    unlockWithPin: (pin) => ipcRenderer.invoke('face:pin', pin),
    remove: () => ipcRenderer.invoke('face:remove'),
  },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) =>
      ipcRenderer.on('update:status', (_e, s: UpdateStatus) => cb(s)),
  },
};

contextBridge.exposeInMainWorld('devpanel', api);
