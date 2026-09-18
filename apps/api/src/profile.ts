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
import type { Deps } from "./deps";

const HANDLE = /^[a-z0-9](?:[a-z0-9-]{1,18}[a-z0-9])?$/;
/** Paths and names a handle could be confused with. */
const RESERVED = new Set(["api", "l", "u", "www", "admin", "grimstat", "about", "profile", "data", "armies", "help", "support", "mail", "hello", "root", "null", "undefined"]);

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
  await deps.db.run("UPDATE users SET handle = ? WHERE id = ?", checked.handle, userId);
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
  const rows = await deps.db.all<{ body: string; updated_at: string }>(
    "SELECT body, updated_at FROM records WHERE user_id = ? AND store = 'rosters' AND deleted_at IS NULL AND json_extract(body, '$.shared') = 1 ORDER BY updated_at DESC LIMIT 100",
    user.id,
  );
  const armies: PublicArmy[] = [];
  for (const r of rows) {
    try {
      const body = JSON.parse(r.body) as Record<string, unknown>;
      armies.push({ roster: forPublic(body), updatedAt: r.updated_at });
    } catch {
      /* a body that does not parse is not shown */
    }
  }
  return { handle: user.handle, armies };
}
