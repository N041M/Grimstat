import { useSyncExternalStore } from "react";

/**
 * What the service worker has to say to the shell.
 *
 * A new build takes over on its own and reloads the page onto it, so there is nothing to ask the
 * reader about and nothing here for it. What is left is `offlineReady`, which `main.tsx` feeds from
 * `registerSW` the first time the app is cached. Nothing reads it yet.
 */
export interface SwState {
  offlineReady: boolean;
}

let state: SwState = { offlineReady: false };
const listeners = new Set<() => void>();

export const swStore = {
  subscribe(l: () => void): () => void {
    listeners.add(l);
    return () => listeners.delete(l);
  },
  get(): SwState {
    return state;
  },
  offlineReady(): void {
    state = { ...state, offlineReady: true };
    listeners.forEach((l) => l());
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
