import type { DevPanelApi } from '../shared/api';

declare global {
  interface Window {
    devpanel: DevPanelApi;
  }
}

export {};
