import Dexie, { type Table } from "dexie";
import type { Roster, Scenario, ScenarioUnit, Snapshot } from "@grimstat/schema";
import { publishedListKey, type StoredPublishedList } from "@grimstat/adapters";
import { fnv1a128, type OverrideRecord } from "./lib/overrides";
import type { ResolvedSummary } from "./lib/meta";
import type { GameState, LogEntry } from "./lib/game";
import type { Layout } from "react-grid-layout";

/** Persisted dashboard layout for one dashboard id (e.g. "calculator"). */
export interface DashboardLayoutRecord {
  id: string;
  layout: Layout[];
  hidden: string[];
  updatedAt: string;
}

export interface SettingRecord {
  key: string;
  value: unknown;
}

export const SETTING_ACTIVE_SNAPSHOT = "activeSnapshotId";

/** One autosaved revision of a roster (full JSON), kept for the History panel. */
export interface RosterVersionRecord {
  /** `${rosterId}:${revision}` */
  id: string;
  rosterId: string;
  revision: number;
  updatedAt: string;
  json: string;
}

/** Versions kept per roster; older ones are pruned on every save. */
export const ROSTER_VERSION_CAP = 30;

/**
 * A terrain layout the user built or imported.
 *
 * Stored as JSON rather than a structured table because a layout is one document that is always read
 * and written whole, and because the shape belongs to `@grimstat/board` — keeping it opaque here
 * means the board package can grow a field without a database migration.
 *
 * `source` records where an imported layout came from. This project ships none of its own beyond a
 * handful of generic ones, so knowing whose work a layout is matters.
 */
export interface TerrainLayoutRecord {
  id: string;
  name: string;
  updatedAt: string;
  json: string;
  source?: string;
}

/**
 * A published tournament list, as imported from a write-up or from the CLI's corpus file.
 *
 * The list stays as text: resolving it into units needs a snapshot, and a list resolved against the
 * snapshot of the day it was imported would go stale with the next points update. The id is a hash
 * of what identifies the list — player, placing and text — so importing the same write-up twice
 * stores it once.
 */
export interface PublishedListRecord extends StoredPublishedList {
  id: string;
  /**
   * Where the record came from. A corpus refresh replaces the lists it put here itself and leaves
   * everything else alone, so a list the user pasted in by hand survives a refresh of the corpus it
   * was published in.
   *
   * Records written before this field existed carry nothing, and a refresh never removes those. The
   * next refresh claims back the ones its corpus still carries. Nothing is indexed on the field, so
   * adding it needed no new store version.
   */
  origin?: "corpus" | "hand";
}

/**
 * The record id: a hash of what identifies a list, so importing it twice stores it once.
 *
 * The hash is 128 bits wide because it is the primary key of a table a relay's corpus fills. A
 * 32-bit hash collides at odds of one in four by fifty thousand lists, and a collision there is one
 * list quietly overwriting another. It lives here rather than beside the import code because the v9
 * migration re-keys the table with it.
 */
export const publishedListId = (list: StoredPublishedList): string => `pl-${fnv1a128(publishedListKey(list))}`;

/**
 * A published list resolved against one snapshot: the datasheets it holds and their points, which is
 * what the Meta tab needs. Written by the meta worker off the main thread, read by the tab, and
 * stamped with the snapshot's checksum (overrides included) so a changed snapshot resolves again.
 * Derived data: rebuilt on demand and never exported.
 */
export interface ResolvedListRecord extends ResolvedSummary {
  /** `${snapshotId}|${recordId}` */
  key: string;
  snapshotId: string;
  recordId: string;
  stamp: string;
}

/**
 * A game being played, or one that has been. The state and its log are stored whole: a game is
 * small, it is written a few times a minute at most, and keeping it in one record means a reload at
 * the table restores exactly what was on screen.
 */
export interface GameRecord {
  id: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  /** Name of the opponent or the event, whatever the player typed. */
  name: string;
  /** The army being played, when it came from the builder. */
  rosterId?: string;
  snapshotId?: string;
  state: GameState;
  log: LogEntry[];
}

/**
 * A unit the player configured once and wants back: a loadout, a model count, an attached leader.
 *
 * The unit is stored whole rather than as a reference to a datasheet, because the whole point of a
 * preset is the configuration — a reference would resolve back to the default loadout and lose it.
 * The datasheet it came from is recorded alongside, so a preset can still say where it is from,
 * be filtered by faction, and be checked against the sheet it claims to be.
 *
 * A preset made from a custom unit has no `datasheetId`, and that is a normal preset: hand-built
 * units are the ones most worth not typing twice.
 */
export interface UnitPresetRecord {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  unit: ScenarioUnit;
  /** The snapshot and datasheet it was configured against, when it came from data. */
  snapshotId?: string;
  datasheetId?: string;
  factionId?: string;
}

/**
 * One datasheet in the player's collection: the models of it they own, and how many are painted.
 *
 * Keyed by datasheet rather than by anything of its own, because that is the question a collection
 * answers — "how many of these do I have?" — and because it is what an army asks for. The name and
 * faction are copied in at the time of adding, so an entry still reads when the active snapshot is
 * one the datasheet has left, and changing data source does not empty the collection.
 */
export interface CollectionEntryRecord {
  /** The datasheet's id. One record per datasheet. */
  id: string;
  name: string;
  factionId: string;
  factionName: string;
  /** Models owned, and how many of those are painted. Painted is never more than owned. */
  owned: number;
  painted: number;
  updatedAt: string;
}

/**
 * The files one source was last downloaded as.
 *
 * Fetching a single source has to produce the same snapshot as fetching all of them, and the only
 * way to get every field from the source that owns it is to merge all the sources together. A
 * snapshot records which sources built it but not which of them supplied each field, so it cannot
 * stand in for the sources that are not being fetched. Keeping their files here means the merge can
 * run over all three every time.
 *
 * Where the files came from and when is recorded alongside. That is what says whether these are the
 * files a given snapshot was built from. A record whose `fetchedAt` and `url` match a snapshot's
 * entry for that source is the download that snapshot came out of.
 *
 * The store holds one record per source per game system and replaces it on every fetch, so it stays
 * a handful of records. It is left out of a backup. The files can be downloaded again, and they are
 * several times the size of everything else put together.
 */
export interface SourceFilesRecord {
  /** `${gameSystemId}|${adapter}` */
  key: string;
  gameSystemId: string;
  adapter: string;
  /** File name, as the adapter expects it, to file content. */
  files: Record<string, string>;
  url: string;
  ref?: string;
  /** The timestamp the parse was stamped with, which is what a snapshot's source list records. */
  fetchedAt: string;
}

export const sourceFilesKey = (gameSystemId: string, adapter: string): string => `${gameSystemId}|${adapter}`;

export type { OverrideRecord } from "./lib/overrides";
export { overrideKey } from "./lib/overrides";

export class GrimstatDb extends Dexie {
  snapshots!: Table<Snapshot, string>;
  scenarios!: Table<Scenario, string>;
  layouts!: Table<DashboardLayoutRecord, string>;
  settings!: Table<SettingRecord, string>;
  rosters!: Table<Roster, string>;
  rosterVersions!: Table<RosterVersionRecord, string>;
  overrides!: Table<OverrideRecord, string>;
  terrainLayouts!: Table<TerrainLayoutRecord, string>;
  publishedLists!: Table<PublishedListRecord, string>;
  publishedResolved!: Table<ResolvedListRecord, string>;
  games!: Table<GameRecord, string>;
  unitPresets!: Table<UnitPresetRecord, string>;
  collection!: Table<CollectionEntryRecord, string>;
  sourceFiles!: Table<SourceFilesRecord, string>;

  constructor(name = "grimstat") {
    super(name);
    this.version(1).stores({
      snapshots: "id, gameSystemId, updatedAt",
      scenarios: "id, name, updatedAt, snapshotId",
      layouts: "id",
      settings: "key",
    });
    // v2: army builder (Phase 4) — rosters + lightweight version history.
    this.version(2).stores({
      snapshots: "id, gameSystemId, updatedAt",
      scenarios: "id, name, updatedAt, snapshotId",
      layouts: "id",
      settings: "key",
      rosters: "id, name, factionId, snapshotId, updatedAt",
      rosterVersions: "id, rosterId, updatedAt",
    });
    // v3: hand-authored rules overrides applied on top of every snapshot.
    this.version(3).stores({
      snapshots: "id, gameSystemId, updatedAt",
      scenarios: "id, name, updatedAt, snapshotId",
      layouts: "id",
      settings: "key",
      rosters: "id, name, factionId, snapshotId, updatedAt",
      rosterVersions: "id, rosterId, updatedAt",
      overrides: "&key, entity, id, updatedAt",
    });
    // v4: terrain layouts for the battle table, built in the editor or imported.
    this.version(4).stores({
      snapshots: "id, gameSystemId, updatedAt",
      scenarios: "id, name, updatedAt, snapshotId",
      layouts: "id",
      settings: "key",
      rosters: "id, name, factionId, snapshotId, updatedAt",
      rosterVersions: "id, rosterId, updatedAt",
      overrides: "&key, entity, id, updatedAt",
      terrainLayouts: "id, name, updatedAt",
    });
    // v5: published tournament lists, kept as text with their provenance.
    this.version(5).stores({
      snapshots: "id, gameSystemId, updatedAt",
      scenarios: "id, name, updatedAt, snapshotId",
      layouts: "id",
      settings: "key",
      rosters: "id, name, factionId, snapshotId, updatedAt",
      rosterVersions: "id, rosterId, updatedAt",
      overrides: "&key, entity, id, updatedAt",
      terrainLayouts: "id, name, updatedAt",
      publishedLists: "id, faction, placing, importedAt",
    });
    // v6: published lists resolved per snapshot, so the Meta tab reads rather than parses.
    this.version(6).stores({
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
    });
    // v7: games in progress for the play assistant.
    this.version(7).stores({
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
    });
    // v8: unit presets — a configured unit saved by name for the picker and the analysis sets.
    this.version(8).stores({
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
    });
    // v9: wider published-list ids. The stores are unchanged; the records are re-keyed.
    this.version(9)
      .stores({
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
      })
      .upgrade(async (tx) => {
        // Every stored list keeps its content and takes the id the wider hash gives it. Two lists
        // never share a new id unless they already shared the old one, so the re-key is a straight
        // swap. The resolved summaries are keyed by the old ids and are derived data, so they go;
        // the Meta tab builds them again on its next run.
        const lists = tx.table<PublishedListRecord, string>("publishedLists");
        const all = await lists.toArray();
        const stale = all.filter((r) => r.id !== publishedListId(r));
        if (!stale.length) return;
        await lists.bulkDelete(stale.map((r) => r.id));
        await lists.bulkPut(stale.map((r) => ({ ...r, id: publishedListId(r) })));
        await tx.table("publishedResolved").clear();
      });
    // v10: the player's collection — models owned per datasheet.
    this.version(10).stores({
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
    });
    // v11: the files each source was last downloaded as, so fetching one does not download the rest.
    this.version(11).stores({
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
  }
}

export const db = new GrimstatDb();

export async function getSetting<T>(key: string): Promise<T | undefined> {
  const r = await db.settings.get(key);
  return r?.value as T | undefined;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}

/** The files a source was last downloaded as, or nothing when it has not been fetched on this machine. */
export async function readSourceFiles(gameSystemId: string, adapter: string): Promise<SourceFilesRecord | undefined> {
  const rec = await db.sourceFiles.get(sourceFilesKey(gameSystemId, adapter));
  // A record written by a half-finished write, or edited by hand in a backup, is treated as absent.
  if (!rec || !rec.files || typeof rec.files !== "object" || !Object.keys(rec.files).length) return undefined;
  return rec;
}

/**
 * Keep the files a fetch came back with, replacing whatever that source held before.
 *
 * The browser refuses a write once its quota is full. Keeping the files only saves work on the next
 * fetch, so a refusal leaves that source with nothing kept and the import carries on. The next fetch
 * of that source downloads what it needs.
 */
export async function putSourceFiles(rec: Omit<SourceFilesRecord, "key">): Promise<boolean> {
  const full: SourceFilesRecord = { ...rec, key: sourceFilesKey(rec.gameSystemId, rec.adapter) };
  try {
    await db.sourceFiles.put(full);
    return true;
  } catch {
    try {
      await db.sourceFiles.delete(full.key);
    } catch {
      /* nothing more to try */
    }
    return false;
  }
}

/**
 * Stores are written from several places (the editor's autosave, imports, deletes) while other
 * views list them. Writers announce the store they touched; listing views re-read on the signal.
 */
export const STORE_CHANGED = "grimstat:store-changed";

export type StoreName = "rosters" | "scenarios" | "snapshots" | "overrides" | "terrainLayouts" | "publishedLists" | "publishedResolved" | "games" | "unitPresets" | "collection";

export function notifyStoreChanged(store: StoreName): void {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STORE_CHANGED, { detail: store }));
}

/** Store a roster and record its revision in the history (pruned to ROSTER_VERSION_CAP per roster). */
export async function saveRosterWithVersion(roster: Roster): Promise<void> {
  await db.transaction("rw", db.rosters, db.rosterVersions, async () => {
    await db.rosters.put(roster);
    await db.rosterVersions.put({ id: `${roster.id}:${roster.revision}`, rosterId: roster.id, revision: roster.revision, updatedAt: roster.updatedAt, json: JSON.stringify(roster) });
    const all = await db.rosterVersions.where("rosterId").equals(roster.id).sortBy("revision");
    if (all.length > ROSTER_VERSION_CAP) await db.rosterVersions.bulkDelete(all.slice(0, all.length - ROSTER_VERSION_CAP).map((v) => v.id));
  });
  notifyStoreChanged("rosters");
}

/** Versions of one roster, newest first. */
export async function listRosterVersions(rosterId: string): Promise<RosterVersionRecord[]> {
  const all = await db.rosterVersions.where("rosterId").equals(rosterId).sortBy("revision");
  return all.reverse();
}

export async function deleteRoster(rosterId: string): Promise<void> {
  await db.transaction("rw", db.rosters, db.rosterVersions, async () => {
    await db.rosters.delete(rosterId);
    await db.rosterVersions.where("rosterId").equals(rosterId).delete();
  });
  notifyStoreChanged("rosters");
}

/** Lightweight summary of a stored snapshot for lists (avoids keeping every full snapshot in React state). */
export interface SnapshotMeta {
  id: string;
  label: string | undefined;
  gameSystemId: string;
  sources: Snapshot["sources"];
  checksum: string;
  createdAt: string;
  updatedAt: string;
  counts: { factions: number; datasheets: number; weapons: number; abilities: number; detachments: number; stratagems: number; priceRules: number };
  conflicts: number;
}

export function snapshotMeta(s: Snapshot): SnapshotMeta {
  return {
    id: s.id,
    label: s.label,
    gameSystemId: s.gameSystemId,
    sources: s.sources,
    checksum: s.checksum,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    counts: {
      factions: s.data.factions.length,
      datasheets: s.data.datasheets.length,
      weapons: s.data.datasheets.reduce((n, d) => n + d.weapons.length, 0),
      abilities: s.data.abilities.length,
      detachments: s.data.detachments.length,
      stratagems: s.data.stratagems.length,
      priceRules: s.data.priceRules.length,
    },
    conflicts: s.conflicts.length,
  };
}

export async function listSnapshotMeta(): Promise<SnapshotMeta[]> {
  const out: SnapshotMeta[] = [];
  await db.snapshots.each((s) => {
    out.push(snapshotMeta(s));
  });
  return out.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export interface ExportBundle {
  format: "grimstat-export";
  version: 1;
  exportedAt: string;
  stores: {
    snapshots: Snapshot[];
    scenarios: Scenario[];
    layouts: DashboardLayoutRecord[];
    settings: SettingRecord[];
    /** Added with db v2; absent in older bundles. */
    rosters?: Roster[];
    /** Added with db v3; absent in older bundles. */
    overrides?: OverrideRecord[];
    /** Added with db v4; absent in older bundles. */
    terrainLayouts?: TerrainLayoutRecord[];
    /** Added with db v5; absent in older bundles. */
    publishedLists?: PublishedListRecord[];
    /** Added with db v8; absent in older bundles. */
    unitPresets?: UnitPresetRecord[];
    /** Added with db v10; absent in older bundles. */
    collection?: CollectionEntryRecord[];
    /** Added with db v10; absent in older bundles. */
    games?: GameRecord[];
    /** Added with db v10; absent in older bundles. */
    rosterVersions?: RosterVersionRecord[];
    // `sourceFiles` is left out on purpose. It holds the downloads the snapshots were built from,
    // which are larger than everything else here and can be downloaded again.
    // `publishedResolved` is left out on purpose. It is worked out again from the lists and the
    // active snapshot, so carrying it would only make a backup bigger.
  };
}

export async function exportAll(): Promise<ExportBundle> {
  const [snapshots, scenarios, layouts, settings, rosters, overrides, terrainLayouts, publishedLists, unitPresets, collection, games, rosterVersions] = await Promise.all([db.snapshots.toArray(), db.scenarios.toArray(), db.layouts.toArray(), db.settings.toArray(), db.rosters.toArray(), db.overrides.toArray(), db.terrainLayouts.toArray(), db.publishedLists.toArray(), db.unitPresets.toArray(), db.collection.toArray(), db.games.toArray(), db.rosterVersions.toArray()]);
  return { format: "grimstat-export", version: 1, exportedAt: new Date().toISOString(), stores: { snapshots, scenarios, layouts, settings, rosters, overrides, terrainLayouts, publishedLists, unitPresets, collection, games, rosterVersions } };
}

export async function importAll(bundle: ExportBundle): Promise<{ snapshots: number; scenarios: number; layouts: number; settings: number; rosters: number; overrides: number; terrainLayouts: number; publishedLists: number; unitPresets: number; collection: number; games: number; rosterVersions: number }> {
  const s = bundle.stores;
  const rosters = s.rosters ?? [];
  const overrides = s.overrides ?? [];
  const terrainLayouts = s.terrainLayouts ?? [];
  const publishedLists = s.publishedLists ?? [];
  const unitPresets = s.unitPresets ?? [];
  const collection = s.collection ?? [];
  const games = s.games ?? [];
  const rosterVersions = s.rosterVersions ?? [];
  await db.transaction("rw", [db.snapshots, db.scenarios, db.layouts, db.settings, db.rosters, db.overrides, db.terrainLayouts, db.publishedLists, db.unitPresets, db.collection, db.games, db.rosterVersions], async () => {
    if (s.snapshots.length) await db.snapshots.bulkPut(s.snapshots);
    if (s.scenarios.length) await db.scenarios.bulkPut(s.scenarios);
    if (s.layouts.length) await db.layouts.bulkPut(s.layouts);
    if (s.settings.length) await db.settings.bulkPut(s.settings);
    if (rosters.length) await db.rosters.bulkPut(rosters);
    if (overrides.length) await db.overrides.bulkPut(overrides);
    if (terrainLayouts.length) await db.terrainLayouts.bulkPut(terrainLayouts);
    // A bundle exported before the ids were widened carries the old ones; the id is a function of
    // the list itself, so it is recomputed here and an import stays one record per list.
    if (publishedLists.length) await db.publishedLists.bulkPut(publishedLists.map((r) => ({ ...r, id: publishedListId(r) })));
    if (unitPresets.length) await db.unitPresets.bulkPut(unitPresets);
    if (collection.length) await db.collection.bulkPut(collection);
    if (games.length) await db.games.bulkPut(games);
    if (rosterVersions.length) await db.rosterVersions.bulkPut(rosterVersions);
  });
  notifyStoreChanged("rosters");
  if (terrainLayouts.length) notifyStoreChanged("terrainLayouts");
  if (publishedLists.length) notifyStoreChanged("publishedLists");
  if (unitPresets.length) notifyStoreChanged("unitPresets");
  if (collection.length) notifyStoreChanged("collection");
  if (games.length) notifyStoreChanged("games");
  return { snapshots: s.snapshots.length, scenarios: s.scenarios.length, layouts: s.layouts.length, settings: s.settings.length, rosters: rosters.length, overrides: overrides.length, terrainLayouts: terrainLayouts.length, publishedLists: publishedLists.length, unitPresets: unitPresets.length, collection: collection.length, games: games.length, rosterVersions: rosterVersions.length };
}

/** Every stored override, oldest first. */
export async function listOverrides(): Promise<OverrideRecord[]> {
  return db.overrides.orderBy("updatedAt").toArray();
}

// ---------- games ----------

/** Games newest first. */
export async function listGames(): Promise<GameRecord[]> {
  const all = await db.games.toArray();
  return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function saveGame(game: GameRecord): Promise<void> {
  await db.games.put(game);
  notifyStoreChanged("games");
}

export async function deleteGame(id: string): Promise<void> {
  await db.games.delete(id);
  notifyStoreChanged("games");
}

// ---------- unit presets ----------

/** Presets newest first. */
export async function listUnitPresets(): Promise<UnitPresetRecord[]> {
  const all = await db.unitPresets.toArray();
  return all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function saveUnitPreset(preset: UnitPresetRecord): Promise<void> {
  await db.unitPresets.put(preset);
  notifyStoreChanged("unitPresets");
}

export async function deleteUnitPreset(id: string): Promise<void> {
  await db.unitPresets.delete(id);
  notifyStoreChanged("unitPresets");
}
