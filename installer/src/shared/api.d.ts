export interface ReleaseInfo {
  version: string;
  sizeBytes: number;
}

export interface InstallOptions {
  dir: string;
  desktopShortcut: boolean;
  launchAfter: boolean;
}

export type Progress =
  | { phase: 'download'; percent: number; got: number; total: number; speed: number }
  | { phase: 'install' }
  | { phase: 'done'; dir: string }
  | { phase: 'cancelled' }
  | { phase: 'error'; message: string };

export interface InstallerApi {
  info(): Promise<{ defaultDir: string; release: ReleaseInfo | null; error?: string }>;
  pickDir(current: string): Promise<string | null>;
  install(opts: InstallOptions): Promise<void>;
  cancel(): Promise<void>;
  launch(dir: string): Promise<void>;
  onProgress(cb: (p: Progress) => void): void;
  win: { minimize(): void; close(): void };
}
