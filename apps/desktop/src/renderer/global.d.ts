import type { DdiApi } from '../shared/ipc';

declare global {
  interface Window {
    ddi: DdiApi;
  }
}
export {};
