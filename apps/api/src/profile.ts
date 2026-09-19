/**
 * A handle, and the page it names.
 *
 * A handle is optional, three to twenty characters of letters, digits and hyphens, unique across
 * accounts and compared without regard to case. The page at /u/<handle> lists the account's
 * armies that carry `shared`, as the roster bodies the app stores, with the owner's notes taken
 * out. The viewer's device renders them against its own snapshot, so the server sends unit ids
 * and counts and never a datasheet.
 */
import { AuthError } from "./auth";
import { bodyText, type StoredBody } from "./codec";
import type { Deps } from "./deps";

const HANDLE = /^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/;
/**
 * Names nobody gets. Paths of the site, names that read as the site's own or as staff, test names,
 * and words a page address should not be.
 */
const RESERVED = new Set([
  ...["api", "l", "u", "s", "r", "www", "app", "apps", "static", "assets", "public", "index", "home"],
  ...["calculator", "scenarios", "armies", "army", "collection", "codex", "analyses", "battle", "play", "data", "profile", "about", "overrides", "share", "links"],
  ...["grimstat", "grim-stat", "official", "staff", "team", "admin", "admins", "administrator", "mod", "moderator", "moderators", "owner", "root", "sysadmin", "system", "sys", "bot", "bots", "dev", "developer", "developers"],
  ...["support", "help", "helpdesk", "info", "contact", "mail", "email", "hello", "noreply", "no-reply", "postmaster", "webmaster", "abuse", "security", "legal", "privacy", "terms", "billing", "sales", "press"],
  ...["test", "tests", "tester", "testing", "test-user", "testuser", "demo", "sample", "example", "guest", "anonymous", "anon", "user", "users", "account", "accounts", "login", "signin", "sign-in", "signup", "sign-up", "register", "settings", "me", "you", "unknown", "deleted", "removed"],
  ...["null", "undefined", "nan", "true", "false", "none", "void"],
  ...["gamesworkshop", "games-workshop", "warhammer", "warhammer40k", "warhammer-40k", "40k", "wahapedia", "bsdata", "battlescribe", "newrecruit", "new-recruit"],
]);

/** The handle as stored, or a reason it cannot be. */
export function normaliseHandle(raw: string): { handle: string } | { error: string } {
  const handle = raw.trim().toLowerCase();
  if (!HANDLE.test(handle)) return { error: "A handle is three to twenty letters, digits or hyphens, and starts and ends with a letter or digit." };
  if (RESERVED.has(handle)) return { error: "That handle is taken." };
  return { handle };
}

/** Set the account's handle, or clear it with an empty string. */
export async function setHandle(deps: Deps, userId: string, raw: string): Promise<string | null> {
  if (!raw.trim()) {
    await deps.db.run("UPDATE users SET handle = NULL WHERE id = ?", userId);
    return null;
  }
  const checked = normaliseHandle(raw);
  if ("error" in checked) throw new AuthError(400, checked.error);
  const taken = await deps.db.first<{ id: string }>("SELECT id FROM users WHERE handle = ?", checked.handle);
  if (taken && taken.id !== userId) throw new AuthError(409, "That handle is taken.");
  try {
    await deps.db.run("UPDATE users SET handle = ? WHERE id = ?", checked.handle, userId);
  } catch (err) {
    // Two accounts claiming the same handle at the same moment both read it as free. The one that
    // writes second is refused by the unique index, and hears the same thing as if it had been
    // slower still.
    if (/unique/i.test(err instanceof Error ? err.message : String(err))) throw new AuthError(409, "That handle is taken.");
    throw err;
  }
  return checked.handle;
}

export interface PublicArmy {
  roster: Record<string, unknown>;
  updatedAt: string;
}

export interface PublicProfile {
  handle: string;
  armies: PublicArmy[];
}

/** What the roster body carries that is the owner's alone. */
function forPublic(body: Record<string, unknown>): Record<string, unknown> {
  const { notes: _notes, ownerId: _owner, ...rest } = body;
  const units = Array.isArray(rest.units) ? rest.units.map((u) => (u && typeof u === "object" ? Object.fromEntries(Object.entries(u as Record<string, unknown>).filter(([k]) => k !== "notes")) : u)) : rest.units;
  return { ...rest, units };
}

export async function publicProfile(deps: Deps, raw: string): Promise<PublicProfile | undefined> {
  const checked = normaliseHandle(raw);
  if ("error" in checked) return undefined;
  const user = await deps.db.first<{ id: string; handle: string }>("SELECT id, handle FROM users WHERE handle = ?", checked.handle);
  if (!user) return undefined;
  const rows = await deps.db.all<StoredBody & { updated_at: string }>(
    "SELECT body, body_gz, updated_at FROM records WHERE user_id = ? AND store = 'rosters' AND deleted_at IS NULL AND shared = 1 ORDER BY updated_at DESC LIMIT 100",
    user.id,
  );
  const armies: PublicArmy[] = [];
  for (const r of rows) {
    try {
      const body = JSON.parse((await bodyText(r)) ?? "") as Record<string, unknown>;
      armies.push({ roster: forPublic(body), updatedAt: r.updated_at });
    } catch {
      /* a body that does not parse is not shown */
    }
  }
  return { handle: user.handle, armies };
}
