/**
 * What the store remembers about its own changes, and what the v12 upgrade does to snapshot ids.
 *
 * These run the real store against an in-memory IndexedDB, because what is being tested is the
 * middleware under the tables and an upgrade over them, and neither exists in a stand-in.
 */
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { stableSnapshotId } from "@grimstat/snapshot";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import type { Roster } from "@grimstat/schema";
import { adoptLocalRecords, GrimstatDb, SETTING_ACTIVE_SNAPSHOT, setSetting, type PublishedListRecord } from "../db";
import { CORPUS_URL_SETTING } from "./corpusFetch";
import { WAHAPEDIA_MIRROR_SETTING } from "./importProgress";
import { setSyncOwner, SYNCED_SETTING_KEYS, untracked } from "./syncTracking";

const NOW = "2026-09-18T12:00:00.000Z";

function roster(id: string, snapshotId = "snap_000000000000"): Roster {
  return { id, name: id, gameSystemId: "wh40k-11e", snapshotId, factionId: "f", battleSize: "strike-force", pointsLimit: 2000, detachments: [], units: [], ownerId: "local", createdAt: NOW, updatedAt: NOW, revision: 0 };
}

let n = 0;
const open: GrimstatDb[] = [];
function fresh(): GrimstatDb {
  const db = new GrimstatDb(`tracking-test-${++n}`);
  open.push(db);
  return db;
}
afterEach(async () => {
  for (const db of open.splice(0)) await db.delete();
  setSyncOwner("local");
});

describe("the tracking middleware", () => {
  it("puts a changed record in the outbox and a deleted one among the tombstones", async () => {
    const db = fresh();
    await db.rosters.put(roster("r1"));
    expect(await db.outbox.toArray()).toMatchObject([{ store: "rosters", id: "r1" }]);

    await db.rosters.put({ ...roster("r1"), name: "again" });
    expect(await db.outbox.count()).toBe(1);

    await db.rosters.delete("r1");
    expect(await db.outbox.count()).toBe(0);
    expect(await db.tombstones.toArray()).toMatchObject([{ store: "rosters", id: "r1" }]);

    // Written again after a delete: the tombstone goes, the outbox row is back.
    await db.rosters.put(roster("r1"));
    expect(await db.tombstones.count()).toBe(0);
    expect(await db.outbox.count()).toBe(1);
  });

  it("records a delete made through a query, in the transaction the app opened", async () => {
    const db = fresh();
    await db.rosters.bulkPut([roster("a"), roster("b"), roster("c")]);
    await db.transaction("rw", db.rosters, db.rosterVersions, async () => {
      await db.rosters.where("name").anyOf(["a", "b"]).delete();
    });
    expect((await db.tombstones.toArray()).map((t) => t.id).sort()).toEqual(["a", "b"]);
    expect((await db.outbox.toArray()).map((o) => o.id)).toEqual(["c"]);
  });

  it("leaves a store that does not sync alone", async () => {
    const db = fresh();
    const snap = loadSyntheticSnapshot();
    await db.snapshots.put(snap);
    await db.rosterVersions.put({ id: "r:0", rosterId: "r", revision: 0, updatedAt: NOW, json: "{}" });
    expect(await db.outbox.count()).toBe(0);
    await db.snapshots.delete(snap.id);
    expect(await db.tombstones.count()).toBe(0);
  });

  it("carries only the settings that name where the app fetches from", async () => {
    const db = fresh();
    expect(SYNCED_SETTING_KEYS).toEqual(new Set([CORPUS_URL_SETTING, WAHAPEDIA_MIRROR_SETTING]));
    await db.settings.put({ key: SETTING_ACTIVE_SNAPSHOT, value: "snap_x" });
    await db.settings.put({ key: "tour.seen", value: true });
    expect(await db.outbox.count()).toBe(0);
    await db.settings.put({ key: WAHAPEDIA_MIRROR_SETTING, value: "https://example.invalid/w/" });
    expect(await db.outbox.toArray()).toMatchObject([{ store: "settings", id: WAHAPEDIA_MIRROR_SETTING }]);
    const rec = await db.settings.get(WAHAPEDIA_MIRROR_SETTING);
    expect(rec?.ownerId).toBe("local");
    expect(typeof rec?.updatedAt).toBe("string");
    const device = await db.settings.get(SETTING_ACTIVE_SNAPSHOT);
    expect(device?.ownerId).toBeUndefined();
  });

  it("carries a pasted list and not one a corpus refresh put there", async () => {
    const db = fresh();
    const base = { player: "p", faction: "f", text: "x", importedAt: NOW, source: { kind: "paste" } } as unknown as PublishedListRecord;
    await db.publishedLists.put({ ...base, id: "pl-corpus", origin: "corpus" });
    await db.publishedLists.put({ ...base, id: "pl-hand", origin: "hand" });
    await db.publishedLists.put({ ...base, id: "pl-old" });
    expect((await db.outbox.toArray()).map((o) => o.id).sort()).toEqual(["pl-hand", "pl-old"]);
    await db.publishedLists.bulkDelete(["pl-corpus", "pl-hand"]);
    expect((await db.tombstones.toArray()).map((t) => t.id)).toEqual(["pl-hand"]);
  });

  it("fills in the owner and the time on a record that arrived without them", async () => {
    const db = fresh();
    setSyncOwner("user-7");
    await db.collection.put({ id: "ds1", name: "n", factionId: "f", factionName: "F", owned: 3, painted: 1, updatedAt: NOW });
    expect(await db.collection.get("ds1")).toMatchObject({ ownerId: "user-7", updatedAt: NOW });
    await db.layouts.put({ id: "calculator", layout: [], hidden: [], updatedAt: "" });
    const layout = await db.layouts.get("calculator");
    expect(layout?.ownerId).toBe("user-7");
    expect(layout?.updatedAt).not.toBe("");
  });

  it("ignores what the sync layer writes for itself", async () => {
    const db = fresh();
    await untracked(db, [db.rosters, db.collection], async () => {
      await db.rosters.put(roster("from-server"));
      await db.rosters.delete("from-server");
      await db.collection.put({ id: "ds", name: "n", factionId: "f", factionName: "F", owned: 1, painted: 0, updatedAt: NOW });
    });
    expect(await db.outbox.count()).toBe(0);
    expect(await db.tombstones.count()).toBe(0);
    // And what it does not write for itself is tracked as before.
    await db.rosters.put(roster("mine"));
    expect(await db.outbox.count()).toBe(1);
  });

  it("stamps a setting written through the store's own helper", async () => {
    const db = fresh();
    void db;
    await setSetting("tour.seen", true);
    // The helper writes to the shared store, which is a different database from `db`.
    const { db: shared } = await import("../db");
    const rec = await shared.settings.get("tour.seen");
    expect(typeof rec?.updatedAt).toBe("string");
    await shared.settings.delete("tour.seen");
  });
});

describe("adopting the records written before there was an account", () => {
  it("gives every unowned record to the account and puts each in the outbox", async () => {
    const db = fresh();
    await db.rosters.bulkPut([roster("a"), { ...roster("b"), ownerId: "user-1" }]);
    await db.collection.put({ id: "ds", name: "n", factionId: "f", factionName: "F", owned: 1, painted: 0, updatedAt: NOW });
    await db.settings.put({ key: "tour.seen", value: true });
    await db.outbox.clear();

    const claimed = await adoptLocalRecords("user-1", db);
    expect(claimed).toBe(2);
    expect((await db.rosters.get("a"))?.ownerId).toBe("user-1");
    expect((await db.collection.get("ds"))?.ownerId).toBe("user-1");
    expect((await db.settings.get("tour.seen"))?.ownerId).toBeUndefined();
    expect((await db.outbox.toArray()).map((o) => `${o.store}/${o.id}`).sort()).toEqual(["collection/ds", "rosters/a", "rosters/b"]);
  });
});

describe("the v12 upgrade", () => {
  /** A store as v11 left it, holding two dated ids for the same data and everything that named them. */
  async function storeAtV11(name: string): Promise<{ checksum: string; day1: string; day2: string }> {
    const old = new Dexie(name);
    old.version(11).stores({
      snapshots: "id, gameSystemId, updatedAt",
      scenarios: "id, name, updatedAt, snapshotId",
      layouts: "id",
      settings: "key",
      rosters: "id, name, factionId, snapshotId, updatedAt",
      rosterVersions: "id, rosterId, updatedAt",
      overrides: "&key, entity, id, updatedAt",
      terrainLayouts: "id, name, updatedAt",
      publishedLists: "id, faction, placing, importedAt",
      publishedResolved: "&key, snapshotId, recordId",
      games: "id, rosterId, updatedAt",
      unitPresets: "id, name, factionId, updatedAt",
      collection: "id, factionId, updatedAt",
      sourceFiles: "key, gameSystemId, adapter",
    });
    const snap = loadSyntheticSnapshot();
    const day1 = `snap_20260901_${snap.checksum.slice(0, 8)}`;
    const day2 = `snap_20260917_${snap.checksum.slice(0, 8)}`;
    await old.table("snapshots").bulkPut([
      { ...snap, id: day1, createdAt: "2026-09-01T00:00:00.000Z" },
      { ...snap, id: day2, createdAt: "2026-09-17T00:00:00.000Z" },
    ]);
    await old.table("rosters").put(roster("r-day1", day1));
    await old.table("rosters").put(roster("r-day2", day2));
    await old.table("rosterVersions").put({ id: "r-day1:0", rosterId: "r-day1", revision: 0, updatedAt: NOW, json: JSON.stringify(roster("r-day1", day1)) });
    await old.table("scenarios").put({ id: "s1", name: "s", snapshotId: day2, updatedAt: NOW });
    await old.table("unitPresets").put({ id: "p1", name: "p", snapshotId: day1, createdAt: NOW, updatedAt: NOW, unit: {} });
    await old.table("games").put({ id: "g1", snapshotId: day2, updatedAt: NOW, createdAt: NOW, ownerId: "local", revision: 0, name: "g", state: {}, log: [] });
    await old.table("settings").put({ key: SETTING_ACTIVE_SNAPSHOT, value: day2 });
    await old.table("publishedResolved").put({ key: `${day1}|pl`, snapshotId: day1, recordId: "pl", stamp: "x" });
    old.close();
    return { checksum: snap.checksum, day1, day2 };
  }

  it("keeps one snapshot under the checksum id and points everything at it", async () => {
    const name = `tracking-upgrade-${++n}`;
    const { checksum, day1, day2 } = await storeAtV11(name);
    const db = new GrimstatDb(name);
    open.push(db);
    const want = stableSnapshotId(checksum);

    expect((await db.snapshots.toArray()).map((s) => s.id)).toEqual([want]);
    expect((await db.rosters.get("r-day1"))?.snapshotId).toBe(want);
    expect((await db.rosters.get("r-day2"))?.snapshotId).toBe(want);
    expect(JSON.parse((await db.rosterVersions.get("r-day1:0"))!.json).snapshotId).toBe(want);
    expect((await db.scenarios.get("s1"))?.snapshotId).toBe(want);
    expect((await db.unitPresets.get("p1"))?.snapshotId).toBe(want);
    expect((await db.games.get("g1"))?.snapshotId).toBe(want);
    expect((await db.settings.get(SETTING_ACTIVE_SNAPSHOT))?.value).toBe(want);
    expect(await db.publishedResolved.count()).toBe(0);
    expect([day1, day2]).not.toContain(want);
    // An upgrade is not a change to send.
    expect(await db.outbox.count()).toBe(0);
  });
});
