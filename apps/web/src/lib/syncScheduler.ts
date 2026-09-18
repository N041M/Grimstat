/**
 * When sync runs. Thirty seconds after the last change, when the tab is hidden, when the app opens,
 * when the tab comes back, when the network comes back, and every five minutes while the tab is
 * being looked at, so a change made on another device reaches an open tab without anyone touching
 * it. A paused sync waits for the reset and tries once then. A failed sync tries again after a
 * minute.
 *
 * This is the `SyncService` the shell reads. It owns no data; the engine does the work.
 */
import type { GrimstatDb } from "../db";
import type { SyncService, SyncState } from "../services/sync";
import { ApiError, runSync } from "./syncEngine";
import { OUTBOX_CHANGED } from "./syncTracking";
import { LAST_SYNC_SETTING, type FetchLike } from "./account";

export const SYNC_DEBOUNCE_MS = 30_000;
const RETRY_MS = 60_000;
/** How often an open, visible tab asks for what other devices sent. A dozen requests an hour. */
export const SYNC_POLL_MS = 5 * 60_000;

export interface SchedulerDeps {
  db: GrimstatDb;
  fetchImpl: FetchLike;
  token: () => string | undefined;
  now?: () => Date;
}

export function createSyncScheduler({ db, fetchImpl, token, now = () => new Date() }: SchedulerDeps): SyncService & { start(): void; stop(): void; idle(): Promise<void> } {
  let state: SyncState = { status: "idle" };
  const listeners = new Set<(s: SyncState) => void>();
  let timer: number | undefined;
  let poll: number | undefined;
  let running: Promise<void> | undefined;
  let again = false;

  const set = (next: Partial<SyncState>): void => {
    state = { ...state, ...next };
    listeners.forEach((l) => l(state));
  };

  const schedule = (ms: number): void => {
    if (typeof window === "undefined") return;
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => void run(), ms);
  };

  const run = async (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    const t = token();
    if (!t) return;
    // The resume timer can fire a few milliseconds before the reset it was set for.
    if (state.status === "paused" && state.pausedUntil && new Date(state.pausedUntil).getTime() - now().getTime() > 1000) return;
    if (typeof navigator !== "undefined" && !navigator.onLine) return;
    running = (async () => {
      set({ status: "syncing", error: undefined });
      try {
        await runSync({ db, fetchImpl, token: t, now });
        set({ status: "idle", lastSyncedAt: now().toISOString(), pausedUntil: undefined });
      } catch (e) {
        if (e instanceof ApiError && e.status === 503 && e.pausedUntil) {
          set({ status: "paused", pausedUntil: e.pausedUntil });
          schedule(Math.max(1000, new Date(e.pausedUntil).getTime() - now().getTime() + 1500));
        } else if (e instanceof ApiError && e.status === 401) {
          // The session is gone. The account layer signs the device out on its next look.
          set({ status: "error", error: e.message });
        } else {
          set({ status: "error", error: e instanceof Error ? e.message : String(e) });
          schedule(RETRY_MS);
        }
      } finally {
        running = undefined;
        if (again) {
          again = false;
          schedule(SYNC_DEBOUNCE_MS);
        }
      }
    })();
    return running;
  };

  const onOutbox = (): void => schedule(SYNC_DEBOUNCE_MS);
  const onVisibility = (): void => {
    if (typeof document === "undefined") return;
    if (document.hidden) void run();
    else schedule(0);
  };
  const onOnline = (): void => schedule(0);
  const onPoll = (): void => {
    if (typeof document !== "undefined" && document.hidden) return;
    void run();
  };

  return {
    state: () => state,
    syncNow: () => run(),
    /** Resolves once no round is in flight. For whoever is about to change the store's owner. */
    idle: () => running ?? Promise.resolve(),
    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    start() {
      if (typeof window === "undefined") return;
      void db.settings.get(LAST_SYNC_SETTING).then((r) => {
        if (typeof r?.value === "string") set({ lastSyncedAt: r.value });
      });
      window.addEventListener(OUTBOX_CHANGED, onOutbox);
      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("online", onOnline);
      poll = window.setInterval(onPoll, SYNC_POLL_MS);
      schedule(0);
    },
    stop() {
      if (typeof window === "undefined") return;
      window.removeEventListener(OUTBOX_CHANGED, onOutbox);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      if (timer !== undefined) window.clearTimeout(timer);
      timer = undefined;
      if (poll !== undefined) window.clearInterval(poll);
      poll = undefined;
      state = { status: "disabled" };
      listeners.forEach((l) => l(state));
    },
  };
}
