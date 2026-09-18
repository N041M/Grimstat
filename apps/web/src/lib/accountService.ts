/**
 * The account on this device: the `AuthService` the app talks to, and the sync scheduler that
 * comes and goes with the session.
 *
 * On sign-in the records written before there was an account are adopted by it, and every one of
 * them enters the outbox, so the first sync carries everything. A device that already holds
 * another account's records asks first, through `askReplace`, and replaces them only on a yes.
 */
import { adoptLocalRecords, db, type GrimstatDb } from "../db";
import { LOCAL_USER, setAuthService, type AuthService, type DeviceInfo, type UserInfo } from "../services/auth";
import { localSync, setSyncService } from "../services/sync";
import { api, ApiError, CURSOR_SETTING, deviceName, readSession, userInfo, writeSession, type FetchLike, type MeResponse, type StoredSession } from "./account";
import { createSyncScheduler } from "./syncScheduler";
import { setSyncOwner, SYNCED, SYNCED_STORES, untracked } from "./syncTracking";

export interface AccountDeps {
  db?: GrimstatDb;
  fetchImpl?: FetchLike;
  /** Asked when this device holds another account's records. Resolves true to replace them. */
  askReplace?: () => Promise<boolean>;
}

export class SignInDeclined extends Error {
  constructor() {
    super("declined");
  }
}

/** Whether any synced record on this device belongs to an account other than `userId`. */
export async function holdsAnotherAccount(store: GrimstatDb, userId: string): Promise<boolean> {
  for (const name of SYNCED_STORES) {
    const other = await store
      .table(name)
      .filter((r: { ownerId?: string }) => !!r.ownerId && r.ownerId !== "local" && r.ownerId !== userId)
      .count();
    if (other > 0) return true;
  }
  return false;
}

/**
 * Remove every record an account carries, and the two tables sync keeps, without recording any of
 * it. Rows the account does not carry stay: device settings such as the active snapshot, and the
 * published lists a corpus refresh put there.
 */
export async function clearSyncedStores(store: GrimstatDb): Promise<void> {
  const tables = [...SYNCED_STORES.map((s) => store.table(s)), store.outbox, store.tombstones, store.rosterVersions];
  await untracked(store, tables, async () => {
    for (const name of SYNCED_STORES) {
      const own = SYNCED[name]!;
      await store
        .table(name)
        .filter((r: Record<string, unknown>) => own(r))
        .delete();
    }
    await store.outbox.clear();
    await store.tombstones.clear();
    await store.rosterVersions.clear();
  });
}

export function createAccount({ db: store = db, fetchImpl = (input, init) => fetch(input, init), askReplace = async () => false }: AccountDeps = {}): AuthService & { boot(): Promise<void> } {
  let session: StoredSession | undefined;
  let user: UserInfo = LOCAL_USER;
  const listeners = new Set<(u: UserInfo) => void>();
  let scheduler: ReturnType<typeof createSyncScheduler> | undefined;

  const become = (next: StoredSession | undefined): void => {
    session = next;
    user = next ? userInfo(next) : LOCAL_USER;
    setSyncOwner(next ? next.user.id : "local");
    scheduler?.stop();
    scheduler = undefined;
    if (next) {
      scheduler = createSyncScheduler({ db: store, fetchImpl, token: () => session?.token });
      setSyncService(scheduler);
      scheduler.start();
    } else {
      setSyncService(localSync);
    }
    listeners.forEach((l) => l(user));
  };

  const service: AuthService & { boot(): Promise<void> } = {
    currentUser: () => user,

    async boot() {
      const stored = await readSession(store);
      if (stored) become(stored);
    },

    async start(email) {
      await api(fetchImpl, "POST", "/api/auth/start", { email });
    },

    async finish(code) {
      const res = await api<{ token: string; session: { id: string; user: StoredSession["user"] } }>(fetchImpl, "POST", "/api/auth/finish", { code, device: deviceName() });
      const next: StoredSession = { token: res.token, sessionId: res.session.id, user: res.session.user };
      if (await holdsAnotherAccount(store, next.user.id)) {
        if (!(await askReplace())) {
          await api(fetchImpl, "POST", "/api/auth/signout", undefined, next.token).catch(() => undefined);
          throw new SignInDeclined();
        }
      }
      // Whatever the previous account's sync is doing stops here, and finishes, before the store
      // changes hands. Its session on the server goes too.
      const previous = session;
      scheduler?.stop();
      await scheduler?.idle();
      if (previous) void api(fetchImpl, "POST", "/api/auth/signout", undefined, previous.token).catch(() => undefined);
      if (previous && previous.user.id !== next.user.id) await clearSyncedStores(store);
      else if (await holdsAnotherAccount(store, next.user.id)) await clearSyncedStores(store);
      await untracked(store, [store.settings], async () => {
        await store.settings.delete(CURSOR_SETTING);
      });
      await adoptLocalRecords(next.user.id, store);
      await writeSession(next, store);
      become(next);
      return user;
    },

    async signOut() {
      const s = session;
      if (s) await api(fetchImpl, "POST", "/api/auth/signout", undefined, s.token).catch(() => undefined);
      await writeSession(undefined, store);
      become(undefined);
    },

    async devices() {
      if (!session) return [];
      try {
        const me = await api<MeResponse>(fetchImpl, "GET", "/api/me", undefined, session.token);
        return me.devices;
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          await writeSession(undefined, store);
          become(undefined);
          return [];
        }
        throw e;
      }
    },

    async signOutDevice(id: string) {
      if (!session) return;
      await api(fetchImpl, "DELETE", `/api/sessions/${encodeURIComponent(id)}`, undefined, session.token);
    },

    async setHandle(handle: string) {
      const s = session;
      if (!s) throw new Error("Sign in to choose a handle.");
      const res = await api<{ handle: string | null }>(fetchImpl, "PUT", "/api/me/handle", { handle }, s.token);
      const next: StoredSession = { ...s, user: { ...s.user, handle: res.handle } };
      await writeSession(next, store);
      session = next;
      user = userInfo(next);
      listeners.forEach((l) => l(user));
      return user;
    },

    async deleteAccount() {
      const s = session;
      if (!s) return;
      await api(fetchImpl, "DELETE", "/api/me", undefined, s.token);
      await writeSession(undefined, store);
      become(undefined);
    },

    subscribe(l) {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
  setAuthService(service);
  return service;
}

export type { DeviceInfo };
