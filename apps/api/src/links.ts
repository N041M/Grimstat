/**
 * Short links. A long `#s=` or `#r=` token is stored under an eight-character id, and `/l/<id>`
 * opens the app at the corresponding link. A link made without an account expires after ninety
 * days. A link made from an account lasts as long as the account.
 */
import { z } from "zod";
import { hashIp, shortId } from "./crypto";
import { iso, plusMs, type Deps } from "./deps";

const ANON_LIFE = 90 * 24 * 60 * 60 * 1000;
const LIMIT_PER_IP_HOUR = 30;
/** Links made without an account, per day, in all. Bounds what strangers can make the server keep. */
export const ANON_LIMIT_PER_DAY = 500;
export const LinkKinds = ["scenario", "roster"] as const;

export const LinkRequest = z.object({
  kind: z.enum(LinkKinds),
  token: z.string().min(1).max(16 * 1024),
});

export class LinkError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function createLink(deps: Deps, req: z.infer<typeof LinkRequest>, userId: string | undefined, ip: string): Promise<{ id: string }> {
  const now = deps.now();
  const ipHash = await hashIp(ip, deps.ipSalt);
  const recent = await deps.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM links WHERE ip_hash = ? AND created_at > ?", ipHash, iso(new Date(now.getTime() - 60 * 60 * 1000)));
  if ((recent?.n ?? 0) >= LIMIT_PER_IP_HOUR) throw new LinkError(429, "Too many links made in the last hour. Try again later.");
  if (!userId) {
    const today = await deps.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM links WHERE user_id IS NULL AND created_at > ?", iso(new Date(now.getTime() - 24 * 60 * 60 * 1000)));
    if ((today?.n ?? 0) >= ANON_LIMIT_PER_DAY) throw new LinkError(503, "No more links can be made today without an account.");
  }
  const id = shortId();
  await deps.db.run("INSERT INTO links (id, user_id, ip_hash, kind, body, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId ?? null, ipHash, req.kind, req.token, iso(now), userId ? null : plusMs(now, ANON_LIFE));
  return { id };
}

/** Where the app opens for a link, or nothing when the id is unknown or has expired. */
export async function resolveLink(deps: Deps, id: string): Promise<string | undefined> {
  const row = await deps.db.first<{ kind: string; body: string; expires_at: string | null }>("SELECT kind, body, expires_at FROM links WHERE id = ?", id);
  if (!row || (row.expires_at && row.expires_at < iso(deps.now()))) return undefined;
  return row.kind === "roster" ? `${deps.appUrl}/#/armies?r=${row.body}` : `${deps.appUrl}/#s=${row.body}`;
}
