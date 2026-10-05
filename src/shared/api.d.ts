export interface Repo {
  name: string;
  description: string | null;
  language: string | null;
  html_url: string;
  pushed_at: string;
  default_branch: string;
  private: boolean;
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

export interface Settings {
  githubUser: string;
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
    repos(): Promise<Repo[]>;
    commits(repo: string): Promise<Commit[]>;
    runs(repo: string): Promise<WorkflowRun[]>;
  };
  face: {
    status(): Promise<FaceStatus>;
    enroll(pin: string): Promise<FaceResult>;
    verify(): Promise<FaceResult>;
    unlockWithPin(pin: string): Promise<FaceResult>;
    remove(): Promise<void>;
  };
  update: {
    check(): Promise<void>;
    download(): Promise<void>;
    install(): Promise<void>;
    onStatus(cb: (s: UpdateStatus) => void): void;
  };
}
