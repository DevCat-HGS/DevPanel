import type { InstallerApi } from '../shared/api';

declare global {
  interface Window {
    installer: InstallerApi;
  }
}

export {};
