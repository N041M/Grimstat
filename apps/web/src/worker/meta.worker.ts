/// <reference lib="webworker" />
import * as Comlink from "comlink";
import { db, type ResolvedListRecord } from "../db";
import { effectiveSnapshot } from "../lib/overrides";
import { summarise } from "../lib/meta";

/**
 * Resolves published lists against a snapshot, off the main thread.
 *
 * The worker reads the lists, the snapshot and the overrides from the database itself, so nothing
 * large crosses the thread boundary, and writes each batch of results back as it goes. A list is
 * resolved once per snapshot stamp; a run after a points update or an override change redoes only
 * what the stamp says is stale.
 */

export interface MetaResolveResult {
  /** The snapshot checksum, overrides included, the rows were stamped with. */
  readonly stamp: string;
  readonly resolved: number;
  readonly total: number;
  readonly removed: number;
}

export interface MetaWorkerApi {
  resolve(snapshotId: string, onProgress: (done: number, total: number) => void): Promise<MetaResolveResult>;
}

const BATCH = 25;

async function resolve(snapshotId: string, onProgress: (done: number, total: number) => void): Promise<MetaResolveResult> {
  const raw = await db.snapshots.get(snapshotId);
  if (!raw) throw new Error(`snapshot ${snapshotId} is not stored`);
  const overrides = await db.overrides.toArray();
  const { snapshot } = effectiveSnapshot(raw, overrides);
  const stamp = snapshot.checksum;

  const records = await db.publishedLists.toArray();
  const rows = await db.publishedResolved.where("snapshotId").equals(snapshotId).toArray();
  const ids = new Set(records.map((r) => r.id));
  const stale = rows.filter((r) => !ids.has(r.recordId)).map((r) => r.key);
  if (stale.length) await db.publishedResolved.bulkDelete(stale);
  const current = new Map(rows.map((r) => [r.recordId, r.stamp]));
  const todo = records.filter((r) => current.get(r.id) !== stamp);

  let done = 0;
  onProgress(0, todo.length);
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH).map((record): ResolvedListRecord => ({ key: `${snapshotId}|${record.id}`, snapshotId, recordId: record.id, stamp, ...summarise(record, snapshot) }));
    await db.publishedResolved.bulkPut(batch);
    done += batch.length;
    onProgress(done, todo.length);
  }
  return { stamp, resolved: done, total: records.length, removed: stale.length };
}

const api: MetaWorkerApi = { resolve };
Comlink.expose(api);
