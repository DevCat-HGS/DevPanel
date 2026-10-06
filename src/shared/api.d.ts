export interface Repo {
  name: string;
  description: string | null;
  language: string | null;
  html_url: string;
  pushed_at: string;
  default_branch: string;
  private: boolean;
  archived?: boolean;
  license?: { spdx_id: string } | null;
  topics?: string[];
  open_issues_count?: number;
}

export interface Commit {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string;
}

export interface WorkflowRun {
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  updated_at: string;
}

export interface LocalProject {
  path: string;
  name: string;
  exists: boolean;
  isGit: boolean;
  /** npm scripts found in package.json. */
  scripts: string[];
  git?: { branch: string; upstream: string | null; ahead: number; behind: number; dirty: number };
  lastCommit?: { subject: string; when: string };
}

export interface CatalogCategory {
  id: string;
  name: string;
  icon: string;
}

export interface CatalogItem {
  id: string;
  name: string;
  category: string;
  /** 'web' = an online service (just a link); 'app' = software that can be installed. */
  kind: 'app' | 'web';
  url: string;
  /** simple-icons slug of the brand icon. */
  brand?: string;
  /** winget package id; without it the card opens the download page instead. */
  winget?: string;
  detect?: { cmd?: string; versionArgs?: string[]; paths?: string[] };
}

export interface Catalog {
  categories: CatalogCategory[];
  items: CatalogItem[];
}

export interface SoftwareStatus {
  id: string;
  installed: boolean;
  version?: string;
}

export interface SoftwareProgress {
  id: string;
  phase: 'start' | 'progress' | 'installing' | 'done' | 'error';
  /** 0-100 while downloading; absent when it cannot be measured. */
  percent?: number;
  message?: string;
}

export interface Settings {
  githubUser: string;
  /** true once the GitHub account, code and (optionally) face were set up. */
  onboarded: boolean;
  /** Notify (system notification) when a GitHub Actions run fails. */
  alertsEnabled: boolean;
  /** Closing the window keeps DevPanel running in the system tray. */
  closeToTray: boolean;
  openAtLogin: boolean;
  /** Absolute paths of local project folders added by the user. */
  localProjects: string[];
  lastSeenVersion: string;
  /** Interface language; 'auto' follows the system. */
  language: 'auto' | 'es' | 'en';
  /** Ask for a head turn when signing in with the face (anti-photo check). */
  faceLiveness: boolean;
}

export interface GithubProfile {
  login: string;
  name: string | null;
  avatar: string;
}

export interface FaceStatus {
  enrolled: boolean;
  pinSet: boolean;
}

export interface FaceResult {
  ok: boolean;
  error?: string;
  score?: number;
}

export type UpdateStatus =
  | { state: 'dev' }
  | { state: 'checking' }
  | { state: 'none' }
  | { state: 'available'; version: string; notes: string }
  | { state: 'downloading'; percent: number }
  | { state: 'ready'; version: string }
  | { state: 'error'; message: string };

export interface DevPanelApi {
  /** 'desktop' inside Electron, 'web' when served from Netlify/browser. */
  platform: 'desktop' | 'web';
  version(): Promise<string>;
  settings: {
    get(): Promise<Settings>;
    set(patch: Partial<Settings>): Promise<Settings>;
  };
  github: {
    /** Accepts a username, @user or a github.com link; resolves the real profile. */
    lookup(input: string): Promise<GithubProfile>;
    repos(): Promise<Repo[]>;
    commits(repo: string): Promise<Commit[]>;
    runs(repo: string): Promise<WorkflowRun[]>;
  };
  face: {
    status(): Promise<FaceStatus>;
    /** Sets the verification code (exactly 4 digits). */
    setPin(pin: string): Promise<FaceResult>;
    /** Registers the face; when `pin` is given it is saved first. */
    enroll(pin?: string): Promise<FaceResult>;
    verify(): Promise<FaceResult>;
    /** Live instructions during the anti-photo challenge. */
    onPrompt(cb: (p: { challenge?: 'left' | 'right'; prompt?: 'return' }) => void): void;
    unlockWithPin(pin: string): Promise<FaceResult>;
    remove(): Promise<void>;
  };
  app: {
    /** Fired when the window is hidden (tray / shortcut); the renderer re-locks. */
    onHidden(cb: () => void): void;
    onCheckUpdates(cb: () => void): void;
    onSettingsChanged(cb: () => void): void;
  };
  token: {
    status(): Promise<{ has: boolean; login?: string; limit?: number; remaining?: number }>;
    /** Validates the token against GitHub and stores it encrypted. */
    set(token: string): Promise<{ ok: boolean; login?: string; error?: string }>;
    clear(): Promise<void>;
  };
  alerts: {
    check(): Promise<void>;
    onFailure(cb: (f: { repo: string; url: string }) => void): void;
  };
  local: {
    list(): Promise<LocalProject[]>;
    /** Opens the folder picker and registers the project; null if cancelled. */
    add(): Promise<LocalProject[] | null>;
    remove(path: string): Promise<void>;
    git(path: string, action: 'fetch' | 'pull'): Promise<{ ok: boolean; output: string }>;
    run(path: string, script: string): Promise<{ id: number } | { error: string }>;
    stop(id: number): Promise<void>;
    open(path: string, how: 'folder' | 'code'): Promise<void>;
    onOutput(cb: (m: { id: number; stream: 'out' | 'err'; text: string }) => void): void;
    onExit(cb: (m: { id: number; code: number }) => void): void;
  };
  notes: {
    /** Release notes (markdown) of a version, or of the running one; null if none. */
    get(version?: string): Promise<string | null>;
  };
  software: {
    /** Detects what is installed; results also stream through onStatus as they are found. */
    detect(): Promise<SoftwareStatus[]>;
    /** Installs a catalog entry through winget (the renderer only ever sends the catalog id). */
    install(id: string): Promise<{ ok: boolean; error?: string }>;
    cancel(id: string): Promise<void>;
    /** Opens the entry's website / download page in the browser. */
    open(id: string): Promise<void>;
    onStatus(cb: (s: SoftwareStatus) => void): void;
    onProgress(cb: (p: SoftwareProgress) => void): void;
  };
  update: {
    check(): Promise<void>;
    download(): Promise<void>;
    install(): Promise<void>;
    /** Which release channel this build follows and whether this account may use it. */
    channel(): Promise<{ channel: 'stable' | 'dev'; allowed: boolean }>;
    onStatus(cb: (s: UpdateStatus) => void): void;
  };
}
