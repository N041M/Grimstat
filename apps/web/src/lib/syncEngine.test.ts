/**
 * Two devices and one server. Each device is the app's real store on an in-memory IndexedDB, and
 * the server is the real API on Node's SQLite, called in-process as a browser would call it. What
 * is tested is the promise in docs/SYNC.md: what one device makes reaches the other, and nothing is
 * lost to a conflict.
 */
import "fake-indexeddb/auto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import type { Roster } from "@grimstat/schema";
import { createApp, noLimiter, sqliteDb, type Deps } from "@grimstat/api";
import { migrate } from "@grimstat/api/node";
import { GrimstatDb, type PublishedListRecord } from "../db";
import { clearSyncedStores, createAccount, holdsAnotherAccount, SignInDeclined } from "./accountService";
import { ApiError, readSession, type FetchLike } from "./account";
import { WAHAPEDIA_MIRROR_SETTING } from "./importProgress";
import { runSync } from "./syncEngine";
import { setSyncOwner } from "./syncTracking";

/**
 * Times are taken from the real clock, a minute back, because the store stamps a deletion with the
 * real clock and the server clamps anything more than five minutes ahead of its own. `at(-10)` is
 * ten minutes before that.
 */
const BASE = Date.now() - 60_000;
const at = (minutes: number): string => new Date(BASE + minutes * 60_000).toISOString();
const NOW = at(0);

function roster(id: string, name: string, updatedAt = NOW, revision = 0): Roster {
  return { id, name, gameSystemId: "wh40k-11e", snapshotId: "snap_000000000000", factionId: "f", battleSize: "strike-force", pointsLimit: 2000, detachments: [], units: [], ownerId: "local", createdAt: NOW, updatedAt, revision };
}

/** The server, and a fetch that reaches it. */
function server() {
  const sqlite = new DatabaseSync(":memory:");
  migrate(sqlite);
  const mail: string[] = [];
  const deps: Deps = { db: sqliteDb(sqlite), mail: { send: async (_to, _s, text) => void mail.push(text) }, appUrl: "https://grimstat.test", ipSalt: "salt", limiter: noLimiter, now: () => new Date() };
  const app = createApp(deps);
  const fetchImpl: FetchLike = async (input, init) => app.request(input, init);
  const signIn = async (email: string): Promise<string> => {
    await fetchImpl("/api/auth/start", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) });
    const code = /code=([a-z0-9-]+)/.exec(mail[mail.length - 1]!)![1]!;
    const res = await fetchImpl("/api/auth/finish", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code, device: "test" }) });
    return ((await res.json()) as { token: string }).token;
  };
  return { deps, app, fetchImpl, mail, signIn };
}

let n = 0;
const open: GrimstatDb[] = [];
function device(): GrimstatDb {
  const db = new GrimstatDb(`sync-engine-${++n}`);
  open.push(db);
  return db;
}
afterEach(async () => {
  for (const db of open.splice(0)) await db.delete();
  setSyncOwner("local");
});

describe("sync between two devices", () => {
  it("carries a list from one device to the other, and a deletion after it", async () => {
    const s = server();
    const token = await s.signIn("a@example.com");
    const a = device();
    const b = device();

    await a.rosters.put(roster("r1", "Crusade"));
    const first = await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    expect(first.sent).toBe(1);
    expect(await a.outbox.count()).toBe(0);

    const pulled = await runSync({ db: b, fetchImpl: s.fetchImpl, token });
    expect(pulled.received).toBe(1);
    expect((await b.rosters.get("r1"))?.name).toBe("Crusade");
    // What arrived by sync is not a change of this device's own.
    expect(await b.outbox.count()).toBe(0);

    await a.rosters.delete("r1");
    expect(await a.tombstones.count()).toBe(1);
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    expect(await a.tombstones.count()).toBe(0);
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });
    expect(await b.rosters.get("r1")).toBeUndefined();
  });

  it("keeps a device's own edit in the list's history when the server held something newer", async () => {
    const s = server();
    const token = await s.signIn("a@example.com");
    const a = device();
    const b = device();
    await a.rosters.put(roster("r1", "first", at(-30)));
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });

    // Both edit offline. A's edit is the later one and goes up first.
    await a.rosters.put(roster("r1", "edited on A", at(-10), 2));
    await b.rosters.put(roster("r1", "edited on B", at(-20), 1));
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    const result = await runSync({ db: b, fetchImpl: s.fetchImpl, token });

    expect(result.kept).toBe(1);
    expect((await b.rosters.get("r1"))?.name).toBe("edited on A");
    const kept = await b.rosterVersions.where("rosterId").equals("r1").toArray();
    expect(kept).toHaveLength(1);
    expect(kept[0]!.note).toBe("kept");
    expect((JSON.parse(kept[0]!.json) as Roster).name).toBe("edited on B");
    expect(await b.outbox.count()).toBe(0);
  });

  it("lets the later edit win when it goes up second", async () => {
    const s = server();
    const token = await s.signIn("a@example.com");
    const a = device();
    const b = device();
    await a.rosters.put(roster("r1", "first", at(-30)));
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });

    await a.rosters.put(roster("r1", "edited on A", at(-20), 1));
    await b.rosters.put(roster("r1", "edited on B", at(-10), 2));
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });
    expect((await b.rosters.get("r1"))?.name).toBe("edited on B");
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    expect((await a.rosters.get("r1"))?.name).toBe("edited on B");
  });

  it("does not overwrite a change made while a losing push was in flight", async () => {
    // The same promise as the test below, on the path where the server refuses the push. B's copy
    // loses to A's, and the server sends A's back — but the player on B has typed again since, so
    // B now holds the newest copy of all three and it must survive, outbox row and all.
    const s = server();
    const token = await s.signIn("a@example.com");
    const a = device();
    const b = device();
    await a.rosters.put(roster("r1", "edited on A", at(-10), 1));
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    await b.rosters.put(roster("r1", "stale on B", at(-20), 1));
    const slow: FetchLike = async (input, init) => {
      const res = await s.fetchImpl(input, init);
      await b.rosters.put(roster("r1", "typed just now on B", at(-1), 2));
      return res;
    };
    await runSync({ db: b, fetchImpl: slow, token });
    expect((await b.rosters.get("r1"))?.name).toBe("typed just now on B");
    expect(await b.outbox.count()).toBe(1);
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    expect((await a.rosters.get("r1"))?.name).toBe("typed just now on B");
  });

  it("sets aside a record the server will not read rather than blocking the ones behind it", async () => {
    const s = server();
    const token = await s.signIn("a@example.com");
    const a = device();
    // A backup import writes a date the server's schema refuses. Before, the whole batch was
    // refused with it, every round, and nothing on the device ever synced again.
    await a.rosters.put(roster("good", "readable", at(-2)));
    await a.rosters.put({ ...roster("bad", "unreadable", at(-2)), updatedAt: "2026-09-01" } as never);
    const round = await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    expect(round.skipped).toBe(1);
    expect(await a.outbox.count()).toBe(0);
    const b = device();
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });
    expect((await b.rosters.get("good"))?.name).toBe("readable");
    expect(await b.rosters.get("bad")).toBeUndefined();
  });

  it("does not overwrite a change made while the request was in flight", async () => {
    const s = server();
    const token = await s.signIn("a@example.com");
    const a = device();
    await a.rosters.put(roster("r1", "one", at(-2)));
    // The outbox row is replaced by a newer change between the read and the answer.
    const slow: FetchLike = async (input, init) => {
      const res = await s.fetchImpl(input, init);
      await a.rosters.put(roster("r1", "two", at(-1), 1));
      return res;
    };
    await runSync({ db: a, fetchImpl: slow, token });
    expect((await a.rosters.get("r1"))?.name).toBe("two");
    expect(await a.outbox.count()).toBe(1);
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    expect(await a.outbox.count()).toBe(0);
    const b = device();
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });
    expect((await b.rosters.get("r1"))?.name).toBe("two");
  });

  it("carries the fetch settings and leaves device state behind", async () => {
    const s = server();
    const token = await s.signIn("a@example.com");
    const a = device();
    const b = device();
    await a.settings.put({ key: WAHAPEDIA_MIRROR_SETTING, value: "https://example.invalid/w/" });
    await a.settings.put({ key: "tour.seen", value: true });
    await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });
    expect((await b.settings.get(WAHAPEDIA_MIRROR_SETTING))?.value).toBe("https://example.invalid/w/");
    expect(await b.settings.get("tour.seen")).toBeUndefined();
  });

  it("stops with the resume time when the server is paused", async () => {
    const a = device();
    const paused: FetchLike = async () => new Response(JSON.stringify({ error: "Sync is paused until the daily allowance resets.", pausedUntil: "2026-09-19T00:00:00.000Z" }), { status: 503, headers: { "content-type": "application/json" } });
    await a.rosters.put(roster("r1", "one"));
    await expect(runSync({ db: a, fetchImpl: paused, token: "t" })).rejects.toMatchObject({ status: 503, pausedUntil: "2026-09-19T00:00:00.000Z" });
    expect(await a.outbox.count()).toBe(1);
    try {
      await runSync({ db: a, fetchImpl: paused, token: "t" });
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
    }
  });
});

describe("a first sync with a lot to send", () => {
  it("cuts it into requests the server accepts, by size as well as count", async () => {
    const s = server();
    const token = await s.signIn("a@example.com");
    const a = device();
    // Sixty rosters of about 120 KB each is about 7 MB, over the 4 MB a request may carry.
    const pad = "x".repeat(120 * 1024);
    await a.rosters.bulkPut(Array.from({ length: 60 }, (_, i) => ({ ...roster(`r${i}`, `list ${i}`), notes: pad })));
    let requests = 0;
    const counting: FetchLike = (input, init) => {
      requests++;
      return s.fetchImpl(input, init);
    };
    const result = await runSync({ db: a, fetchImpl: counting, token });
    expect(result.sent).toBe(60);
    expect(result.skipped).toBe(0);
    expect(requests).toBeGreaterThanOrEqual(2);
    expect(await a.outbox.count()).toBe(0);
    const b = device();
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });
    expect(await b.rosters.count()).toBe(60);
  });

  it("sets aside a record the server refuses as too large, and sends the rest", async () => {
    const s = server();
    const token = await s.signIn("a@example.com");
    const a = device();
    await a.games.put({ id: "g-big", ownerId: "local", createdAt: NOW, updatedAt: NOW, revision: 0, name: "long game", state: {} as never, log: [{ note: "y".repeat(300 * 1024) }] as never });
    await a.rosters.put(roster("r1", "fine"));
    const result = await runSync({ db: a, fetchImpl: s.fetchImpl, token });
    expect(result.skipped).toBe(1);
    expect(result.sent).toBe(1);
    expect(await a.outbox.count()).toBe(0);
    expect(await a.games.get("g-big")).toBeDefined();
    const b = device();
    await runSync({ db: b, fetchImpl: s.fetchImpl, token });
    expect((await b.rosters.get("r1"))?.name).toBe("fine");
    expect(await b.games.get("g-big")).toBeUndefined();
  });
});

describe("replacing another account's records", () => {
  it("removes what an account carries and leaves the device's own state and the corpus", async () => {
    const a = device();
    await a.rosters.put({ ...roster("r1", "theirs"), ownerId: "u_other" });
    await a.settings.put({ key: WAHAPEDIA_MIRROR_SETTING, value: "https://example.invalid/w/" });
    await a.settings.put({ key: "activeSnapshotId", value: "snap_000000000000" });
    await a.settings.put({ key: "tour.seen", value: true });
    const list = { player: "p", faction: "f", text: "x", importedAt: NOW, source: { kind: "paste" } } as unknown as PublishedListRecord;
    await a.publishedLists.put({ ...list, id: "pl-corpus", origin: "corpus" });
    await a.publishedLists.put({ ...list, id: "pl-hand", origin: "hand" });
    await clearSyncedStores(a);
    expect(await a.rosters.count()).toBe(0);
    expect(await a.settings.get(WAHAPEDIA_MIRROR_SETTING)).toBeUndefined();
    expect((await a.settings.get("activeSnapshotId"))?.value).toBe("snap_000000000000");
    expect((await a.settings.get("tour.seen"))?.value).toBe(true);
    expect((await a.publishedLists.toArray()).map((l) => l.id)).toEqual(["pl-corpus"]);
    expect(await a.outbox.count()).toBe(0);
  });
});

describe("signing in on a device", () => {
  it("adopts what was made before, and syncs it", async () => {
    const s = server();
    const a = device();
    await a.rosters.put(roster("r1", "mine"));
    await a.collection.put({ id: "ds", name: "n", factionId: "f", factionName: "F", owned: 2, painted: 0, updatedAt: NOW });
    const account = createAccount({ db: a, fetchImpl: s.fetchImpl });
    await account.start("a@example.com");
    const code = /code=([a-z0-9-]+)/.exec(s.mail[0]!)![1]!;
    const user = await account.finish(code);
    expect(user.anonymous).toBe(false);
    expect(user.displayName).toBe("a@example.com");
    expect((await a.rosters.get("r1"))?.ownerId).toBe(user.id);
    expect((await readSession(a))?.user.email).toBe("a@example.com");
    // Everything adopted is waiting to go up, and the session itself is not among it.
    expect(await a.outbox.count()).toBe(2);
    await runSync({ db: a, fetchImpl: s.fetchImpl, token: (await readSession(a))!.token });
    expect(await a.outbox.count()).toBe(0);
    const b = device();
    await runSync({ db: b, fetchImpl: s.fetchImpl, token: (await readSession(a))!.token });
    expect((await b.rosters.get("r1"))?.ownerId).toBe(user.id);
    expect(await b.settings.get("account.session")).toBeUndefined();
  });

  it("refuses to sign into a second account over another's records unless told to replace them", async () => {
    const s = server();
    const a = device();
    await a.rosters.put({ ...roster("r1", "theirs"), ownerId: "u_someoneelse" });
    expect(await holdsAnotherAccount(a, "u_new")).toBe(true);
    expect(await holdsAnotherAccount(a, "u_someoneelse")).toBe(false);

    let answer = false;
    const account = createAccount({ db: a, fetchImpl: s.fetchImpl, askReplace: async () => answer });
    await account.start("b@example.com");
    const code = /code=([a-z0-9-]+)/.exec(s.mail[0]!)![1]!;
    await expect(account.finish(code)).rejects.toBeInstanceOf(SignInDeclined);
    expect((await a.rosters.get("r1"))?.name).toBe("theirs");

    answer = true;
    await account.start("b@example.com");
    const code2 = /code=([a-z0-9-]+)/.exec(s.mail[1]!)![1]!;
    await account.finish(code2);
    expect(await a.rosters.count()).toBe(0);
    expect(await a.outbox.count()).toBe(0);
  });
});
