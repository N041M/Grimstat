import { useSyncExternalStore } from "react";

/**
 * What the service worker has to say to the shell: a new build is waiting, or the app has just
 * been cached for offline use. `main.tsx` feeds it from `registerSW`; `App` shows the banner.
 */
export interface SwState {
  needRefresh: boolean;
  offlineReady: boolean;
}

let state: SwState = { needRefresh: false, offlineReady: false };
let updater: ((reloadPage?: boolean) => Promise<void>) | undefined;
const listeners = new Set<() => void>();

function set(patch: Partial<SwState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export const swStore = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get(): SwState {
    return state;
  },
  needRefresh(): void {
    set({ needRefresh: true });
  },
  offlineReady(): void {
    set({ offlineReady: true });
  },
  dismiss(): void {
    set({ needRefresh: false, offlineReady: false });
  },
  setUpdater(fn: (reloadPage?: boolean) => Promise<void>): void {
    updater = fn;
  },
  /** Activate the waiting service worker and reload onto the new build. */
  async update(): Promise<void> {
    set({ needRefresh: false });
    await updater?.(true);
  },
};

export function useServiceWorker(): SwState {
  return useSyncExternalStore(swStore.subscribe, swStore.get, swStore.get);
}

function subscribeOnline(l: () => void): () => void {
  window.addEventListener("online", l);
  window.addEventListener("offline", l);
  return () => {
    window.removeEventListener("online", l);
    window.removeEventListener("offline", l);
  };
}
const readOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine);

/** `navigator.onLine`, kept current. */
export function useOnline(): boolean {
  return useSyncExternalStore(subscribeOnline, readOnline, () => true);
}
