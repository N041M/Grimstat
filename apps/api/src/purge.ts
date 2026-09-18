/**
 * What the server no longer needs, removed. Runs nightly on Cloudflare and hourly on Node.
 *
 * Sign-in codes are kept a day after they were made, because the daily count of sign-in emails
 * reads them. Sessions go when they have expired or have not been used for ninety days. Links made
 * without an account go when they expire. A deletion's tombstone goes after ninety days too: a
 * device that has not synced for that long has no session left to sync with, so nobody is left
 * who needs to hear of it.
 */
import { iso, type Deps } from "./deps";

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_IDLE_DAYS = 90;

export async function purge(deps: Deps): Promise<void> {
  const now = deps.now();
  await deps.db.batch([
    { sql: "DELETE FROM logins WHERE created_at < ?", params: [iso(new Date(now.getTime() - DAY))] },
    { sql: "DELETE FROM sessions WHERE expires_at < ? OR last_seen_at < ?", params: [iso(now), iso(new Date(now.getTime() - SESSION_IDLE_DAYS * DAY))] },
    { sql: "DELETE FROM links WHERE expires_at IS NOT NULL AND expires_at < ?", params: [iso(now)] },
    { sql: "DELETE FROM records WHERE deleted_at IS NOT NULL AND deleted_at < ?", params: [iso(new Date(now.getTime() - SESSION_IDLE_DAYS * DAY))] },
  ]);
}
