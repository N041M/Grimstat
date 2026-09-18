/**
 * The server, end to end, on Node's own SQLite. Every request goes through the routes as a browser
 * would send it, with a fixed clock and a mailer that keeps the message instead of sending it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { SYNC_MAX_ACCOUNT_BYTES, SYNC_PAGE } from "@grimstat/schema";
import { createApp, nextReset } from "./app";
import { LIMIT_PER_DAY, LIMIT_PER_EMAIL } from "./auth";
import { byteLength } from "./codec";
import { sqliteDb, type Db } from "./db";
import type { Deps } from "./deps";
import { memoryLimiter, noLimiter, RATE_LIMITS, type RateLimiter } from "./limits";
import { ANON_LIMIT_PER_DAY } from "./links";
import { migrate } from "./node";
import { compressPlainRows, purge } from "./purge";
import { MAX_WRITES_PER_DAY } from "./sync";

const APP = "https://grimstat.test";

interface Harness {
  deps: Deps;
  app: ReturnType<typeof createApp>;
  mail: Array<{ to: string; text: string }>;
  clock: { now: Date };
  json<T = unknown>(method: string, path: string, body?: unknown, token?: string, headers?: Record<string, string>): Promise<{ status: number; body: T }>;
  signIn(email: string, device?: string): Promise<string>;
}

/** The phone app's origin, as the Worker's configuration lists it. */
const PHONE = "https://localhost";

function harness(dbOverride?: (db: Db) => Db, limiter: RateLimiter = noLimiter, extraOrigins?: string[]): Harness {
  const sqlite = new DatabaseSync(":memory:");
  migrate(sqlite);
  const mail: Harness["mail"] = [];
  const clock = { now: new Date("2026-09-18T12:00:00.000Z") };
  const base = sqliteDb(sqlite);
  const deps: Deps = { db: dbOverride ? dbOverride(base) : base, mail: { send: async (to, _subject, text) => void mail.push({ to, text }) }, appUrl: APP, ipSalt: "salt", limiter, now: () => clock.now, ...(extraOrigins ? { extraOrigins } : {}) };
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
    // The account's total is of stored bytes. At the cap a body of any size is refused and nothing
    // is written, a deletion still goes through, and a smaller replacement fits.
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "x".repeat(3000))] }, token)).status).toBe(200);
    await h.deps.db.run("UPDATE users SET bytes = ?", SYNC_MAX_ACCOUNT_BYTES);
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r2")] }, token)).status).toBe(507);
    expect((await h.deps.db.all("SELECT id FROM records")).length).toBe(1);
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "x", "2026-09-18T12:01:00.000Z")] }, token)).status).toBe(200);
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: [{ store: "rosters", id: "r1", revision: 2, updatedAt: "2026-09-18T12:02:00.000Z", deletedAt: "2026-09-18T12:02:00.000Z" }] }, token)).status).toBe(200);
  });

  it("counts the account's size as bodies are written, replaced and deleted", async () => {
    const stored = async () => (await h.deps.db.first<{ n: number; kept: number }>("SELECT bytes AS n, (SELECT COALESCE(SUM(LENGTH(body_gz)), 0) FROM records) AS kept FROM users"))!;
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r1", "Первая"), roster("r2", Array.from({ length: 800 }, (_, i) => (i * 7919).toString(36)).join(" "))] }, token);
    const first = await stored();
    expect(first.n).toBe(first.kept);
    expect(first.n).toBeGreaterThan(500);
    // A replacement counts the difference, a tombstone frees the body, and a rejected change counts nothing.
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r2", "short", "2026-09-18T12:01:00.000Z"), { store: "rosters", id: "r1", revision: 2, updatedAt: "2026-09-18T12:01:00.000Z", deletedAt: "2026-09-18T12:01:00.000Z" }] }, token);
    const after = await stored();
    expect(after.n).toBe(after.kept);
    expect(after.n).toBeLessThan(first.n / 2);
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("r2", "y".repeat(5000), "2026-09-18T11:00:00.000Z")] }, token);
    expect((await stored()).n).toBe(after.n);
  });

  it("stores bodies compressed, reads rows written before as they are, and compresses them in the purge", async () => {
    const me = await h.json<{ session: { user: { id: string } } }>("GET", "/api/me", undefined, token);
    const uid = me.body.session.user.id;
    await h.json("PUT", "/api/me/handle", { handle: "bob" }, token);
    const legacy = JSON.stringify({ id: "old", name: "Old army", shared: true, units: [] });
    await h.deps.db.run("INSERT INTO records (user_id, store, id, seq, revision, updated_at, body, shared) VALUES (?, 'rosters', 'old', 1, 0, ?, ?, 1)", uid, NOW, legacy);
    await h.deps.db.run("UPDATE users SET seq = 1, bytes = ? WHERE id = ?", byteLength(legacy), uid);
    await h.json("POST", "/api/sync", { cursor: 0, changes: [roster("new", "New army")] }, token);

    const names = async () => (await h.json<{ changes: Array<{ body: { name: string } }> }>("POST", "/api/sync", { cursor: 0, changes: [] }, token)).body.changes.map((c) => c.body.name);
    const shown = async () => (await h.json<{ armies: Array<{ roster: { name: string } }> }>("GET", "/api/u/bob")).body.armies.map((a) => a.roster.name);
    const rows = async () => h.deps.db.all<{ id: string; body: string | null; gz: number | null }>("SELECT id, body, LENGTH(body_gz) AS gz FROM records ORDER BY id");
    expect(await names()).toEqual(["Old army", "New army"]);
    expect(await shown()).toEqual(["Old army"]);
    expect(await rows()).toEqual([
      { id: "new", body: null, gz: expect.any(Number) as number },
      { id: "old", body: legacy, gz: null },
    ]);

    expect(await compressPlainRows(h.deps)).toBe(1);
    expect(await compressPlainRows(h.deps)).toBe(0);
    expect((await rows()).map((r) => r.body)).toEqual([null, null]);
    const sizes = await h.deps.db.first<{ counted: number; kept: number }>("SELECT bytes AS counted, (SELECT SUM(LENGTH(body_gz)) FROM records) AS kept FROM users");
    expect(sizes!.counted).toBe(sizes!.kept);
    expect(await names()).toEqual(["Old army", "New army"]);
    expect(await shown()).toEqual(["Old army"]);
  });

  it("stops an account after its daily allowance of changes, and resumes after the reset", async () => {
    const batch = (k: number) => Array.from({ length: 200 }, (_, i) => ({ store: "collection", id: `${k}-${i}`, revision: 0, updatedAt: NOW, body: { id: `${k}-${i}` } }));
    const rounds = MAX_WRITES_PER_DAY / 200;
    for (let k = 0; k < rounds; k++) expect((await h.json("POST", "/api/sync", { cursor: 0, changes: batch(k) }, token)).status).toBe(200);
    const over = await h.json<{ error: string; pausedUntil: string }>("POST", "/api/sync", { cursor: 0, changes: batch(rounds) }, token);
    expect(over.status).toBe(503);
    expect(over.body.pausedUntil).toBe("2026-09-19T00:00:00.000Z");
    expect((await h.deps.db.all("SELECT id FROM records")).length).toBe(MAX_WRITES_PER_DAY);
    // A pull still answers, and nothing was counted for the refused push.
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: [] }, token)).status).toBe(200);
    h.clock.now = new Date("2026-09-19T00:00:01.000Z");
    expect((await h.json("POST", "/api/sync", { cursor: 0, changes: batch(rounds).map((c) => ({ ...c, updatedAt: "2026-09-19T00:00:00.000Z" })) }, token)).status).toBe(200);
    expect((await h.deps.db.all("SELECT id FROM records")).length).toBe(MAX_WRITES_PER_DAY + 200);
  });

  it("fills the size counter for accounts that existed before it", async () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(readFileSync(join(dir, "0001_init.sql"), "utf8"));
    sqlite.prepare("INSERT INTO users (id, email, created_at) VALUES ('u1', 'a@example.com', ?)").run(NOW);
    const body = JSON.stringify({ id: "r", name: "Первая", shared: true });
    sqlite.prepare("INSERT INTO records (user_id, store, id, seq, revision, updated_at, body) VALUES ('u1', 'rosters', 'r', 1, 0, ?, ?)").run(NOW, body);
    sqlite.prepare("INSERT INTO records (user_id, store, id, seq, revision, updated_at, body) VALUES ('u1', 'rosters', 'p', 2, 0, ?, ?)").run(NOW, JSON.stringify({ id: "p", shared: false }));
    sqlite.prepare("INSERT INTO records (user_id, store, id, seq, revision, updated_at, deleted_at) VALUES ('u1', 'rosters', 'gone', 3, 0, ?, ?)").run(NOW, NOW);
    sqlite.exec(readFileSync(join(dir, "0002_quotas.sql"), "utf8"));
    const user = sqlite.prepare("SELECT bytes, day_writes FROM users").get() as { bytes: number; day_writes: number };
    expect(user.bytes).toBe(byteLength(body) + byteLength(JSON.stringify({ id: "p", shared: false })));
    expect(user.day_writes).toBe(0);
    // The shared flag moves into its own column, since a compressed body cannot be read in SQL.
    sqlite.exec(readFileSync(join(dir, "0003_compress.sql"), "utf8"));
    expect(sqlite.prepare("SELECT id FROM records WHERE shared = 1").all()).toEqual([{ id: "r" }]);
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

  it("lets the phone app through, whose requests arrive from its own origin and marked cross-site", async () => {
    const headers = { origin: PHONE, "sec-fetch-site": "cross-site" };
    const without = harness();
    expect((await without.json("POST", "/api/auth/start", { email: "a@example.com" }, undefined, headers)).status).toBe(403);
    const h = harness(undefined, noLimiter, [PHONE]);
    const res = await h.app.request("/api/auth/start", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify({ email: "a@example.com" }) });
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBe(PHONE);
    // Another site is still refused, and is not named in the answer either.
    const other = await h.app.request("/api/auth/start", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example" }, body: JSON.stringify({ email: "a@example.com" }) });
    expect(other.status).toBe(403);
    expect(other.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers the phone app's preflight and nobody else's", async () => {
    const h = harness(undefined, noLimiter, [PHONE]);
    const ask = (origin: string) => h.app.request("/api/sync", { method: "OPTIONS", headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "authorization,content-type" } });
    const ours = await ask(PHONE);
    expect(ours.status).toBe(204);
    expect(ours.headers.get("access-control-allow-origin")).toBe(PHONE);
    expect(ours.headers.get("access-control-allow-methods")).toContain("POST");
    expect(ours.headers.get("access-control-allow-headers")).toContain("authorization");
    const theirs = await ask("https://evil.example");
    expect(theirs.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("tells the phone app where a short link goes, as JSON", async () => {
    const h = harness(undefined, noLimiter, [PHONE]);
    const made = await h.json<{ id: string }>("POST", "/api/links", { kind: "scenario", token: "abc" });
    const found = await h.json<{ url: string }>("GET", `/api/links/${made.body.id}`, undefined, undefined, { origin: PHONE });
    expect(found.status).toBe(200);
    expect(found.body.url).toBe(`${APP}/#s=abc`);
    expect((await h.json("GET", "/api/links/nothere1")).status).toBe(404);
  });

  it("stops an address that asks too often, per kind of request", async () => {
    const h = harness(undefined, memoryLimiter(() => h.clock.now.getTime()));
    for (let i = 0; i < RATE_LIMITS.auth.limit; i++) expect((await h.json("POST", "/api/auth/start", { email: `p${i}@example.com` })).status).toBe(200);
    expect((await h.json("POST", "/api/auth/start", { email: "z@example.com" })).status).toBe(429);
    // Another address is not affected, and a minute later the first is free again.
    expect((await h.json("POST", "/api/auth/start", { email: "z@example.com" }, undefined, { "cf-connecting-ip": "198.51.100.9" })).status).toBe(200);
    h.clock.now = new Date(h.clock.now.getTime() + 61_000);
    expect((await h.json("POST", "/api/auth/start", { email: "z@example.com" })).status).toBe(200);
    // The health check counts like any other request, so a loop on it is stopped too.
    for (let i = 0; i < RATE_LIMITS.api.limit; i++) expect((await h.json("GET", "/api/health")).status).toBe(200);
    expect((await h.json("GET", "/api/health")).status).toBe(429);
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
    const left = await h.json<{ changes: Array<{ body: { name: string } }> }>("POST", "/api/sync", { cursor: 0, changes: [] }, alice);
    expect(left.body.changes.map((c) => c.body.name)).toEqual(["alice's list"]);
    expect((await h.deps.db.all("SELECT id FROM records")).length).toBe(1);

    // A bearer token that is not a session's is nothing, however close it comes.
    for (const t of ["", "x", alice.slice(1), alice.toUpperCase(), `${alice}0`]) expect((await h.json("GET", "/api/me", undefined, t)).status).toBe(401);
  });
});

describe("handles and public pages", () => {
  it("takes a handle once, in lower case, and refuses one that is taken or malformed", async () => {
    const h = harness();
    const alice = await h.signIn("alice@example.com");
    const bob = await h.signIn("bob@example.com");
    expect((await h.json<{ handle: string }>("PUT", "/api/me/handle", { handle: "Alice-Plays" }, alice)).body.handle).toBe("alice-plays");
    expect((await h.json("PUT", "/api/me/handle", { handle: "ALICE-plays" }, bob)).status).toBe(409);
    for (const bad of ["ab", "-alice", "alice_", "a".repeat(21), "api", "www", "al ice"]) expect((await h.json("PUT", "/api/me/handle", { handle: bad }, alice)).status).toBe(400);
    // Keeping one's own handle is fine, and an empty one clears it.
    expect((await h.json("PUT", "/api/me/handle", { handle: "alice-plays" }, alice)).status).toBe(200);
    expect((await h.json<{ handle: null }>("PUT", "/api/me/handle", { handle: "" }, alice)).body.handle).toBeNull();
    expect((await h.json("PUT", "/api/me/handle", { handle: "alice-plays" }, bob)).status).toBe(200);
    expect((await h.json("PUT", "/api/me/handle", { handle: "x" }, undefined)).status).toBe(401);
  });

  it("lists only the shared armies, without the owner's notes, and 404s an unknown name", async () => {
    const h = harness();
    const alice = await h.signIn("alice@example.com");
    await h.json("PUT", "/api/me/handle", { handle: "alice" }, alice);
    const army = (id: string, shared: boolean, name: string) => ({ store: "rosters" as const, id, revision: 1, updatedAt: NOW, body: { id, name, shared, ownerId: "u_alice", notes: "secret plan", units: [{ id: "u1", datasheetId: "ds", notes: "hide", models: [] }] } });
    await h.json("POST", "/api/sync", { cursor: 0, changes: [army("r1", true, "Public one"), army("r2", false, "Private one"), army("r3", true, "Deleted one")] }, alice);
    await h.json("POST", "/api/sync", { cursor: 0, changes: [{ store: "rosters", id: "r3", updatedAt: "2026-09-18T12:01:00.000Z", deletedAt: "2026-09-18T12:01:00.000Z" }] }, alice);

    const page = await h.json<{ handle: string; armies: Array<{ roster: Record<string, unknown>; updatedAt: string }> }>("GET", "/api/u/Alice");
    expect(page.status).toBe(200);
    expect(page.body.handle).toBe("alice");
    expect(page.body.armies.map((a) => a.roster.name)).toEqual(["Public one"]);
    const shown = page.body.armies[0]!.roster;
    expect(shown.notes).toBeUndefined();
    expect(shown.ownerId).toBeUndefined();
    expect((shown.units as Array<Record<string, unknown>>)[0]!.notes).toBeUndefined();
    expect((shown.units as Array<Record<string, unknown>>)[0]!.datasheetId).toBe("ds");

    expect((await h.json("GET", "/api/u/nobody")).status).toBe(404);
    expect((await h.json("GET", "/api/u/bad%20name")).status).toBe(404);
    const redirect = await h.app.request("/u/Alice");
    expect(redirect.status).toBe(302);
    expect(redirect.headers.get("location")).toBe(`${APP}/#/u/alice`);
  });
});
