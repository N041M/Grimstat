import { useEffect, useMemo, useState } from "react";
import type { Snapshot } from "@grimstat/schema";
import { db, type PublishedListRecord, type ResolvedListRecord } from "../db";
import { listPublishedLists } from "../lib/publishedLists";
import { peerFrom, type PeerList } from "../lib/meta";
import { metaClient, type MetaProgress } from "../worker/metaClient";
import { useStoreVersion } from "./useStoreVersion";

export interface PublishedField {
  /** Every stored list, or undefined until the first read. */
  readonly records: PublishedListRecord[] | undefined;
  /** The lists this snapshot could read, from the stored resolutions. */
  readonly peers: PeerList[];
  /** Fresh resolutions by record id, readable or not. */
  readonly resolved: ReadonlyMap<string, ResolvedListRecord>;
  /** Lists with no fresh resolution yet; the worker is on them. */
  readonly pending: number;
  readonly progress: MetaProgress | undefined;
}

/**
 * The published field for a snapshot: stored lists joined with their stored resolutions.
 *
 * Nothing is parsed here. Lists without a resolution for this snapshot's stamp are handed to the
 * meta worker, and the view re-reads as the worker writes, so the tab fills in rather than waits.
 */
export function usePublishedField(snapshot: Snapshot): PublishedField {
  const listsVersion = useStoreVersion("publishedLists");
  const resolvedVersion = useStoreVersion("publishedResolved");
  const [records, setRecords] = useState<PublishedListRecord[] | undefined>();
  const [rows, setRows] = useState<ResolvedListRecord[]>([]);
  const [progress, setProgress] = useState<MetaProgress | undefined>(() => metaClient.progressOf(snapshot.id));

  useEffect(() => {
    let alive = true;
    void Promise.all([listPublishedLists(), db.publishedResolved.where("snapshotId").equals(snapshot.id).toArray()]).then(([recs, res]) => {
      if (!alive) return;
      setRecords(recs);
      setRows(res);
    });
    return () => {
      alive = false;
    };
  }, [snapshot.id, listsVersion, resolvedVersion]);

  const stamp = snapshot.checksum;
  const { peers, resolved, pending } = useMemo(() => {
    const resolved = new Map<string, ResolvedListRecord>();
    for (const r of rows) if (r.stamp === stamp) resolved.set(r.recordId, r);
    const peers: PeerList[] = [];
    let pending = 0;
    for (const record of records ?? []) {
      const row = resolved.get(record.id);
      if (!row) {
        pending++;
        continue;
      }
      const peer = peerFrom(record, row);
      if (peer) peers.push(peer);
    }
    return { peers, resolved, pending };
  }, [records, rows, stamp]);

  useEffect(() => {
    if (!records || pending === 0) return;
    void metaClient.resolve(snapshot.id).catch(() => undefined);
  }, [records, pending, snapshot.id]);

  useEffect(
    () =>
      metaClient.subscribe((id, p) => {
        if (id === snapshot.id) setProgress(p);
      }),
    [snapshot.id],
  );

  return { records, peers, resolved, pending, progress };
}
