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
    commits: (repo, page) => ipcRenderer.invoke('github:commits', repo, page),
    runs: (repo) => ipcRenderer.invoke('github:runs', repo),
    items: (repo, kind, page) => ipcRenderer.invoke('github:items', repo, kind, page),
    rerun: (repo, runId) => ipcRenderer.invoke('github:rerun', repo, runId),
    failing: () => ipcRenderer.invoke('github:failing'),
    pulls: () => ipcRenderer.invoke('github:pulls'),
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
  claude: {
    run: (p, prompt, mode) => ipcRenderer.invoke('claude:run', p, prompt, mode),
    stop: (id) => ipcRenderer.invoke('claude:stop', id),
    onOutput: (cb) => ipcRenderer.on('claude:output', (_e, m) => cb(m)),
    onExit: (cb) => ipcRenderer.on('claude:exit', (_e, m) => cb(m)),
  },
  local: {
    list: () => ipcRenderer.invoke('local:list'),
    add: () => ipcRenderer.invoke('local:add'),
    remove: (p) => ipcRenderer.invoke('local:remove', p),
    git: (p, a) => ipcRenderer.invoke('local:git', p, a),
    run: (p, s) => ipcRenderer.invoke('local:run', p, s),
    recipe: (p, id) => ipcRenderer.invoke('local:recipe', p, id),
    branches: (p) => ipcRenderer.invoke('local:branches', p),
    checkout: (p, b) => ipcRenderer.invoke('local:checkout', p, b),
    commit: (p, m) => ipcRenderer.invoke('local:commit', p, m),
    push: (p) => ipcRenderer.invoke('local:push', p),
    l10n: (p) => ipcRenderer.invoke('local:l10n', p),
    secrets: (p) => ipcRenderer.invoke('local:secrets', p),
    stop: (id) => ipcRenderer.invoke('local:stop', id),
    open: (p, how) => ipcRenderer.invoke('local:open', p, how),
    onOutput: (cb) => ipcRenderer.on('local:output', (_e, m) => cb(m)),
    onExit: (cb) => ipcRenderer.on('local:exit', (_e, m) => cb(m)),
  },
  notes: { get: (v) => ipcRenderer.invoke('notes:get', v) },
  software: {
    detect: () => ipcRenderer.invoke('software:detect'),
    install: (id) => ipcRenderer.invoke('software:install', id),
    upgrade: (id) => ipcRenderer.invoke('software:upgrade', id),
    cancel: (id) => ipcRenderer.invoke('software:cancel', id),
    open: (id) => ipcRenderer.invoke('software:open', id),
    onStatus: (cb) => ipcRenderer.on('software:status', (_e, s) => cb(s)),
    onProgress: (cb) => ipcRenderer.on('software:progress', (_e, p) => cb(p)),
    onUpdate: (cb) => ipcRenderer.on('software:update', (_e, u) => cb(u)),
  },
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
