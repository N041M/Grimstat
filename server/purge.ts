/**
 * What the server no longer needs, removed. Runs nightly on Cloudflare and hourly on Node.
 *
 * Sign-in codes are kept a day after they were made, because the daily count of sign-in emails
 * reads them. The codes that confirm a change of address go the same way. Sessions go when they have expired or have not been used for ninety days. Links made
 * without an account go when they expire. A deletion's tombstone goes after ninety days too: a
 * device that has not synced for that long has no session left to sync with, so nobody is left
 * who needs to hear of it.
 *
 * The same run compresses a batch of records written before bodies were stored compressed, and
 * sets their owners' size counters to what the rows now take.
 *
 * It also sets the size counter from the rows for each account a device has used in the last day.
 * A push moves the counter before its records are written and puts it back when they fail. When
 * putting it back fails too, the counter holds bytes the account does not, and a full counter
 * refuses every push with nothing in the account to delete. An account in use touches a session
 * at least once a day, so its counter is right again by the next night.
 */
import { ACCOUNT_DELETE_GRACE_DAYS } from "@grimstat/schema";
import { gzipText } from "./codec";
import { RECOUNT_BYTES, RECOUNT_BYTES_OF, type Stmt } from "./db";
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
    { sql: `${RECOUNT_BYTES_OF} WHERE id IN (SELECT user_id FROM sessions WHERE last_seen_at >= ?)`, params: [iso(new Date(now.getTime() - DAY))] },
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
  const stmts: Stmt[] = rows.map((r) => ({ sql: "UPDATE records SET body_gz = ?, body = NULL WHERE user_id = ? AND store = ? AND id = ?", params: [gzipText(r.body), r.user_id, r.store, r.id] }));
  for (const userId of new Set(rows.map((r) => r.user_id))) {
    stmts.push({ sql: RECOUNT_BYTES, params: [userId] });
  }
  await deps.db.batch(stmts);
  return rows.length;
}

/**
 * Accounts marked for deletion longer ago than the grace period, emptied for good.
 *
 * `deleteAccount` only marks, so that one request from a device cannot destroy an account with
 * nothing to undo. This is where the deletion actually happens, and from here there is no way back.
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
