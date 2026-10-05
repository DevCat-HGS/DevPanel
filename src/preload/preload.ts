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
    onPrompt: (cb) => ipcRenderer.on('face:prompt', (_e, p) => cb(p)),
    unlockWithPin: (pin) => ipcRenderer.invoke('face:pin', pin),
    remove: () => ipcRenderer.invoke('face:remove'),
  },
  app: {
    onHidden: (cb) => ipcRenderer.on('app:hidden', () => cb()),
    onCheckUpdates: (cb) => ipcRenderer.on('app:check-updates', () => cb()),
    onSettingsChanged: (cb) => ipcRenderer.on('app:settings-changed', () => cb()),
  },
  token: {
    status: () => ipcRenderer.invoke('token:status'),
    set: (t) => ipcRenderer.invoke('token:set', t),
    clear: () => ipcRenderer.invoke('token:clear'),
  },
  alerts: {
    check: () => ipcRenderer.invoke('alerts:check'),
    onFailure: (cb) => ipcRenderer.on('alert:failure', (_e, f) => cb(f)),
  },
  local: {
    list: () => ipcRenderer.invoke('local:list'),
    add: () => ipcRenderer.invoke('local:add'),
    remove: (p) => ipcRenderer.invoke('local:remove', p),
    git: (p, a) => ipcRenderer.invoke('local:git', p, a),
    run: (p, s) => ipcRenderer.invoke('local:run', p, s),
    stop: (id) => ipcRenderer.invoke('local:stop', id),
    open: (p, how) => ipcRenderer.invoke('local:open', p, how),
    onOutput: (cb) => ipcRenderer.on('local:output', (_e, m) => cb(m)),
    onExit: (cb) => ipcRenderer.on('local:exit', (_e, m) => cb(m)),
  },
  notes: { get: (v) => ipcRenderer.invoke('notes:get', v) },
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
