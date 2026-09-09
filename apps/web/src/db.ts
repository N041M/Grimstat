import Dexie, { type Table } from "dexie";
import type { Roster, Scenario, Snapshot } from "@grimstat/schema";
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

export class GrimstatDb extends Dexie {
  snapshots!: Table<Snapshot, string>;
  scenarios!: Table<Scenario, string>;
  layouts!: Table<DashboardLayoutRecord, string>;
  settings!: Table<SettingRecord, string>;
  rosters!: Table<Roster, string>;
  rosterVersions!: Table<RosterVersionRecord, string>;

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

/** Store a roster and record its revision in the history (pruned to ROSTER_VERSION_CAP per roster). */
export async function saveRosterWithVersion(roster: Roster): Promise<void> {
  await db.transaction("rw", db.rosters, db.rosterVersions, async () => {
    await db.rosters.put(roster);
    await db.rosterVersions.put({ id: `${roster.id}:${roster.revision}`, rosterId: roster.id, revision: roster.revision, updatedAt: roster.updatedAt, json: JSON.stringify(roster) });
    const all = await db.rosterVersions.where("rosterId").equals(roster.id).sortBy("revision");
    if (all.length > ROSTER_VERSION_CAP) await db.rosterVersions.bulkDelete(all.slice(0, all.length - ROSTER_VERSION_CAP).map((v) => v.id));
  });
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
  counts: { factions: number; datasheets: number; abilities: number; detachments: number; stratagems: number; priceRules: number };
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
  };
}

export async function exportAll(): Promise<ExportBundle> {
  const [snapshots, scenarios, layouts, settings, rosters] = await Promise.all([db.snapshots.toArray(), db.scenarios.toArray(), db.layouts.toArray(), db.settings.toArray(), db.rosters.toArray()]);
  return { format: "grimstat-export", version: 1, exportedAt: new Date().toISOString(), stores: { snapshots, scenarios, layouts, settings, rosters } };
}

export async function importAll(bundle: ExportBundle): Promise<{ snapshots: number; scenarios: number; layouts: number; settings: number; rosters: number }> {
  const s = bundle.stores;
  const rosters = s.rosters ?? [];
  await db.transaction("rw", db.snapshots, db.scenarios, db.layouts, db.settings, db.rosters, async () => {
    if (s.snapshots.length) await db.snapshots.bulkPut(s.snapshots);
    if (s.scenarios.length) await db.scenarios.bulkPut(s.scenarios);
    if (s.layouts.length) await db.layouts.bulkPut(s.layouts);
    if (s.settings.length) await db.settings.bulkPut(s.settings);
    if (rosters.length) await db.rosters.bulkPut(rosters);
  });
  return { snapshots: s.snapshots.length, scenarios: s.scenarios.length, layouts: s.layouts.length, settings: s.settings.length, rosters: rosters.length };
}
