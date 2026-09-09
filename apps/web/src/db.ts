import Dexie, { type Table } from "dexie";
import type { Scenario, Snapshot } from "@grimstat/schema";
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

export class GrimstatDb extends Dexie {
  snapshots!: Table<Snapshot, string>;
  scenarios!: Table<Scenario, string>;
  layouts!: Table<DashboardLayoutRecord, string>;
  settings!: Table<SettingRecord, string>;

  constructor(name = "grimstat") {
    super(name);
    this.version(1).stores({
      snapshots: "id, gameSystemId, updatedAt",
      scenarios: "id, name, updatedAt, snapshotId",
      layouts: "id",
      settings: "key",
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
  };
}

export async function exportAll(): Promise<ExportBundle> {
  const [snapshots, scenarios, layouts, settings] = await Promise.all([db.snapshots.toArray(), db.scenarios.toArray(), db.layouts.toArray(), db.settings.toArray()]);
  return { format: "grimstat-export", version: 1, exportedAt: new Date().toISOString(), stores: { snapshots, scenarios, layouts, settings } };
}

export async function importAll(bundle: ExportBundle): Promise<{ snapshots: number; scenarios: number; layouts: number; settings: number }> {
  const s = bundle.stores;
  await db.transaction("rw", db.snapshots, db.scenarios, db.layouts, db.settings, async () => {
    if (s.snapshots.length) await db.snapshots.bulkPut(s.snapshots);
    if (s.scenarios.length) await db.scenarios.bulkPut(s.scenarios);
    if (s.layouts.length) await db.layouts.bulkPut(s.layouts);
    if (s.settings.length) await db.settings.bulkPut(s.settings);
  });
  return { snapshots: s.snapshots.length, scenarios: s.scenarios.length, layouts: s.layouts.length, settings: s.settings.length };
}
