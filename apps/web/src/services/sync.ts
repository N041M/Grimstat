/**
 * Cross-device sync seam. Every feature works offline against IndexedDB; a future
 * server-backed implementation only adds replication. Local: no-op, "disabled".
 */
export type SyncStatus = "disabled" | "idle" | "syncing" | "error";

export interface SyncService {
  status(): SyncStatus;
  /** Push local changes (no-op locally). */
  push(): Promise<void>;
  /** Pull remote changes (no-op locally). */
  pull(): Promise<void>;
  subscribe(listener: (status: SyncStatus) => void): () => void;
}

export const localSync: SyncService = {
  status: () => "disabled",
  push: async () => undefined,
  pull: async () => undefined,
  subscribe: () => () => undefined,
};

let current: SyncService = localSync;
export function sync(): SyncService {
  return current;
}
export function setSyncService(s: SyncService): void {
  current = s;
}
