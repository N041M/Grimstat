/**
 * Cross-device sync seam. Every feature works offline against IndexedDB; the server-backed
 * implementation only adds replication. Local: no-op, "disabled".
 *
 * `paused` is the state the free hosting allowance puts sync in for the rest of a day. Everything
 * keeps working on the device, and sync resumes at `pausedUntil`.
 */
export type SyncStatus = "disabled" | "idle" | "syncing" | "paused" | "error";

export interface SyncState {
  status: SyncStatus;
  /** When the last sync finished, if one has. */
  lastSyncedAt?: string;
  /** When a paused sync resumes. */
  pausedUntil?: string;
  /** What went wrong, when the status is `error`. */
  error?: string;
}

export interface SyncService {
  state(): SyncState;
  /** Sync now rather than at the next scheduled moment. Resolves when the round is over. */
  syncNow(): Promise<void>;
  subscribe(listener: (s: SyncState) => void): () => void;
}

const DISABLED: SyncState = { status: "disabled" };

export const localSync: SyncService = {
  state: () => DISABLED,
  syncNow: async () => undefined,
  subscribe: () => () => undefined,
};

let current: SyncService = localSync;
let unsubscribe: () => void = () => undefined;
const listeners = new Set<(s: SyncState) => void>();

/**
 * The seam the app reads. The implementation behind it changes when an account signs in or out,
 * and a subscription taken here follows it across the change.
 */
const facade: SyncService = {
  state: () => current.state(),
  syncNow: () => current.syncNow(),
  subscribe(l) {
    listeners.add(l);
    return () => listeners.delete(l);
  },
};

export function sync(): SyncService {
  return facade;
}
export function setSyncService(s: SyncService): void {
  unsubscribe();
  current = s;
  unsubscribe = s.subscribe((state) => listeners.forEach((l) => l(state)));
  listeners.forEach((l) => l(s.state()));
}
