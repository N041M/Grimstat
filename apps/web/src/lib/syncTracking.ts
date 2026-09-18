/**
 * What the store remembers about its own changes, so that sync can send them later.
 *
 * Writes to the synced stores happen in many places: page code, the layout store, imports, the
 * corpus refresh. None of them should have to remember sync. So the store watches itself. A Dexie
 * middleware sits under every table and, in the same transaction as the write it saw, keeps two
 * things:
 *
 * - `outbox`: one row per record with a change that has not been sent, keyed by store and id. A
 *   second change to the same record replaces the row.
 * - `tombstones`: one row per record deleted, keyed the same way, so the deletion can be sent and
 *   the same record is not brought back by a device that still holds it.
 *
 * Not every store is synced, and two synced stores carry rows that are not the player's own: a
 * setting that only describes this device, and a published list the corpus relay put there. Those
 * rows are left alone. The rules are in `SYNCED`.
 *
 * The same middleware fills in `ownerId` and `updatedAt` on a record that arrives without them.
 * Sync keys on both, and older tables never carried them.
 *
 * Writes made by the sync layer itself, when it applies what another device sent, must not come
 * back round into the outbox. `untracked` runs a transaction the middleware ignores.
 *
 * Nothing here runs during a database upgrade. An upgrade rewrites records in bulk, the outbox
 * store may not exist yet at that point in the version chain, and a device that upgrades has
 * nothing to send that it did not already have.
 */
import type Dexie from "dexie";
import type { DBCore, DBCoreMutateRequest, DBCoreTable, DBCoreTransaction, Middleware, Table, Transaction } from "dexie";

export const OUTBOX_STORE = "outbox";
export const TOMBSTONE_STORE = "tombstones";

/** A change waiting to be sent: the record in `store` with this `id`, last changed at `changedAt`. */
export interface OutboxRecord {
  store: string;
  id: string;
  changedAt: string;
}

/** A deletion waiting to be sent. */
export interface TombstoneRecord {
  store: string;
  id: string;
  deletedAt: string;
}

/** The record with id `id` in store `store`, as a row of either table is keyed. */
export type SyncKey = [store: string, id: string];

/**
 * The settings sync carries. Everything else under `settings` describes this device: the active
 * snapshot, which tab was open, whether the tour was seen. These two are where the app fetches
 * from, which a player sets once and expects everywhere. The strings are the keys the Data page
 * writes, and `syncTracking.test.ts` holds them to the constants those modules export.
 */
export const SYNCED_SETTING_KEYS: ReadonlySet<string> = new Set(["data.published.corpusUrl", "data.fetch.wahapediaMirror"]);

type Row = Record<string, unknown>;

/**
 * Which stores sync, and which of their rows. A store that is not here is never watched. The
 * function says whether one row is the player's own.
 */
export const SYNCED: Readonly<Record<string, (row: Row) => boolean>> = {
  rosters: () => true,
  scenarios: () => true,
  unitPresets: () => true,
  collection: () => true,
  games: () => true,
  terrainLayouts: () => true,
  overrides: () => true,
  layouts: () => true,
  // A list the corpus relay put here comes back with the next refresh. One with no origin was
  // stored before the field existed, and the refresh never removes those, so it is the player's.
  publishedLists: (row) => row.origin !== "corpus",
  settings: (row) => SYNCED_SETTING_KEYS.has(String(row.key)),
};

export const SYNCED_STORES: readonly string[] = Object.keys(SYNCED);

/** The id of whoever owns the records written from now on. `"local"` until an account adopts them. */
let owner = "local";
export const syncOwner = (): string => owner;
export function setSyncOwner(id: string): void {
  owner = id;
}

/** Set on the transaction of a write the middleware is to ignore. */
const UNTRACKED = "grimstatUntracked";

type TrackedTransaction = DBCoreTransaction & { [UNTRACKED]?: boolean; mode?: IDBTransactionMode; objectStoreNames?: DOMStringList };

function skip(trans: TrackedTransaction): boolean {
  if (trans[UNTRACKED]) return true;
  if (trans.mode === "versionchange") return true;
  // A transaction opened on an older schema, before the two tables existed.
  if (trans.objectStoreNames && !trans.objectStoreNames.contains(OUTBOX_STORE)) return true;
  return false;
}

/**
 * The middleware. `db.use(trackingMiddleware())` in the store's constructor.
 *
 * Every read-write transaction that touches a synced store is widened to include the two tables,
 * so the rows can be written in the same transaction as the change and neither can exist without
 * the other.
 */
export function trackingMiddleware(): Middleware<DBCore> {
  return {
    stack: "dbcore",
    name: "grimstat-sync-tracking",
    create(down: DBCore): Partial<DBCore> {
      const outbox = (): DBCoreTable => down.table(OUTBOX_STORE);
      const tombstones = (): DBCoreTable => down.table(TOMBSTONE_STORE);
      return {
        transaction(stores, mode, options) {
          if (mode === "readwrite" && stores.some((s) => s in SYNCED)) {
            const widened = [...new Set([...stores, OUTBOX_STORE, TOMBSTONE_STORE])];
            return down.transaction(widened, mode, options);
          }
          return down.transaction(stores, mode, options);
        },
        table(name) {
          const table = down.table(name);
          const own = SYNCED[name];
          if (!own) return table;
          const keyOf = (row: Row): string => String(table.schema.primaryKey.extractKey?.(row));
          const ownedKeys = async (trans: DBCoreTransaction, requested: unknown[]): Promise<string[]> => {
            const rows = await table.getMany({ trans, keys: requested });
            return rows.filter((r): r is Row => !!r && own(r)).map(keyOf);
          };
          return {
            ...table,
            async mutate(req: DBCoreMutateRequest) {
              const trans = req.trans as TrackedTransaction;
              if (skip(trans)) return table.mutate(req);
              const now = new Date().toISOString();
              if (req.type === "add" || req.type === "put") {
                const values = req.values.map((v: Row) => (own(v) ? stamp(v, now) : v));
                const res = await table.mutate({ ...req, values });
                const changed = values.filter((v: Row) => own(v)).map((v: Row) => ({ store: name, id: keyOf(v), changedAt: now }));
                if (changed.length) {
                  await outbox().mutate({ type: "put", trans: req.trans, values: changed });
                  await tombstones().mutate({ type: "delete", trans: req.trans, keys: changed.map((c) => [name, c.id]) });
                }
                return res;
              }
              // Which rows go depends on what is there, so they are read before the delete.
              const keys: string[] =
                req.type === "delete"
                  ? await ownedKeys(req.trans, req.keys)
                  : (await table.query({ trans: req.trans, values: true, query: { index: table.schema.primaryKey, range: req.range } })).result.filter(own).map(keyOf);
              const res = await table.mutate(req);
              if (keys.length) {
                await tombstones().mutate({ type: "put", trans: req.trans, values: keys.map((id) => ({ store: name, id, deletedAt: now })) });
                await outbox().mutate({ type: "delete", trans: req.trans, keys: keys.map((id) => [name, id]) });
              }
              return res;
            },
          };
        },
      };
    },
  };
}

/** The record with the two fields sync keys on, filled in when the write left them out. */
function stamp(row: Row, now: string): Row {
  if (row.ownerId && row.updatedAt) return row;
  return { ...row, ownerId: row.ownerId || owner, updatedAt: row.updatedAt || now };
}

/**
 * Run `fn` in a read-write transaction over `tables` that the middleware ignores. For the sync
 * layer, when it writes what another device sent.
 */
export function untracked<T>(db: Dexie, tables: Table[], fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction("rw", tables, (tx) => {
    (tx.idbtrans as unknown as TrackedTransaction)[UNTRACKED] = true;
    return fn(tx);
  });
}
