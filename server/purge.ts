/**
 * What the server no longer needs, removed. Runs nightly on Cloudflare and hourly on Node.
 *
 * Sign-in codes are kept a day, because the daily count of sign-in emails reads them, and the codes
 * confirming a change of address go the same way. Sessions go when they expire or have not been
 * used for ninety days. Links made without an account go when they expire. A deletion's tombstone
 * goes after ninety days, by which point no device still has a session to sync it to.
 *
 * The same run compresses a batch of records written before bodies were stored compressed, and sets
 * their owners' size counters to what the rows now take.
 */
import { ACCOUNT_DELETE_GRACE_DAYS } from "@grimstat/schema";
import { gzipText } from "./codec";
import { RECOUNT_BYTES, type Stmt } from "./db";
import { iso, type Deps } from "./deps";

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_IDLE_DAYS = 90;
/** Plain rows compressed per run. Bounds the work one run does. */
export const COMPRESS_BATCH = 500;


export async function purge(deps: Deps): Promise<void> {
  const now = deps.now();
  await deps.db.batch([
    { sql: "DELETE FROM logins WHERE created_at < ?", params: [iso(new Date(now.getTime() - DAY))] },
    { sql: "DELETE FROM email_changes WHERE created_at < ?", params: [iso(new Date(now.getTime() - DAY))] },
    { sql: "DELETE FROM email_reverts WHERE expires_at < ?", params: [iso(now)] },
    { sql: "DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?", params: [iso(now), iso(new Date(now.getTime() - SESSION_IDLE_DAYS * DAY))] },
    { sql: "DELETE FROM links WHERE expires_at IS NOT NULL AND expires_at < ?", params: [iso(now)] },
    { sql: "DELETE FROM records WHERE deleted_at IS NOT NULL AND deleted_at < ?", params: [iso(new Date(now.getTime() - SESSION_IDLE_DAYS * DAY))] },
  ]);
  await deleteMarkedAccounts(deps);
  await compressPlainRows(deps);
}

/**
 * Rows still holding JSON in `body`, gzipped into `body_gz`, a batch at a time. Each owner's size
 * counter is then set from the rows, in the same transaction, so the account's 20 MB is of stored
 * bytes once every row is compressed. Returns how many rows it did.
 */
export async function compressPlainRows(deps: Deps, batch = COMPRESS_BATCH): Promise<number> {
  const rows = await deps.db.all<{ user_id: string; store: string; id: string; body: string }>("SELECT user_id, store, id, body FROM records WHERE body IS NOT NULL LIMIT ?", batch);
  if (!rows.length) return 0;
  const stmts: Stmt[] = await Promise.all(
    rows.map(async (r) => ({ sql: "UPDATE records SET body_gz = ?, body = NULL WHERE user_id = ? AND store = ? AND id = ?", params: [await gzipText(r.body), r.user_id, r.store, r.id] })),
  );
  for (const userId of new Set(rows.map((r) => r.user_id))) {
    stmts.push({ sql: RECOUNT_BYTES, params: [userId, userId] });
  }
  await deps.db.batch(stmts);
  return rows.length;
}

/**
 * Accounts marked for deletion longer ago than the grace period, emptied for good. `deleteAccount`
 * only marks; this is where the deletion happens, and from here there is no way back.
 */
export async function deleteMarkedAccounts(deps: Deps): Promise<number> {
  const cutoff = iso(new Date(deps.now().getTime() - ACCOUNT_DELETE_GRACE_DAYS * DAY));
  const rows = await deps.db.all<{ id: string }>("SELECT id FROM users WHERE deleted_at IS NOT NULL AND deleted_at < ?", cutoff);
  if (!rows.length) return 0;
  const stmts: Stmt[] = [];
  for (const { id } of rows) {
    stmts.push({ sql: "DELETE FROM records WHERE user_id = ?", params: [id] });
    stmts.push({ sql: "DELETE FROM links WHERE user_id = ?", params: [id] });
    stmts.push({ sql: "DELETE FROM sessions WHERE user_id = ?", params: [id] });
    stmts.push({ sql: "DELETE FROM email_changes WHERE user_id = ?", params: [id] });
    stmts.push({ sql: "DELETE FROM email_reverts WHERE user_id = ?", params: [id] });
    stmts.push({ sql: "DELETE FROM users WHERE id = ?", params: [id] });
  }
  await deps.db.batch(stmts);
  return rows.length;
}
