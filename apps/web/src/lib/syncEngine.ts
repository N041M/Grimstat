/**
 * One round of sync: send what the outbox holds, take what the server holds, settle the rest.
 *
 * The outbox and the tombstones are read first. Each outbox row becomes a change carrying the
 * record as it is now, and each tombstone a change carrying only a deletion. The server answers
 * with what it applied, what it rejected because it held something newer, and everything other
 * devices sent since this device's cursor. See docs/SYNC.md, "The protocol".
 *
 * What comes back is written through `untracked`, so it never re-enters the outbox. A record that
 * changed here again while the request was in flight keeps its outbox row and goes up next round.
 * A rejected roster is set aside in the roster's history before the winner replaces it, which is
 * the rule that nothing is ever lost to sync.
 */
import type { GrimstatDb, RosterVersionRecord, StoreName } from "../db";
import { notifyStoreChanged } from "../db";
import { SYNC_MAX_CHANGES, type SyncStore } from "@grimstat/schema";
import { api, ApiError, CURSOR_SETTING, LAST_SYNC_SETTING, type FetchLike } from "./account";
import { SYNCED, SYNCED_SETTING_KEYS, untracked, type OutboxRecord, type TombstoneRecord } from "./syncTracking";

export interface Change {
  store: SyncStore;
  id: string;
  revision: number;
  updatedAt: string;
  deletedAt?: string;
  body?: Record<string, unknown>;
}

export interface SyncResponse {
  cursor: number;
  applied: Array<{ store: string; id: string }>;
  rejected: Array<{ store: string; id: string; server: Change }>;
  changes: Change[];
  more: boolean;
}

export interface RoundResult {
  sent: number;
  received: number;
  kept: number;
  /** Records the server refused as too large. They stay on this device and are not sent again. */
  skipped: number;
}

/**
 * How much one request may carry. The server refuses a body over 12 MB, and a first sync after
 * signing in has everything on the device to send, so batches are cut by size as well as count.
 */
export const SYNC_BATCH_BYTES = 4 * 1024 * 1024;

type Row = Record<string, unknown> & { updatedAt?: string; revision?: number };

const key = (store: string, id: string): string => `${store}|${id}`;

/** Somewhere the app may fetch from: a web address, or a path on this same site. The two fetch settings are held to it. */
const isFetchable = (value: unknown): boolean => typeof value === "string" && (/^https?:\/\/[^\s/]+/i.test(value.trim()) || /^\/(?!\/)/.test(value.trim()));

/**
 * What the outbox and the tombstones hold, as changes, oldest first, at most one request's worth
 * by count (`limit`) and by size. A batch always holds at least one change when there is one.
 */
export async function collectChanges(db: GrimstatDb, limit = SYNC_MAX_CHANGES): Promise<{ changes: Change[]; outbox: OutboxRecord[]; tombstones: TombstoneRecord[]; unsendable: OutboxRecord[] }> {
  const queued = (await db.outbox.orderBy("changedAt").limit(limit).toArray()) as OutboxRecord[];
  const changes: Change[] = [];
  const outbox: OutboxRecord[] = [];
  const unsendable: OutboxRecord[] = [];
  let bytes = 0;
  for (const o of queued) {
    const row = (await db.table(o.store).get(o.id)) as Row | undefined;
    // Deleted since it was queued: the tombstone carries it.
    if (!row) {
      outbox.push(o);
      continue;
    }
    // The server reads a whole request or none of it, so one record it will not accept would fail
    // every request that carried it and nothing behind it would ever be sent. A record written by
    // something other than the app — an imported backup with a date of its own — is the way one
    // gets here, and it is set aside now rather than after a round trip that cannot say which
    // record it was about.
    if (!sendable(o, row)) {
      unsendable.push(o);
      continue;
    }
    const size = JSON.stringify(row).length;
    if (changes.length && bytes + size > SYNC_BATCH_BYTES) break;
    bytes += size;
    outbox.push(o);
    changes.push({ store: o.store as SyncStore, id: o.id, revision: typeof row.revision === "number" ? row.revision : 0, updatedAt: row.updatedAt ?? o.changedAt, body: row });
  }
  const tombstones = (await db.tombstones.orderBy("deletedAt").limit(Math.max(0, limit - changes.length)).toArray()) as TombstoneRecord[];
  for (const t of tombstones) changes.push({ store: t.store as SyncStore, id: t.id, revision: 0, updatedAt: t.deletedAt, deletedAt: t.deletedAt });
  return { changes, outbox, tombstones, unsendable };
}

/** A time written the one way every record in the store carries, which is what the server takes. */
const isTimestamp = (v: unknown): v is string => typeof v === "string" && !Number.isNaN(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(v);

/** Whether the server would take this record, checked here so a batch is never refused whole. */
function sendable(o: OutboxRecord, row: Row): boolean {
  if (o.id.length > 200) return false;
  if (!isTimestamp(row.updatedAt ?? o.changedAt)) return false;
  return true;
}

/**
 * Write what the server sent. Returns the stores touched and how many rosters were set aside.
 *
 * A record with an unsent change of its own that is newer than the server's is left alone; it
 * goes up next round and wins there. A roster with an unsent change that is older, or one the
 * server rejected outright (`conflict`), is kept in the roster's history before the server's copy
 * replaces it. A roster that simply moved on elsewhere replaces the local copy and keeps nothing,
 * because the local copy was never edited here.
 */
export async function applyChanges(db: GrimstatDb, changes: Change[], conflict = false): Promise<{ touched: Set<string>; kept: number }> {
  const touched = new Set<string>();
  let kept = 0;
  const tables = [...Object.keys(SYNCED).map((s) => db.table(s)), db.outbox, db.tombstones, db.rosterVersions];
  await untracked(db, tables, async () => {
    for (const change of changes) {
      if (!(change.store in SYNCED)) continue;
      const table = db.table(change.store);
      const pending = (await db.outbox.get([change.store, change.id])) as OutboxRecord | undefined;
      const mine = (await table.get(change.id)) as Row | undefined;
      // Newest wins, on the rejected path too. A push that loses comes back with the server's copy,
      // and if the player kept typing while the request was in flight their record is now newer
      // than both — writing the server's copy over it would throw that edit away, outbox row and
      // all, and nothing would ever send it.
      if (mine?.updatedAt && mine.updatedAt > change.updatedAt) continue;
      if (pending && !conflict && pending.changedAt > change.updatedAt && !mine?.updatedAt) continue;
      const gone = (await db.tombstones.get([change.store, change.id])) as TombstoneRecord | undefined;
      if (gone && !conflict && gone.deletedAt > change.updatedAt) continue;
      if (change.deletedAt) {
        if (mine && change.store === "rosters" && (pending || conflict)) {
          await keepAside(db, mine);
          kept++;
        }
        await table.delete(change.id);
        await db.tombstones.delete([change.store, change.id]);
        await db.outbox.delete([change.store, change.id]);
        touched.add(change.store);
        continue;
      }
      const body = change.body ?? {};
      if (!SYNCED[change.store]!(body)) continue;
      if (change.store === "settings" && SYNCED_SETTING_KEYS.has(String(body.key)) && !isFetchable(body.value)) continue;
      if (mine && change.store === "rosters" && (pending || conflict) && JSON.stringify(mine) !== JSON.stringify(body)) {
        await keepAside(db, mine);
        kept++;
      }
      await table.put(body);
      await db.outbox.delete([change.store, change.id]);
      await db.tombstones.delete([change.store, change.id]);
      touched.add(change.store);
    }
  });
  return { touched, kept };
}

/** A roster this device held and sync replaced, kept in the roster's history so nothing is lost. */
async function keepAside(db: GrimstatDb, roster: Row): Promise<void> {
  const revision = typeof roster.revision === "number" ? roster.revision : 0;
  const rec: RosterVersionRecord = {
    id: `${String(roster.id)}:${revision}:kept:${Date.now()}`,
    rosterId: String(roster.id),
    revision,
    updatedAt: roster.updatedAt ?? new Date().toISOString(),
    json: JSON.stringify(roster),
    note: "kept",
  };
  await db.rosterVersions.put(rec);
}

export interface RoundDeps {
  db: GrimstatDb;
  fetchImpl: FetchLike;
  token: string;
  now?: () => Date;
}

/**
 * One full sync: as many requests as it takes to empty the outbox and drain the server's pages.
 * Throws `ApiError` on anything the server refused, including the daily pause.
 */
export async function runSync({ db, fetchImpl, token, now = () => new Date() }: RoundDeps): Promise<RoundResult> {
  const result: RoundResult = { sent: 0, received: 0, kept: 0, skipped: 0 };
  const stored = (await db.settings.get(CURSOR_SETTING))?.value;
  let cursor: number = typeof stored === "number" ? stored : 0;
  let limit = SYNC_MAX_CHANGES;
  for (let rounds = 0; rounds < 100; rounds++) {
    const { changes, outbox, tombstones, unsendable } = await collectChanges(db, limit);
    if (unsendable.length) {
      await untracked(db, [db.outbox], async () => {
        for (const o of unsendable) await db.outbox.delete([o.store, o.id]);
      });
      result.skipped += unsendable.length;
      if (!changes.length) continue;
    }
    let res: SyncResponse;
    try {
      res = await api<SyncResponse>(fetchImpl, "POST", "/api/sync", { cursor, changes }, token);
    } catch (e) {
      // Too large: a batch is halved and tried again; a single record is set aside for good,
      // because it would be refused every time and would block everything behind it. A full
      // account answers 507 instead and is not caught here: nothing is set aside, and the round
      // fails and is tried again later, once something has been deleted. A 400 is not caught here
      // either: the server answers it for a request it could not read as a whole as much as for a
      // record it could not read, and a record must never be dropped over the wrong one. What the
      // server would refuse is found before the request instead, in `collectChanges`.
      if (!(e instanceof ApiError) || e.status !== 413 || changes.length === 0) throw e;
      if (changes.length > 1) {
        limit = Math.max(1, Math.floor(changes.length / 2));
        continue;
      }
      const only = changes[0]!;
      await untracked(db, [db.outbox, db.tombstones], async () => {
        await db.outbox.delete([only.store, only.id]);
        await db.tombstones.delete([only.store, only.id]);
      });
      result.skipped++;
      limit = SYNC_MAX_CHANGES;
      continue;
    }
    limit = SYNC_MAX_CHANGES;
    result.sent += res.applied.length;

    // What went up and was taken leaves the outbox, unless it changed again meanwhile.
    const applied = new Set(res.applied.map((a) => key(a.store, a.id)));
    await untracked(db, [db.outbox, db.tombstones], async () => {
      for (const o of outbox) {
        if (!applied.has(key(o.store, o.id))) continue;
        const still = (await db.outbox.get([o.store, o.id])) as OutboxRecord | undefined;
        if (still && still.changedAt === o.changedAt) await db.outbox.delete([o.store, o.id]);
      }
      for (const t of tombstones) if (applied.has(key(t.store, t.id))) await db.tombstones.delete([t.store, t.id]);
    });

    // What the server held something newer for: the server's copy wins here too.
    if (res.rejected.length) {
      const { touched, kept } = await applyChanges(
        db,
        res.rejected.map((r) => r.server),
        true,
      );
      result.kept += kept;
      for (const store of touched) notifyStoreChanged(store as StoreName);
    }

    const pulled = res.changes.filter((c) => !applied.has(key(c.store, c.id)));
    const { touched, kept } = await applyChanges(db, pulled);
    result.received += pulled.length;
    result.kept += kept;
    for (const store of touched) notifyStoreChanged(store as StoreName);

    cursor = res.cursor;
    await untracked(db, [db.settings], async () => {
      await db.settings.put({ key: CURSOR_SETTING, value: cursor });
      await db.settings.put({ key: LAST_SYNC_SETTING, value: now().toISOString() });
    });

    const outboxLeft = (await db.outbox.count()) + (await db.tombstones.count());
    if (!res.more && outboxLeft === 0) break;
    if (!res.more && changes.length === 0 && outboxLeft > 0) break; // nothing sendable is left: rows whose records are gone
  }
  return result;
}

export { ApiError };
