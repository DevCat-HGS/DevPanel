export interface ReleaseInfo {
  version: string;
  sizeBytes: number;
  channel: 'stable' | 'dev';
}

export interface GithubProfile {
  login: string;
  name: string | null;
  avatar: string;
  repos: number;
  followers: number;
  /** GitHub refused the lookup (rate limit): the typed name is used as-is. */
  unverified?: boolean;
}

export interface InstallOptions {
  dir: string;
  desktopShortcut: boolean;
  launchAfter: boolean;
  channel: 'stable' | 'dev';
  /** Omitted when the machine already has a configured account. */
  account?: { github: string; pin: string };
}

export type FaceState = 'preparing' | 'scanning';

export type Progress =
  | { phase: 'download'; percent: number; got: number; total: number; speed: number }
  | { phase: 'install' }
  | { phase: 'face' }
  | { phase: 'face-state'; state: FaceState; progress?: number; total?: number }
  | { phase: 'done'; dir: string }
  | { phase: 'cancelled' }
  | { phase: 'error'; message: string };

export interface InstallerApi {
  info(): Promise<{
    defaultDir: string;
    release: ReleaseInfo | null;
    error?: string;
    /** Account already configured on this machine (reinstall / update). */
    existing: { githubUser: string } | null;
    devOwners: string[];
  }>;
  lookup(input: string): Promise<GithubProfile>;
  pickDir(current: string): Promise<string | null>;
  install(opts: InstallOptions): Promise<void>;
  cancel(): Promise<void>;
  enrollFace(): Promise<{ ok: boolean; error?: string }>;
  cancelFace(): Promise<void>;
  /** Ends the setup without a face (user skipped or finished). */
  finishSetup(): Promise<void>;
  launch(dir: string): Promise<void>;
  onProgress(cb: (p: Progress) => void): void;
  win: { minimize(): void; close(): void };
}
