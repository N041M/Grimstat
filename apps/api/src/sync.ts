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
 */
import { z } from "zod";
import { SYNC_MAX_ACCOUNT_BYTES, SYNC_MAX_BODY_BYTES, SYNC_MAX_CHANGES, SYNC_PAGE, SYNC_STORES } from "@grimstat/schema";
import { iso, type Deps } from "./deps";

const SKEW = 5 * 60 * 1000;

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
  const winners: Array<Change & { bytes: number }> = [];

  if (req.changes.length) {
    // One round trip for everything the request names.
    const keys = req.changes.map((c) => keyOf(c.store, c.id));
    const existing = await deps.db.all<Row>(
      `SELECT store, id, seq, revision, updated_at, deleted_at, body FROM records WHERE user_id = ? AND (store || '|' || id) IN (${keys.map(() => "?").join(",")})`,
      userId,
      ...keys,
    );
    const held = new Map(existing.map((r) => [keyOf(r.store, r.id), r]));
    for (const change of req.changes) {
      const body = change.body === undefined ? undefined : JSON.stringify(change.body);
      const bytes = body ? new TextEncoder().encode(body).length : 0;
      if (bytes > SYNC_MAX_BODY_BYTES) throw new SyncError(413, `One record is larger than ${Math.round(SYNC_MAX_BODY_BYTES / 1024)} KB and cannot be synced.`);
      const updatedAt = clamp(change.updatedAt);
      const deletedAt = change.deletedAt ? clamp(change.deletedAt) : undefined;
      const have = held.get(keyOf(change.store, change.id));
      if (have && have.updated_at > updatedAt) {
        rejected.push({ store: change.store, id: change.id, server: toChange(have) });
        continue;
      }
      winners.push({ ...change, updatedAt, ...(deletedAt ? { deletedAt } : {}), bytes });
    }
  }

  if (winners.length) {
    const size = await deps.db.first<{ n: number }>("SELECT COALESCE(SUM(LENGTH(body)), 0) AS n FROM records WHERE user_id = ?", userId);
    const added = winners.reduce((n, w) => n + w.bytes, 0);
    if ((size?.n ?? 0) + added > SYNC_MAX_ACCOUNT_BYTES) throw new SyncError(413, `This account has reached its ${Math.round(SYNC_MAX_ACCOUNT_BYTES / 1024 / 1024)} MB of synced data.`);
    const counter = await deps.db.first<{ seq: number }>("UPDATE users SET seq = seq + ? WHERE id = ? RETURNING seq", winners.length, userId);
    if (!counter) throw new SyncError(401, "This account no longer exists.");
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
