/**
 * Terrain layouts on the user's own machine.
 *
 * The shipped layouts are read-only and generic; everything else is the user's — built in the editor
 * or imported from elsewhere. Both live in the same list so the Battle page does not care which is
 * which, but a shipped layout is never overwritten: editing one saves a copy.
 */

import type { TerrainLayout } from "@grimstat/board";
import { LAYOUTS, defaultBreachers } from "@grimstat/board";
import { db, notifyStoreChanged, type TerrainLayoutRecord } from "../db";

export interface StoredLayout {
  readonly layout: TerrainLayout;
  /** Shipped layouts come with the app and cannot be edited in place. */
  readonly builtIn: boolean;
  readonly updatedAt?: string;
  readonly source?: string;
}

export const BUILT_IN: readonly StoredLayout[] = LAYOUTS.map((layout) => ({ layout, builtIn: true }));

function decode(record: TerrainLayoutRecord): StoredLayout | undefined {
  try {
    const layout = JSON.parse(record.json) as TerrainLayout;
    // Layouts saved before breachable walls kept anyone out: their ruins name nobody who may pass.
    return { layout: { ...layout, pieces: layout.pieces.map(defaultBreachers) }, builtIn: false, updatedAt: record.updatedAt, source: record.source };
  } catch {
    // A record that will not parse is worse than one that is missing: skip it rather than taking the
    // whole list down with it.
    return undefined;
  }
}

/** Everything available to play on: the shipped layouts first, then the user's, newest last. */
export async function listLayouts(): Promise<StoredLayout[]> {
  const rows = await db.terrainLayouts.orderBy("updatedAt").toArray();
  return [...BUILT_IN, ...rows.map(decode).filter((x): x is StoredLayout => x !== undefined)];
}

export async function saveLayout(layout: TerrainLayout, source?: string): Promise<void> {
  await db.terrainLayouts.put({ id: layout.id, name: layout.name, updatedAt: new Date().toISOString(), json: JSON.stringify(layout), ...(source ? { source } : {}) });
  notifyStoreChanged("terrainLayouts");
}

export async function saveLayouts(layouts: readonly TerrainLayout[], source?: string): Promise<number> {
  const now = new Date().toISOString();
  await db.terrainLayouts.bulkPut(layouts.map((layout) => ({ id: layout.id, name: layout.name, updatedAt: now, json: JSON.stringify(layout), ...(source ? { source } : {}) })));
  notifyStoreChanged("terrainLayouts");
  return layouts.length;
}

export async function deleteLayout(id: string): Promise<void> {
  await db.terrainLayouts.delete(id);
  notifyStoreChanged("terrainLayouts");
}
