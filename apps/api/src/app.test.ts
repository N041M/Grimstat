/**
 * The server, end to end, on Node's own SQLite. Every request goes through the routes as a browser
 * would send it, with a fixed clock and a mailer that keeps the message instead of sending it.
 */
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import { SYNC_PAGE } from "@grimstat/schema";
import { createApp, nextReset } from "./app";
import { LIMIT_PER_DAY, LIMIT_PER_EMAIL } from "./auth";
import { sqliteDb, type Db } from "./db";
import type { Deps } from "./deps";
import { memoryLimiter, noLimiter, RATE_LIMITS, type RateLimiter } from "./limits";
import { ANON_LIMIT_PER_DAY } from "./links";
import { migrate } from "./node";
import { purge } from "./purge";

const APP = "https://grimstat.test";

interface Harness {
  deps: Deps;
  app: ReturnType<typeof createApp>;
  mail: Array<{ to: string; text: string }>;
  clock: { now: Date };
  json<T = unknown>(method: string, path: string, body?: unknown, token?: string, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
  signIn(email: string, device?: string): Promise<string>;
}

function harness(dbOverride?: (db: Db) => Db, limiter: RateLimiter = noLimiter): Harness {
  const sqlite = new DatabaseSync(":memory:");
  migrate(sqlite);
  const mail: Harness["mail"] = [];
  const clock = { now: new Date("2026-09-18T12:00:00.000Z") };
  const base = sqliteDb(sqlite);
  const deps: Deps = { db: dbOverride ? dbOverride(base) : base, mail: { send: async (to, _subject, text) => void mail.push({ to, text }) }, appUrl: APP, ipSalt: "salt", limiter, now: () => clock.now };
  const app = createApp(deps);
  const h: Harness = {
    deps,
    app,
    mail,
    clock,
    async json(method, path, body, token, headers = {}) {
      const res = await app.request(path, {
        method,
        headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.7", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: (text ? JSON.parse(text) : undefined) as never };
    },
    async signIn(email, device = "Test device") {
      const started = await h.json("POST", "/api/auth/start", { email });
      expect(started.status).toBe(200);
      const code = /code=([0-9a-f]+)/.exec(mail[mail.length - 1]!.text)![1]!;
      const finished = await h.json<{ token: string }>("POST", "/api/auth/finish", { code, device });
      expect(finished.status).toBe(200);
      return finished.body.token;
    },
  };
  return h;
}

const NOW = "2026-09-18T12:00:00.000Z";
const roster = (id: string, name = id, updatedAt = NOW) => ({ store: "rosters" as const, id, revision: 1, updatedAt, body: { id, name, units: [] } });

describe("signing in", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("mails a link, takes the code back once, and names the device", async () => {
    const token = await h.signIn("Player@Example.com", "Kitchen laptop");
    expect(h.mail[0]!.to).toBe("player@example.com");
    expect(h.mail[0]!.text).toContain(`${APP}/#/profile?code=`);
    const me = await h.json<{ session: { user: { email: string } }; devices: Array<{ deviceName: string; current: boolean }> }>("GET", "/api/me", undefined, token);
    expect(me.status).toBe(200);
    expect(me.body.session.user.email).toBe("player@example.com");
    expect(me.body.devices).toMatchObject([{ deviceName: "Kitchen laptop", current: true }]);

    // The same code a second time is refused.
    const code = /code=([0-9a-f]+)/.exec(h.mail[0]!.text)![1]!;
    expect((await h.json("POST", "/api/auth/finish", { code })).status).toBe(400);
  });

  it("refuses a code after fifteen minutes and a token after a year", async () => {
    await h.json("POST", "/api/auth/start", { email: "a@example.com" });
    const code = /code=([0-9a-f]+)/.exec(h.mail[0]!.text)![1]!;
    h.clock.now = new Date("2026-09-18T12:16:00.000Z");
    expect((await h.json("POST", "/api/auth/finish", { code })).status).toBe(400);

    h.clock.now = new Date(NOW);
    const token = await h.signIn("a@example.com");
    h.clock.now = new Date("2027-09-19T12:00:00.000Z");
    expect((await h.json("GET", "/api/me", undefined, token)).status).toBe(401);
  });

  it("is the same account on every device", async () => {
    const t1 = await h.signIn("a@example.com", "one");
    const t2 = await h.signIn("a@example.com", "two");
    const me = await h.json<{ session: { user: { id: string } }; devices: unknown[] }>("GET", "/api/me", undefined, t2);
    const other = await h.json<{ session: { user: { id: string } } }>("GET", "/api/me", undefined, t1);
    expect(me.body.session.user.id).toBe(other.body.session.user.id);
    expect(me.body.devices).toHaveLength(2);
  });

  it("stops after five emails an hour to one address, and ninety a day in all", async () => {
    for (let i = 0; i < LIMIT_PER_EMAIL; i++) expect((await h.json("POST", "/api/auth/start", { email: "a@example.com" })).status).toBe(200);
    expect((await h.json("POST", "/api/auth/start", { email: "a@example.com" })).status).toBe(429);
    h.clock.now = new Date("2026-09-18T13:01:00.000Z");
    expect((await h.json("POST", "/api/auth/start", { email: "a@example.com" })).status).toBe(200);

    for (let i = h.mail.length; i < LIMIT_PER_DAY; i++) {
      // A different address and a different network each time, so only the daily total counts.
      expect((await h.json("POST", "/api/auth/start", { email: `p${i}@example.com` }, undefined, { "cf-connecting-ip": `198.51.100.${i % 250}` })).status).toBe(200);
    }
    expect((await h.json("POST", "/api/auth/start", { email: "z@example.com" }, undefined, { "cf-connecting-ip": "192.0.2.1" })).status).toBe(503);
  });

  it("signs one device out, and deletes the whole account", async () => {
    const t1 = await h.signIn("a@example.com", "one");
    const t2 = await h.signIn("a@example.com", "two");
    const me = await h.json<{ devices: Array<{ id: string; current: boolean }> }>("GET", "/api/me", undefined, t1);
    const other = me.body.devices.find((d) => !d.current)!;
    expect((await h.json("DELETE", `/api/sessions/${other.id}`, undefined, t1)).status).toBe(200);
    expect((await h.json("GET", "/api/me", undefined, t2)).status).toBe(401);
    expect((await h.json("GET", "/api/me", undefined, t1)).status).toBe(200);

    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r1")] }, t1);
    expect((await h.json("DELETE", "/api/me", undefined, t1)).status).toBe(200);
    expect((await h.json("GET", "/api/me", undefined, t1)).status).toBe(401);
    expect(await h.deps.db.all("SELECT * FROM records")).toEqual([]);
    expect(await h.deps.db.all("SELECT * FROM users")).toEqual([]);
  });
});

describe("sync", () => {
  let h: Harness;
  let token: string;
  beforeEach(async () => {
    h = harness();
    token = await h.signIn("a@example.com");
  });

  it("needs a session and a request it understands", async () => {
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: [] })).status).toBe(401);
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: [{ store: "snapshots", id: "x", updatedAt: NOW, body: {} }] }, token)).status).toBe(400);
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: [{ store: "rosters", id: "x", updatedAt: NOW }] }, token)).status).toBe(400);
  });

  it("applies a push, and a second device pulls it", async () => {
    const first = await h.json<{ cursor: number; applied: unknown[]; changes: unknown[] }>("POST", "/api/sync", { cursor: 0, changes: [roster("r1"), roster("r2")] }, token);
    expect(first.status).toBe(200);
    expect(first.body.applied).toEqual([
      { store: "rosters", id: "r1" },
      { store: "rosters", id: "r2" },
    ]);
    expect(first.body.cursor).toBe(2);
    expect(first.body.changes).toHaveLength(2);

    const second = await h.signIn("a@example.com", "two");
    const pulled = await h.json<{ cursor: number; changes: Array<{ id: string; body: { name: string } }>; more: boolean }>("POST", "/api/sync", { cursor: 0, changes: [] }, second);
    expect(pulled.body.changes.map((c) => c.id)).toEqual(["r1", "r2"]);
    expect(pulled.body.cursor).toBe(2);
    expect(pulled.body.more).toBe(false);

    // Nothing new since: nothing comes back and the cursor stays.
    const again = await h.json<{ cursor: number; changes: unknown[] }>("POST", "/api/sync", { cursor: 2, changes: [] }, second);
    expect(again.body.changes).toEqual([]);
    expect(again.body.cursor).toBe(2);
  });

  it("keeps the later change and hands the earlier one its winner", async () => {
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "newer", "2026-09-18T11:30:00.000Z")] }, token);
    const res = await h.json<{ applied: unknown[]; rejected: Array<{ id: string; server: { body: { name: string } } }> }>("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "older", "2026-09-18T11:00:00.000Z")] }, token);
    expect(res.body.applied).toEqual([]);
    expect(res.body.rejected).toMatchObject([{ id: "r1", server: { body: { name: "newer" } } }]);

    const later = await h.json<{ applied: unknown[] }>("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "newest", "2026-09-18T11:45:00.000Z")] }, token);
    expect(later.body.applied).toEqual([{ store: "rosters", id: "r1" }]);
  });

  it("carries a deletion as a tombstone that competes like any change", async () => {
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r1")] }, token);
    const gone = await h.json<{ changes: Array<{ id: string; deletedAt?: string; body?: unknown }> }>("POST", "/api/sync", { cursor: 0, changes: [{ store: "rosters", id: "r1", updatedAt: "2026-09-18T12:01:00.000Z", deletedAt: "2026-09-18T12:01:00.000Z" }] }, token);
    expect(gone.body.changes).toMatchObject([{ id: "r1", deletedAt: "2026-09-18T12:01:00.000Z" }]);
    expect(gone.body.changes[0]!.body).toBeUndefined();
    // An edit from before the deletion loses to it.
    const stale = await h.json<{ rejected: unknown[] }>("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "late edit", "2026-09-18T12:00:30.000Z")] }, token);
    expect(stale.body.rejected).toHaveLength(1);
  });

  it("pulls its own clock forward when a device's is ahead", async () => {
    const res = await h.json<{ changes: Array<{ updatedAt: string }> }>("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "r1", "2026-09-18T13:00:00.000Z")] }, token);
    expect(res.body.changes[0]!.updatedAt).toBe(NOW);
    const near = await h.json<{ changes: Array<{ updatedAt: string }> }>("POST", "/api/sync", { cursor: 1, changes: [roster("r2", "r2", "2026-09-18T12:04:00.000Z")] }, token);
    expect(near.body.changes[0]!.updatedAt).toBe("2026-09-18T12:04:00.000Z");
  });

  it("compares times as times, whatever precision a device wrote them with", async () => {
    // Without fractions, "…:00Z" would sort after "…:00.999Z" as text. It is the earlier time.
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "later", "2026-09-18T11:00:00.999Z")] }, token);
    const res = await h.json<{ rejected: unknown[]; applied: unknown[] }>("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "earlier", "2026-09-18T11:00:00Z")] }, token);
    expect(res.body.applied).toEqual([]);
    expect(res.body.rejected).toHaveLength(1);
    const stored = await h.json<{ changes: Array<{ updatedAt: string }> }>("POST", "/api/sync", { cursor: 0, changes: [] }, token);
    expect(stored.body.changes[0]!.updatedAt).toBe("2026-09-18T11:00:00.999Z");
  });

  it("refuses a record over the size limit and an account over its total", async () => {
    const big = { store: "games", id: "g", revision: 0, updatedAt: NOW, body: { id: "g", log: "x".repeat(300 * 1024) } };
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: [big] }, token)).status).toBe(413);
    const changes = Array.from({ length: 90 }, (_, i) => ({ store: "games", id: `g${i}`, revision: 0, updatedAt: NOW, body: { id: `g${i}`, log: "x".repeat(240 * 1024) } }));
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes }, token)).status).toBe(507);
    expect(await h.deps.db.all("SELECT id FROM records")).toEqual([]);
  });

  it("pages a long pull", async () => {
    const changes = Array.from({ length: 200 }, (_, i) => ({ store: "collection", id: `c${i}`, revision: 0, updatedAt: NOW, body: { owned: i } }));
    for (let k = 0; k < 3; k++) await h.json("POST", "/api/sync", { cursor: 0, changes: changes.map((c) => ({ ...c, id: `${k}-${c.id}`, body: { ...c.body, id: `${k}-${c.id}` } })) }, token);
    const page = await h.json<{ cursor: number; changes: unknown[]; more: boolean }>("POST", "/api/sync", { cursor: 0, changes: [] }, token);
    expect(page.body.changes).toHaveLength(SYNC_PAGE);
    expect(page.body.more).toBe(true);
    const rest = await h.json<{ cursor: number; changes: unknown[]; more: boolean }>("POST", "/api/sync", { cursor: page.body.cursor, changes: [] }, token);
    expect(rest.body.changes).toHaveLength(600 - SYNC_PAGE);
    expect(rest.body.more).toBe(false);
    expect(rest.body.cursor).toBe(600);
  });

  it("answers a paused database with the time it resumes", async () => {
    const paused = harness((db) => ({ ...db, all: async () => Promise.reject(new Error("D1_ERROR: daily row read limit exceeded")) }));
    const t = await paused.signIn("p@example.com");
    const res = await paused.json<{ pausedUntil: string }>("POST", "/api/sync", { cursor: 0, changes: [] }, t);
    expect(res.status).toBe(503);
    expect(res.body.pausedUntil).toBe("2026-09-19T00:00:00.000Z");
    expect(nextReset(new Date("2026-12-31T23:59:59.000Z"))).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("short links", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("shortens a scenario link without an account and opens it for ninety days", async () => {
    const made = await h.json<{ id: string }>("POST", "/api/links", { kind: "scenario", token: "abc" });
    expect(made.status).toBe(200);
    expect(made.body.id).toMatch(/^[a-z0-9]{8}$/);
    const res = await h.app.request(`/l/${made.body.id}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${APP}/#s=abc`);
    h.clock.now = new Date("2026-12-18T12:00:01.000Z");
    expect((await h.app.request(`/l/${made.body.id}`)).status).toBe(404);
  });

  it("keeps a signed-in player's roster link for good", async () => {
    const token = await h.signIn("a@example.com");
    const made = await h.json<{ id: string }>("POST", "/api/links", { kind: "roster", token: "xyz" }, token);
    h.clock.now = new Date("2029-01-01T00:00:00.000Z");
    const res = await h.app.request(`/l/${made.body.id}`);
    expect(res.headers.get("location")).toBe(`${APP}/#/armies?r=xyz`);
    expect((await h.app.request("/l/nothere1")).status).toBe(404);
  });
});

describe("the gates in front of the routes", () => {
  it("refuses a state-changing request that a browser sends from another site", async () => {
    const h = harness();
    expect((await h.json("POST", "/api/auth/start", { email: "a@example.com" }, undefined, { origin: "https://evil.example" })).status).toBe(403);
    expect((await h.json("POST", "/api/auth/start", { email: "a@example.com" }, undefined, { "sec-fetch-site": "cross-site" })).status).toBe(403);
    expect((await h.json("POST", "/api/auth/start", { email: "a@example.com" }, undefined, { origin: APP, "sec-fetch-site": "same-origin" })).status).toBe(200);
    // A read from anywhere is fine; it needs a token to say anything.
    expect((await h.json("GET", "/api/health", undefined, undefined, { origin: "https://evil.example" })).status).toBe(200);
  });

  it("stops an address that asks too often, per kind of request", async () => {
    const h = harness(undefined, memoryLimiter(() => h.clock.now.getTime()));
    for (let i = 0; i < RATE_LIMITS.auth.limit; i++) expect((await h.json("POST", "/api/auth/start", { email: `p${i}@example.com` })).status).toBe(200);
    expect((await h.json("POST", "/api/auth/start", { email: "z@example.com" })).status).toBe(429);
    // Another address is not affected, and a minute later the first is free again.
    expect((await h.json("POST", "/api/auth/start", { email: "z@example.com" }, undefined, { "cf-connecting-ip": "198.51.100.9" })).status).toBe(200);
    h.clock.now = new Date(h.clock.now.getTime() + 61_000);
    expect((await h.json("POST", "/api/auth/start", { email: "z@example.com" })).status).toBe(200);
  });

  it("answers a body that is not JSON with a 400 rather than a server error", async () => {
    const h = harness();
    const res = await h.app.request("/api/auth/start", { method: "POST", headers: { "content-type": "application/json" }, body: "{email:" });
    expect(res.status).toBe(400);
  });

  it("refuses a body that is too large before reading it", async () => {
    const h = harness();
    const res = await h.app.request("/api/auth/start", { method: "POST", headers: { "content-type": "application/json", "content-length": String(10 * 1024) }, body: JSON.stringify({ email: "x".repeat(10 * 1024) }) });
    expect(res.status).toBe(413);
  });

  it("answers with headers that keep a response out of caches and frames", async () => {
    const h = harness();
    const res = await h.app.request("/api/health");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("no-referrer");
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
  });

  it("refuses a record whose body names a different id", async () => {
    const h = harness();
    const token = await h.signIn("a@example.com");
    const res = await h.json<{ issues: string[] }>("POST", "/api/sync", { cursor: 0, changes: [{ store: "rosters", id: "r1", updatedAt: NOW, body: { id: "r2", name: "x" } }] }, token);
    expect(res.status).toBe(400);
    const settings = await h.json("POST", "/api/sync", { cursor: 0, changes: [{ store: "settings", id: "data.fetch.wahapediaMirror", updatedAt: NOW, body: { key: "data.fetch.wahapediaMirror", value: "/w/" } }] }, token);
    expect(settings.status).toBe(200);
  });

  it("ends a session that has not been used for ninety days", async () => {
    const h = harness();
    const token = await h.signIn("a@example.com");
    h.clock.now = new Date("2026-12-10T12:00:00.000Z");
    expect((await h.json("GET", "/api/me", undefined, token)).status).toBe(200);
    h.clock.now = new Date("2027-03-15T12:00:00.000Z");
    expect((await h.json("GET", "/api/me", undefined, token)).status).toBe(401);
  });

  it("caps the links strangers can make in a day", async () => {
    const h = harness();
    for (let i = 0; i < ANON_LIMIT_PER_DAY; i++) await h.deps.db.run("INSERT INTO links (id, user_id, ip_hash, kind, body, created_at, expires_at) VALUES (?, NULL, 'x', 'scenario', 'b', ?, ?)", `l${i}`, NOW, "2027-01-01T00:00:00.000Z");
    expect((await h.json("POST", "/api/links", { kind: "scenario", token: "abc" })).status).toBe(503);
    const token = await h.signIn("a@example.com");
    expect((await h.json("POST", "/api/links", { kind: "scenario", token: "abc" }, token)).status).toBe(200);
  });
});

describe("the purge", () => {
  it("removes what has expired and keeps what is live", async () => {
    const h = harness();
    const live = await h.signIn("a@example.com", "live");
    await h.signIn("a@example.com", "idle");
    await h.json("POST", "/api/links", { kind: "scenario", token: "anon" });
    const kept = await h.json<{ id: string }>("POST", "/api/links", { kind: "roster", token: "mine" }, live);

    // Two days on: the codes are gone, the idle device is still within ninety days.
    h.clock.now = new Date("2026-09-20T12:00:00.000Z");
    await purge(h.deps);
    expect(await h.deps.db.all("SELECT * FROM logins")).toEqual([]);
    expect((await h.deps.db.all("SELECT * FROM sessions")).length).toBe(2);

    // The live device checks in in November. By January the idle one, last seen in September, and
    // the anonymous link, which lasted ninety days, are gone, and the live one is not.
    h.clock.now = new Date("2026-11-15T12:00:00.000Z");
    expect((await h.json("GET", "/api/me", undefined, live)).status).toBe(200);
    h.clock.now = new Date("2027-01-01T12:00:00.000Z");
    await purge(h.deps);
    expect((await h.deps.db.all<{ device_name: string }>("SELECT device_name FROM sessions")).map((r) => r.device_name)).toEqual(["live"]);
    expect((await h.deps.db.all<{ id: string }>("SELECT id FROM links")).map((r) => r.id)).toEqual([kept.body.id]);
  });

  it("lets a deletion's tombstone go after ninety days, and keeps a live record", async () => {
    const h = harness();
    const token = await h.signIn("a@example.com");
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("gone"), roster("kept")] }, token);
    await h.json("POST", "/api/sync", { cursor: 0, changes: [{ store: "rosters", id: "gone", updatedAt: "2026-09-18T12:01:00.000Z", deletedAt: "2026-09-18T12:01:00.000Z" }] }, token);
    h.clock.now = new Date("2026-12-01T12:00:00.000Z");
    await purge(h.deps);
    expect((await h.deps.db.all<{ id: string }>("SELECT id FROM records ORDER BY id")).map((r) => r.id)).toEqual(["gone", "kept"]);
    h.clock.now = new Date("2027-01-01T12:00:00.000Z");
    await purge(h.deps);
    expect((await h.deps.db.all<{ id: string }>("SELECT id FROM records")).map((r) => r.id)).toEqual(["kept"]);
  });
});

describe("one account cannot reach another's rows", () => {
  it("sees, changes, signs out and deletes only its own", async () => {
    const h = harness();
    const alice = await h.signIn("alice@example.com", "alice's laptop");
    const bob = await h.signIn("bob@example.com", "bob's phone");
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "alice's list")] }, alice);

    // Bob pulls everything and gets nothing of Alice's, and the same record id is his own row.
    const pulled = await h.json<{ changes: unknown[] }>("POST", "/api/sync", { cursor: 0, changes: [] }, bob);
    expect(pulled.body.changes).toEqual([]);
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "bob's list", "2027-01-01T00:00:00.000Z")] }, bob);
    const alices = await h.json<{ changes: Array<{ body: { name: string } }> }>("POST", "/api/sync", { cursor: 0, changes: [] }, alice);
    expect(alices.body.changes.map((c) => c.body.name)).toEqual(["alice's list"]);

    // Bob cannot sign Alice's device out by its id, and his account's deletion leaves hers whole.
    const me = await h.json<{ devices: Array<{ id: string }> }>("GET", "/api/me", undefined, alice);
    expect((await h.json("DELETE", `/api/sessions/${me.body.devices[0]!.id}`, undefined, bob)).status).toBe(200);
    expect((await h.json("GET", "/api/me", undefined, alice)).status).toBe(200);
    expect((await h.json("DELETE", "/api/me", undefined, bob)).status).toBe(200);
    expect((await h.json("GET", "/api/me", undefined, alice)).status).toBe(200);
    expect((await h.deps.db.all<{ name: string }>("SELECT json_extract(body, '$.name') AS name FROM records")).map((r) => r.name)).toEqual(["alice's list"]);

    // A bearer token that is not a session's is nothing, however close it comes.
    for (const t of ["", "x", alice.slice(1), alice.toUpperCase(), `${alice}0`]) expect((await h.json("GET", "/api/me", undefined, t)).status).toBe(401);
  });
});
