import { contextBridge, ipcRenderer } from 'electron';
import type { DevPanelApi, UpdateStatus } from '../shared/api';

const api: DevPanelApi = {
  platform: 'desktop',
  version: () => ipcRenderer.invoke('app:version'),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },
  github: {
    lookup: (input) => ipcRenderer.invoke('github:lookup', input),
    repos: () => ipcRenderer.invoke('github:repos'),
    commits: (repo) => ipcRenderer.invoke('github:commits', repo),
    runs: (repo) => ipcRenderer.invoke('github:runs', repo),
  },
  face: {
    status: () => ipcRenderer.invoke('face:status'),
    setPin: (pin) => ipcRenderer.invoke('pin:set', pin),
    enroll: (pin) => ipcRenderer.invoke('face:enroll', pin),
    verify: () => ipcRenderer.invoke('face:verify'),
    unlockWithPin: (pin) => ipcRenderer.invoke('face:pin', pin),
    remove: () => ipcRenderer.invoke('face:remove'),
  },
  env: { check: () => ipcRenderer.invoke('env:check') },
  update: {
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    channel: () => ipcRenderer.invoke('update:channel'),
    onStatus: (cb) =>
      ipcRenderer.on('update:status', (_e, s: UpdateStatus) => cb(s)),
  },
};

contextBridge.exposeInMainWorld('devpanel', api);
