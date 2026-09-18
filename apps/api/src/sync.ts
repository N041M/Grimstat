/**
 * One request that pushes a device's changes and pulls everyone else's. See docs/SYNC.md, "The
 * protocol".
 *
 * For each change the server compares `updatedAt` with what it holds. A later one wins and takes
 * the next sequence number. An earlier one is rejected and the server's copy goes back with it, so
 * the device can keep its own in the roster's history and show the winner. A tombstone competes on
 * the same rule. Client clocks are clamped: a time more than five minutes ahead of the server's is
 * set to the server's before the comparison.
 *
 * The whole push is one batch. If any statement fails, nothing is written and the device keeps its
 * outbox for next time.
 *
 * Two counters on the users row bound what one account can cost. `bytes` is the size of everything
 * stored for the account and caps it at SYNC_MAX_ACCOUNT_BYTES. `day_writes` is how many records
 * the account has written today and caps it at MAX_WRITES_PER_DAY. Both are checked and moved in
 * the one statement that hands out sequence numbers, so two devices pushing at once cannot pass a
 * cap between them. The daily cap keeps one account from spending the database's daily allowance
 * of writes for everyone, and it answers like the pause: 503 with the time it resets.
 */
import { z } from "zod";
import { SYNC_MAX_ACCOUNT_BYTES, SYNC_MAX_BODY_BYTES, SYNC_MAX_CHANGES, SYNC_PAGE, SYNC_STORES } from "@grimstat/schema";
import { iso, nextReset, type Deps } from "./deps";

const SKEW = 5 * 60 * 1000;
/** Records one account may write in a UTC day. An active player writes about thirty. */
export const MAX_WRITES_PER_DAY = 2000;
/** Pairs looked up per query. D1 binds at most a hundred parameters to one statement. */
const LOOKUP_CHUNK = 40;

/** The field each store is keyed by. A body stored under one id must carry that id, or a device would write it under another. */
export const keyField = (store: string): "key" | "id" => (store === "settings" || store === "overrides" ? "key" : "id");

export const Change = z
  .object({
    store: z.enum(SYNC_STORES),
    id: z.string().min(1).max(200),
    revision: z.number().int().nonnegative().default(0),
    updatedAt: z.string().datetime(),
    deletedAt: z.string().datetime().optional(),
    body: z.record(z.unknown()).optional(),
  })
  .refine((c) => (c.deletedAt ? c.body === undefined : c.body !== undefined), { message: "a change carries a body or a deletedAt, not both and not neither" })
  .refine((c) => !c.body || c.body[keyField(c.store)] === c.id, { message: "the body must carry the id it is stored under" });
export type Change = z.infer<typeof Change>;

export const SyncRequest = z.object({
  cursor: z.number().int().nonnegative(),
  changes: z.array(Change).max(SYNC_MAX_CHANGES),
});
export type SyncRequest = z.infer<typeof SyncRequest>;

export interface SyncResponse {
  cursor: number;
  applied: Array<{ store: string; id: string }>;
  rejected: Array<{ store: string; id: string; server: Change }>;
  changes: Change[];
  more: boolean;
}

export class SyncError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Set when the answer is a pause: when the device may try again. */
    readonly pausedUntil?: string,
  ) {
    super(message);
  }
}

interface Row {
  store: string;
  id: string;
  seq: number;
  revision: number;
  updated_at: string;
  deleted_at: string | null;
  body: string | null;
}

/** A store name never holds a bar, so this joins a key the database can compare in one column. */
const keyOf = (store: string, id: string): string => `${store}|${id}`;

const toChange = (r: Row): Change => ({
  store: r.store as Change["store"],
  id: r.id,
  revision: r.revision,
  updatedAt: r.updated_at,
  ...(r.deleted_at ? { deletedAt: r.deleted_at } : { body: JSON.parse(r.body ?? "{}") as Record<string, unknown> }),
});

const byteLength = (text: string | null | undefined): number => (text ? new TextEncoder().encode(text).length : 0);

/** The rows the request names, fetched by primary key in chunks small enough for D1's parameter limit. */
async function existingRows(deps: Deps, userId: string, changes: Change[]): Promise<Row[]> {
  const rows: Row[] = [];
  for (let i = 0; i < changes.length; i += LOOKUP_CHUNK) {
    const part = changes.slice(i, i + LOOKUP_CHUNK);
    rows.push(
      ...(await deps.db.all<Row>(
        `SELECT store, id, seq, revision, updated_at, deleted_at, body FROM records WHERE user_id = ? AND (${part.map(() => "(store = ? AND id = ?)").join(" OR ")})`,
        userId,
        ...part.flatMap((c) => [c.store, c.id]),
      )),
    );
  }
  return rows;
}

export async function sync(deps: Deps, userId: string, req: SyncRequest): Promise<SyncResponse> {
  const now = deps.now();
  const ceiling = iso(new Date(now.getTime() + SKEW));
  // Every time is written the one way, so the string comparison below is a comparison of times
  // whatever precision a device sent, and a time ahead of the server's clock is set to it.
  const clamp = (t: string): string => {
    const normal = iso(new Date(t));
    return normal > ceiling ? iso(now) : normal;
  };

  const applied: SyncResponse["applied"] = [];
  const rejected: SyncResponse["rejected"] = [];
  const winners: Change[] = [];
  // How many bytes the push adds to the account, counting a replaced body as gone.
  let added = 0;

  if (req.changes.length) {
    const held = new Map((await existingRows(deps, userId, req.changes)).map((r) => [keyOf(r.store, r.id), r]));
    const sizes = new Map([...held].map(([k, r]) => [k, byteLength(r.body)]));
    for (const change of req.changes) {
      const body = change.body === undefined ? undefined : JSON.stringify(change.body);
      const bytes = byteLength(body);
      if (bytes > SYNC_MAX_BODY_BYTES) throw new SyncError(413, `One record is larger than ${Math.round(SYNC_MAX_BODY_BYTES / 1024)} KB and cannot be synced.`);
      const updatedAt = clamp(change.updatedAt);
      const deletedAt = change.deletedAt ? clamp(change.deletedAt) : undefined;
      const key = keyOf(change.store, change.id);
      const have = held.get(key);
      if (have && have.updated_at > updatedAt) {
        rejected.push({ store: change.store, id: change.id, server: toChange(have) });
        continue;
      }
      winners.push({ ...change, updatedAt, ...(deletedAt ? { deletedAt } : {}) });
      added += bytes - (sizes.get(key) ?? 0);
      sizes.set(key, bytes);
    }
  }

  if (winners.length) {
    const today = iso(now).slice(0, 10);
    // The counters move only while both caps hold, in the statement that hands out the sequence
    // numbers. No row back means the account is full, over its day, or gone.
    const counter = await deps.db.first<{ seq: number }>(
      `UPDATE users
         SET seq = seq + ?, bytes = MAX(0, bytes + ?), day_writes = CASE WHEN day = ? THEN day_writes + ? ELSE ? END, day = ?
       WHERE id = ? AND bytes + ? <= ? AND (CASE WHEN day = ? THEN day_writes ELSE 0 END) + ? <= ?
       RETURNING seq`,
      winners.length,
      added,
      today,
      winners.length,
      winners.length,
      today,
      userId,
      added,
      SYNC_MAX_ACCOUNT_BYTES,
      today,
      winners.length,
      MAX_WRITES_PER_DAY,
    );
    if (!counter) {
      const user = await deps.db.first<{ bytes: number; day: string; day_writes: number }>("SELECT bytes, day, day_writes FROM users WHERE id = ?", userId);
      if (!user) throw new SyncError(401, "This account no longer exists.");
      if (user.day === today && user.day_writes + winners.length > MAX_WRITES_PER_DAY) {
        throw new SyncError(503, `This account has synced ${MAX_WRITES_PER_DAY} changes today, which is its daily allowance. Everything is saved on this device and syncs after the reset.`, nextReset(now));
      }
      // A full account is not a record too large, and the device treats the two differently: a
      // record too large is set aside, a full account is waited out.
      throw new SyncError(507, `This account has reached its ${Math.round(SYNC_MAX_ACCOUNT_BYTES / 1024 / 1024)} MB of synced data. Delete an army or a game you no longer need, and sync again.`);
    }
    let seq = counter.seq - winners.length;
    await deps.db.batch(
      winners.map((w) => ({
        sql: `INSERT INTO records (user_id, store, id, seq, revision, updated_at, deleted_at, body) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (user_id, store, id) DO UPDATE SET seq = excluded.seq, revision = excluded.revision, updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, body = excluded.body`,
        params: [userId, w.store, w.id, ++seq, w.revision, w.updatedAt, w.deletedAt ?? null, w.body === undefined ? null : JSON.stringify(w.body)],
      })),
    );
    for (const w of winners) applied.push({ store: w.store, id: w.id });
  }

  // What the other devices sent since this one last asked. What this request just wrote comes back
  // too, and the device treats its own change as already applied.
  const rows = await deps.db.all<Row>("SELECT store, id, seq, revision, updated_at, deleted_at, body FROM records WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?", userId, req.cursor, SYNC_PAGE + 1);
  const more = rows.length > SYNC_PAGE;
  const page = more ? rows.slice(0, SYNC_PAGE) : rows;
  const cursor = page.length ? page[page.length - 1]!.seq : req.cursor;
  return { cursor, applied, rejected, changes: page.map(toChange), more };
}
