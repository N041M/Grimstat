/**
 * What the store on this machine must never lose.
 *
 * These tests run the app's own store code against an in-memory stand-in for Dexie. The questions
 * they ask are which records a refresh removes and what a backup carries, and the store is what
 * answers both, so the store is the part that has to be there.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { CORPUS_FORMAT, CORPUS_VERSION, stringifyPublishedListsFile, type StoredPublishedList } from "@grimstat/adapters";
import { db, exportAll, importAll, putSourceFiles, readSourceFiles, rekeyBundle, SETTING_ACTIVE_SNAPSHOT, type ExportBundle, type GameRecord, type RosterVersionRecord } from "./db";
import { stableSnapshotId } from "@grimstat/snapshot";
import { importPastedList, listPublishedLists } from "./lib/publishedLists";
import { CorpusIncomplete, fetchPublishedCorpus, type FetchText } from "./lib/corpusFetch";

const { FakeDexie, resetTables } = vi.hoisted(() => {
  type Row = Record<string, unknown>;

  /** One object store. Only the calls `db.ts` and the modules under test make are here. */
  class FakeTable {
    readonly rows = new Map<string, Row>();
    constructor(
      readonly name: string,
      private readonly keyPath: string,
    ) {}
    private key(row: Row): string {
      return String(row[this.keyPath]);
    }
    async toArray(): Promise<Row[]> {
      return [...this.rows.values()];
    }
    async get(id: string): Promise<Row | undefined> {
      return this.rows.get(id);
    }
    async put(row: Row): Promise<void> {
      this.rows.set(this.key(row), row);
    }
    async delete(id: string): Promise<void> {
      this.rows.delete(id);
    }
    async clear(): Promise<void> {
      this.rows.clear();
    }
    async bulkGet(ids: readonly string[]): Promise<Array<Row | undefined>> {
      return ids.map((id) => this.rows.get(id));
    }
    async bulkPut(rows: readonly Row[]): Promise<void> {
      for (const row of rows) this.rows.set(this.key(row), row);
    }
    async bulkDelete(ids: readonly string[]): Promise<void> {
      for (const id of ids) this.rows.delete(id);
    }
    orderBy(field: string) {
      const sorted = [...this.rows.values()].sort((a, b) => String(a[field]).localeCompare(String(b[field])));
      return { toArray: async () => sorted, reverse: () => ({ toArray: async () => [...sorted].reverse() }) };
    }
    filter(match: (row: any) => boolean) {
      return { primaryKeys: async () => [...this.rows.values()].filter(match).map((row) => this.key(row)) };
    }
    where(field: string) {
      return {
        anyOf: (ids: readonly string[]) => ({
          delete: async () => {
            for (const [key, row] of [...this.rows]) if (ids.includes(String(row[field]))) this.rows.delete(key);
          },
        }),
      };
    }
  }

  const created: FakeTable[] = [];

  class FakeDexie {
    readonly tables = created;
    constructor(readonly name: string) {}
    /** The tracking middleware is registered here in the real store; this stand-in has no core to put it under. */
    use(): this {
      return this;
    }
    version(_n: number) {
      return {
        stores: (defs: Record<string, string>) => {
          for (const [store, spec] of Object.entries(defs)) {
            if ((this as any)[store]) continue;
            const table = new FakeTable(store, (spec.split(",")[0] ?? "id").trim().replace(/^[&*+]+/, ""));
            (this as any)[store] = table;
            created.push(table);
          }
          return { upgrade: () => undefined };
        },
      };
    }
    async transaction(...args: unknown[]): Promise<unknown> {
      return (args[args.length - 1] as () => Promise<unknown>)();
    }
  }

  return { FakeDexie, resetTables: () => created.forEach((t) => t.rows.clear()) };
});

vi.mock("dexie", () => ({ default: FakeDexie }));

/* ---- a corpus refresh -------------------------------------------------------------------------- */

const BASE = "https://example.invalid/corpus/";
const PUBLICATION = "miniheadquarters.com";

const listText = (n: number) => `Unit ${n} (${n * 10} points)\n• 1x thing\nOther (5 points)`;

const corpusList = (n: number): StoredPublishedList => ({
  heading: `Faction - ${n} Place`,
  player: `Player ${n}`,
  detachments: [],
  placing: n,
  listText: listText(n),
  source: { url: `https://${PUBLICATION}/x`, publication: PUBLICATION },
  importedAt: "2026-09-11T00:00:00.000Z",
});

/** An index naming one monthly file per list, each promising exactly the lists it holds. */
const indexFor = (months: readonly { month: string; lists: number }[]) => ({
  format: CORPUS_FORMAT,
  version: CORPUS_VERSION,
  generatedAt: "2026-09-11T01:00:00.000Z",
  source: { id: "minihq", name: "MiniHeadQuarters", url: `https://${PUBLICATION}`, publication: PUBLICATION, attribution: "Lists published on MiniHeadQuarters" },
  files: months.map((m) => ({ name: `lists-${m.month}.json`, month: m.month, lists: m.lists, tournaments: 1 })),
  tournaments: [],
});

const serving = (files: Record<string, string>): FetchText => {
  return async (url: string) => {
    const body = files[url];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, text: async () => body ?? "" };
  };
};

/** A corpus of two monthly files, one list each. */
const wholeCorpus = serving({
  [`${BASE}index.json`]: JSON.stringify(indexFor([{ month: "2026-09", lists: 1 }, { month: "2026-08", lists: 1 }])),
  [`${BASE}lists-2026-09.json`]: stringifyPublishedListsFile([corpusList(1)]),
  [`${BASE}lists-2026-08.json`]: stringifyPublishedListsFile([corpusList(2)]),
});

const headings = async () => (await listPublishedLists()).map((r) => r.heading).sort();

beforeEach(() => {
  resetTables();
});

describe("a corpus refresh", () => {
  it("leaves a list the user pasted in alone, even when it came from the same site", async () => {
    await importPastedList({ listText: listText(99), player: "Me", sourceUrl: `https://${PUBLICATION}/lists/mine` });
    expect(await headings()).toEqual(["Me"]);

    await fetchPublishedCorpus(BASE, {}, wholeCorpus);
    await fetchPublishedCorpus(BASE, {}, wholeCorpus);

    expect(await headings()).toEqual(["Faction - 1 Place", "Faction - 2 Place", "Me"]);
    expect((await listPublishedLists()).find((r) => r.heading === "Me")?.origin).toBe("hand");
  });

  it("takes out what its corpus no longer carries, and says how many", async () => {
    const first = await fetchPublishedCorpus(BASE, {}, wholeCorpus);
    expect(first).toMatchObject({ added: 2, found: 2, removed: 0 });

    const shrunk = serving({
      [`${BASE}index.json`]: JSON.stringify(indexFor([{ month: "2026-09", lists: 1 }])),
      [`${BASE}lists-2026-09.json`]: stringifyPublishedListsFile([corpusList(1)]),
    });
    const second = await fetchPublishedCorpus(BASE, {}, shrunk);

    expect(second).toMatchObject({ added: 0, found: 1, removed: 1 });
    expect(await headings()).toEqual(["Faction - 1 Place"]);
  });

  it("stores nothing and removes nothing when a monthly file did not arrive", async () => {
    await fetchPublishedCorpus(BASE, {}, wholeCorpus);
    const before = await headings();

    const oneFileGone = serving({
      [`${BASE}index.json`]: JSON.stringify(indexFor([{ month: "2026-09", lists: 1 }, { month: "2026-08", lists: 1 }])),
      [`${BASE}lists-2026-09.json`]: stringifyPublishedListsFile([corpusList(1)]),
    });

    await expect(fetchPublishedCorpus(BASE, {}, oneFileGone)).rejects.toBeInstanceOf(CorpusIncomplete);
    expect(await headings()).toEqual(before);
  });

  it("stores nothing when the files arrived but held fewer lists than the index named", async () => {
    await fetchPublishedCorpus(BASE, {}, wholeCorpus);
    const before = await headings();

    const shortFile = serving({
      [`${BASE}index.json`]: JSON.stringify(indexFor([{ month: "2026-09", lists: 9 }])),
      [`${BASE}lists-2026-09.json`]: stringifyPublishedListsFile([corpusList(1)]),
    });

    await expect(fetchPublishedCorpus(BASE, {}, shortFile)).rejects.toThrow(/8 of 9 lists/);
    expect(await headings()).toEqual(before);
  });
});

/* ---- the backup bundle ------------------------------------------------------------------------- */

const game = (id: string): GameRecord => ({
  id,
  ownerId: "local",
  createdAt: "2026-09-11T00:00:00.000Z",
  updatedAt: "2026-09-11T00:00:00.000Z",
  revision: 3,
  name: "Club night",
  state: { round: 2 } as unknown as GameRecord["state"],
  log: [],
});

const version = (id: string): RosterVersionRecord => ({ id, rosterId: "r1", revision: 4, updatedAt: "2026-09-11T00:00:00.000Z", json: '{"id":"r1"}' });

/* ---- the files each source was downloaded as --------------------------------------------------- */

describe("the downloaded files", () => {
  const files = { "meta.yaml": "version: 1", "orks.yaml": "units: []" };
  const rec = { gameSystemId: "wh40k-11e", adapter: "mfm-yaml", files, url: "https://mfm.test/", fetchedAt: "2026-09-13T00:00:00.000Z" };

  it("comes back with where it came from and when", async () => {
    expect(await putSourceFiles(rec)).toBe(true);
    const back = await readSourceFiles("wh40k-11e", "mfm-yaml");
    expect(back).toMatchObject({ url: "https://mfm.test/", fetchedAt: "2026-09-13T00:00:00.000Z", files });
  });

  it("keeps one record per source per game system", async () => {
    await putSourceFiles(rec);
    await putSourceFiles({ ...rec, url: "https://elsewhere.test/", fetchedAt: "2026-09-14T00:00:00.000Z", files: { "meta.yaml": "version: 2" } });
    await putSourceFiles({ ...rec, gameSystemId: "wh40k-10e" });
    expect(await db.sourceFiles.toArray()).toHaveLength(2);
    expect((await readSourceFiles("wh40k-11e", "mfm-yaml"))!.url).toBe("https://elsewhere.test/");
    expect((await readSourceFiles("wh40k-10e", "mfm-yaml"))!.url).toBe("https://mfm.test/");
  });

  it("is absent when a source has never been fetched, or has no files", async () => {
    expect(await readSourceFiles("wh40k-11e", "bsdata-json")).toBeUndefined();
    await putSourceFiles({ ...rec, adapter: "bsdata-json", files: {} });
    expect(await readSourceFiles("wh40k-11e", "bsdata-json")).toBeUndefined();
  });

  it("keeps nothing when the browser is out of room", async () => {
    // The snapshot is already stored by the time this is written, so a refusal costs the next fetch
    // a download rather than costing the import.
    const quota = Object.assign(new Error("quota"), { name: "QuotaExceededError" });
    vi.spyOn(db.sourceFiles, "put").mockRejectedValueOnce(quota);
    expect(await putSourceFiles(rec)).toBe(false);
    expect(await readSourceFiles("wh40k-11e", "mfm-yaml")).toBeUndefined();
  });
});

describe("the backup bundle", () => {
  it("gives a backup's dated snapshot ids the checksum id, and repoints what named them", async () => {
    const checksum = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789";
    const want = stableSnapshotId(checksum);
    const day1 = "snap_20260901_abcdef01";
    const day2 = "snap_20260917_abcdef01";
    const snap = (id: string) => ({ id, checksum, gameSystemId: "g", sources: [], conflicts: [], data: {}, ownerId: "local", createdAt: "x", updatedAt: "x", revision: 0 }) as unknown as ExportBundle["stores"]["snapshots"][number];
    const older: ExportBundle = {
      format: "grimstat-export",
      version: 1,
      exportedAt: "2026-09-17T00:00:00.000Z",
      stores: {
        snapshots: [snap(day1), snap(day2)],
        scenarios: [{ id: "s1", snapshotId: day2 } as never],
        layouts: [],
        settings: [{ key: SETTING_ACTIVE_SNAPSHOT, value: day1 }],
        rosters: [{ id: "r1", snapshotId: day1 } as never, { id: "r2", snapshotId: "snap_other" } as never],
        rosterVersions: [{ id: "r1:0", rosterId: "r1", revision: 0, updatedAt: "x", json: JSON.stringify({ id: "r1", snapshotId: day2 }) }],
        games: [{ id: "g1", snapshotId: day2 } as never],
        unitPresets: [{ id: "p1", snapshotId: day1 } as never],
      },
    };
    const out = rekeyBundle(older);
    expect(out.stores.snapshots.map((x) => x.id)).toEqual([want]);
    expect(out.stores.rosters!.map((r) => r.snapshotId)).toEqual([want, "snap_other"]);
    expect(out.stores.scenarios[0]!.snapshotId).toBe(want);
    expect(out.stores.games![0]!.snapshotId).toBe(want);
    expect(out.stores.unitPresets![0]!.snapshotId).toBe(want);
    expect(JSON.parse(out.stores.rosterVersions![0]!.json).snapshotId).toBe(want);
    expect(out.stores.settings[0]!.value).toBe(want);

    await importAll(older);
    expect((await db.snapshots.toArray()).map((x) => x.id)).toEqual([want]);
    expect((await db.rosters.get("r1"))?.snapshotId).toBe(want);

    // A bundle already on checksum ids is handed back untouched.
    const current = await exportAll();
    expect(rekeyBundle(current)).toBe(current);
  });


  it("never carries the device's session or its sync bookkeeping", async () => {
    await db.settings.bulkPut([
      { key: "account.session", value: { token: "secret" } },
      { key: "sync.cursor", value: 12 },
      { key: "data.fetch.wahapediaMirror", value: "/w/" },
    ]);
    const bundle = await exportAll();
    expect(bundle.stores.settings.map((s) => s.key)).toEqual(["data.fetch.wahapediaMirror"]);

    resetTables();
    await importAll({ ...bundle, stores: { ...bundle.stores, settings: [...bundle.stores.settings, { key: "account.session", value: { token: "planted" } }] } });
    expect(await db.settings.get("account.session")).toBeUndefined();
    expect((await db.settings.get("data.fetch.wahapediaMirror"))?.value).toBe("/w/");
  });


  it("carries every store but the ones the app can produce again", async () => {
    // `publishedResolved` is worked out from the lists and the snapshot. `sourceFiles` holds the
    // downloads the snapshots were built from, which are larger than everything else here. The
    // outbox and the tombstones are this device's account of what it has not sent yet.
    const derived = ["publishedResolved", "sourceFiles", "outbox", "tombstones"];
    const bundle = await exportAll();
    const carried = Object.keys(bundle.stores).sort();
    const stored = db.tables.map((t) => t.name).sort();
    expect(stored.filter((name) => !derived.includes(name))).toEqual(carried);
  });

  it("brings recorded games and army history back", async () => {
    await db.games.bulkPut([game("g1"), game("g2")]);
    await db.rosterVersions.bulkPut([version("r1:3"), version("r1:4")]);

    const bundle = await exportAll();
    expect(bundle.stores.games).toHaveLength(2);
    expect(bundle.stores.rosterVersions).toHaveLength(2);

    await db.games.clear();
    await db.rosterVersions.clear();
    const counts = await importAll(bundle);

    expect(counts).toMatchObject({ games: 2, rosterVersions: 2 });
    expect((await db.games.toArray()).map((g) => g.id).sort()).toEqual(["g1", "g2"]);
    expect((await db.rosterVersions.toArray()).map((v) => v.id).sort()).toEqual(["r1:3", "r1:4"]);
  });

  it("still imports a bundle made before games and army history were in one", async () => {
    const older: ExportBundle = { format: "grimstat-export", version: 1, exportedAt: "2026-01-01T00:00:00.000Z", stores: { snapshots: [], scenarios: [], layouts: [], settings: [{ key: "a", value: 1 }] } };
    const counts = await importAll(older);
    expect(counts).toMatchObject({ settings: 1, games: 0, rosterVersions: 0 });
  });
});
