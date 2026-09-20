/**
 * Signing in with an email address and nothing else.
 *
 * `start` stores a hashed one-time code and mails it, as a link and as eight characters to type.
 * The link is for the browser the email is read in; the typed code is for the app on a home screen,
 * which the link cannot reach. `finish` takes the code back, makes the user on the first visit, and
 * hands out a session token. Tokens and codes are stored hashed.
 *
 * Every start sends one email from a daily allowance of a hundred, so: five starts per address per
 * hour, twenty per network address per hour, ninety a day in all.
 */
import { hashEmail, hashIp, normaliseCode, randomToken, sha256, signInCode } from "./crypto";
import { iso, plusMs, type Deps } from "./deps";
import { SESSION_IDLE_DAYS } from "./purge";
import { emailChangeAuthorise, emailChangeCode, emailChangedNotice, signInEmail } from "./signInEmail";

const HOUR = 60 * 60 * 1000;
const CODE_LIFE = 15 * 60 * 1000;
const SESSION_LIFE = 365 * 24 * HOUR;
export const LIMIT_PER_EMAIL = 5;
export const LIMIT_PER_IP = 20;
export const LIMIT_PER_DAY = 90;

export interface User {
  id: string;
  email: string;
  handle: string | null;
}

export interface Session {
  id: string;
  user: User;
}

export class AuthError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function start(deps: Deps, email: string, ip: string): Promise<void> {
  const address = email.trim().toLowerCase();
  if (!EMAIL.test(address) || address.length > 254) throw new AuthError(400, "That does not look like an email address.");
  const now = deps.now();
  const since = iso(new Date(now.getTime() - HOUR));
  const ipHash = await hashIp(ip, deps.ipSalt);
  const emailHash = await hashEmail(address, deps.ipSalt);
  const [byEmail, byIp, today] = await Promise.all([
    deps.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM logins WHERE email_hash = ? AND created_at > ?", emailHash, since),
    deps.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM logins WHERE ip_hash = ? AND created_at > ?", ipHash, since),
    deps.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM logins WHERE created_at > ?", iso(new Date(now.getTime() - 24 * HOUR))),
  ]);
  if ((byEmail?.n ?? 0) >= LIMIT_PER_EMAIL || (byIp?.n ?? 0) >= LIMIT_PER_IP) throw new AuthError(429, "Too many sign-in emails in the last hour. Try again later.");
  if ((today?.n ?? 0) >= LIMIT_PER_DAY) throw new AuthError(503, "Sign-in is paused for today. Everything else keeps working.");
  const code = signInCode();
  const codeHash = await sha256(code);
  await deps.db.run("INSERT INTO logins (code_hash, email, email_hash, ip_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)", codeHash, address, emailHash, ipHash, iso(now), plusMs(now, CODE_LIFE));
  const shown = `${code.slice(0, 4)}-${code.slice(4)}`;
  const link = `${deps.appUrl}/#/profile?code=${shown}`;
  const mail = signInEmail(link, shown);
  try {
    await deps.mail.send(address, mail.subject, mail.text, mail.html);
  } catch (err) {
    // The row is what the three limits count, and no email went out for it. Left behind, a spell of
    // failed sends would spend the day's allowance without a single email sent.
    await deps.db.run("DELETE FROM logins WHERE code_hash = ?", codeHash).catch(() => undefined);
    throw err;
  }
}

export interface Finished {
  token: string;
  session: Session;
}

export async function finish(deps: Deps, code: string, deviceName: string): Promise<Finished> {
  const now = deps.now();
  const codeHash = await sha256(normaliseCode(code));
  // The code is spent in one statement that only succeeds while it is unspent and unexpired, so
  // two requests carrying the same code cannot both get a session.
  const spent = await deps.db.run("UPDATE logins SET used_at = ? WHERE code_hash = ? AND used_at IS NULL AND expires_at >= ?", iso(now), codeHash, iso(now));
  if (spent.changes !== 1) throw new AuthError(400, "This sign-in link has expired. Ask for a new one.");
  const login = await deps.db.first<{ email: string }>("SELECT email FROM logins WHERE code_hash = ?", codeHash);
  // An address cleared by `deleteAccount` leaves the row behind for the limit to count, but a code
  // asked for before the account went is not one to sign back in with.
  if (!login?.email) throw new AuthError(400, "This sign-in link has expired. Ask for a new one.");
  let user = await deps.db.first<User & { deleted_at?: string | null }>("SELECT id, email, handle, deleted_at FROM users WHERE email = ?", login.email);
  // Deleting the account marks it and leaves everything in place for a month. Signing in again
  // brings it back, which is what the grace period is for.
  if (user?.deleted_at) await deps.db.run("UPDATE users SET deleted_at = NULL WHERE id = ?", user.id);
  if (!user) {
    // Two codes for an address with no account yet, used at the same moment, both find no user.
    // The second insert does nothing rather than failing on the address, and both read back the
    // row that was made, so the loser signs in to the same account instead of losing its code.
    await deps.db.run("INSERT INTO users (id, email, created_at) VALUES (?, ?, ?) ON CONFLICT (email) DO NOTHING", `u_${randomToken(12)}`, login.email, iso(now));
    user = await deps.db.first<User & { deleted_at?: string | null }>("SELECT id, email, handle, deleted_at FROM users WHERE email = ?", login.email);
    if (!user) throw new AuthError(500, "The account could not be made. Ask for a new sign-in link.");
  }
  const token = randomToken(32);
  const id = `s_${randomToken(8)}`;
  await deps.db.run(
    "INSERT INTO sessions (token_hash, id, user_id, device_name, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    await sha256(token),
    id,
    user.id,
    deviceName.slice(0, 120) || "Unnamed device",
    iso(now),
    iso(now),
    plusMs(now, SESSION_LIFE),
  );
  return { token, session: { id, user } };
}

/** Changes of address one account may ask for in an hour. The same shape as the sign-in limit. */
export const LIMIT_EMAIL_CHANGES = 3;
/** How long the link in the notice keeps working. Long enough to cover a holiday. */
export const REVERT_DAYS = 30;

/**
 * Ask to move the account to another address.
 *
 * Two codes go out and both are needed. The one to the current address puts the change back behind
 * the inbox the account rests on, out of reach of a session token taken off a device. The one to the
 * address being taken stops a typo moving the account somewhere its owner cannot read.
 *
 * Both are sent at once, so a taken session can put a message in front of an address of its
 * choosing. The three-an-hour limit counts the account rather than the address for that reason.
 *
 * Whether the new address already has an account is not said, which would otherwise be a way to ask
 * the server which addresses it knows.
 */
export async function startEmailChange(deps: Deps, user: User, raw: string): Promise<void> {
  const address = raw.trim().toLowerCase();
  if (!EMAIL.test(address) || address.length > 254) throw new AuthError(400, "That does not look like an email address.");
  if (address === user.email) throw new AuthError(400, "That is already the address on this account.");
  const now = deps.now();
  const asked = await deps.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM email_changes WHERE user_id = ? AND created_at > ?", user.id, iso(new Date(now.getTime() - HOUR)));
  if ((asked?.n ?? 0) >= LIMIT_EMAIL_CHANGES) throw new AuthError(429, "Too many address changes in the last hour. Try again later.");

  const taken = await deps.db.first<{ id: string }>("SELECT id FROM users WHERE email = ?", address);
  if (taken) return;

  const currentCode = signInCode();
  const newCode = signInCode();
  await deps.db.run(
    "INSERT INTO email_changes (id, user_id, new_email, current_code_hash, new_code_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    `ec_${randomToken(8)}`,
    user.id,
    address,
    await sha256(currentCode),
    await sha256(newCode),
    iso(now),
    plusMs(now, CODE_LIFE),
  );
  const shown = (c: string): string => `${c.slice(0, 4)}-${c.slice(4)}`;
  const toCurrent = emailChangeAuthorise(shown(currentCode), address);
  const toNew = emailChangeCode(shown(newCode), address);
  await deps.mail.send(user.email, toCurrent.subject, toCurrent.text, toCurrent.html);
  await deps.mail.send(address, toNew.subject, toNew.text, toNew.html);
}

/**
 * Spend both codes and move the account.
 *
 * The pair is spent in one statement, as a sign-in code is, so two requests carrying the same codes
 * cannot both move the account. Every device but the one that asked is signed out, which is what
 * someone changing their address over a lost device needs.
 *
 * The address that was left is told, with the link that undoes it. A refusal from the mail service
 * must not fail the request: the account has already moved by then.
 */
export async function finishEmailChange(deps: Deps, session: Session, currentCode: string, newCode: string): Promise<string> {
  const user = session.user;
  const now = deps.now();
  const currentHash = await sha256(normaliseCode(currentCode));
  const newHash = await sha256(normaliseCode(newCode));
  const spent = await deps.db.run(
    "UPDATE email_changes SET used_at = ? WHERE user_id = ? AND current_code_hash = ? AND new_code_hash = ? AND used_at IS NULL AND expires_at >= ?",
    iso(now),
    user.id,
    currentHash,
    newHash,
    iso(now),
  );
  if (spent.changes !== 1) throw new AuthError(400, "Those codes do not match, or they have expired. Ask for new ones.");
  const row = await deps.db.first<{ new_email: string }>("SELECT new_email FROM email_changes WHERE user_id = ? AND current_code_hash = ? AND new_code_hash = ?", user.id, currentHash, newHash);
  if (!row) throw new AuthError(400, "Those codes do not match, or they have expired. Ask for new ones.");
  const previous = user.email;
  try {
    await deps.db.run("UPDATE users SET email = ? WHERE id = ?", row.new_email, user.id);
  } catch (err) {
    if (/unique/i.test(err instanceof Error ? err.message : String(err))) throw new AuthError(409, "That address now has an account of its own.");
    throw err;
  }
  const revert = randomToken(32);
  await deps.db.batch([
    { sql: "DELETE FROM sessions WHERE user_id = ? AND id <> ?", params: [user.id, session.id] },
    { sql: "INSERT INTO email_reverts (token_hash, user_id, previous_email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", params: [await sha256(revert), user.id, previous, iso(now), plusMs(now, REVERT_DAYS * 24 * HOUR)] },
  ]);
  try {
    const notice = emailChangedNotice(row.new_email, `${deps.appUrl}/#/profile?revert=${revert}`, REVERT_DAYS);
    await deps.mail.send(previous, notice.subject, notice.text, notice.html);
  } catch {
    /* the account has moved either way, and the link stays good until it expires */
  }
  return row.new_email;
}

/**
 * Put the address back, from the link in the notice. Takes no session, and cannot: whoever reads
 * that message can no longer sign in, because the account answers to the new address.
 *
 * The token is the credential. It went to the address being taken away, whose holder could have
 * signed in before the change anyway. Every session goes, including the one that made the change.
 */
export async function revertEmail(deps: Deps, token: string): Promise<void> {
  const now = deps.now();
  const hash = await sha256(token.trim());
  const spent = await deps.db.run("UPDATE email_reverts SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND expires_at >= ?", iso(now), hash, iso(now));
  if (spent.changes !== 1) throw new AuthError(400, "This link has been used already, or it has expired.");
  const row = await deps.db.first<{ user_id: string; previous_email: string }>("SELECT user_id, previous_email FROM email_reverts WHERE token_hash = ?", hash);
  if (!row) throw new AuthError(400, "This link has been used already, or it has expired.");
  try {
    await deps.db.run("UPDATE users SET email = ?, deleted_at = NULL WHERE id = ?", row.previous_email, row.user_id);
  } catch (err) {
    if (/unique/i.test(err instanceof Error ? err.message : String(err))) throw new AuthError(409, "That address has an account of its own again. Sign in to it instead.");
    throw err;
  }
  await deps.db.run("DELETE FROM sessions WHERE user_id = ?", row.user_id);
}

/** The session a bearer token names, or nothing. Touches `last_seen_at` at most once an hour. */
export async function sessionFor(deps: Deps, token: string | undefined): Promise<Session | undefined> {
  if (!token) return undefined;
  const now = deps.now();
  const hash = await sha256(token);
  const row = await deps.db.first<{ id: string; user_id: string; expires_at: string; last_seen_at: string; email: string; handle: string | null }>(
    // `deleted_at` is set while an account waits to be deleted. Its sessions are dropped when it is
    // marked, but a token copied off a device beforehand must not answer either.
    "SELECT s.id, s.user_id, s.expires_at, s.last_seen_at, u.email, u.handle FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.deleted_at IS NULL",
    hash,
  );
  if (!row || row.expires_at < iso(now)) return undefined;
  // A device not seen for ninety days signs in again.
  if (row.last_seen_at < iso(new Date(now.getTime() - SESSION_IDLE_DAYS * 24 * HOUR))) {
    await deps.db.run("DELETE FROM sessions WHERE token_hash = ?", hash);
    return undefined;
  }
  if (row.last_seen_at < iso(new Date(now.getTime() - HOUR))) await deps.db.run("UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?", iso(now), hash);
  return { id: row.id, user: { id: row.user_id, email: row.email, handle: row.handle } };
}

export interface DeviceRow {
  id: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
}

export async function devices(deps: Deps, userId: string): Promise<DeviceRow[]> {
  const rows = await deps.db.all<{ id: string; device_name: string; created_at: string; last_seen_at: string }>("SELECT id, device_name, created_at, last_seen_at FROM sessions WHERE user_id = ? AND expires_at > ? ORDER BY last_seen_at DESC", userId, iso(deps.now()));
  return rows.map((r) => ({ id: r.id, deviceName: r.device_name, createdAt: r.created_at, lastSeenAt: r.last_seen_at }));
}

export async function signOut(deps: Deps, userId: string, sessionId: string): Promise<void> {
  await deps.db.run("DELETE FROM sessions WHERE user_id = ? AND id = ?", userId, sessionId);
}

/**
 * Everything the server holds for the user, gone.
 *
 * The sign-in rows for the address stay, because they are what the hourly and daily limits count;
 * deleting them would hand the address a fresh allowance for every account made and deleted. The
 * address is cleared out of them instead, so the row goes on counting under `email_hash` and
 * nothing on the server still spells it out. The purge takes the rows within the day either way.
 *
 * The account is marked rather than emptied, so that one request from a device cannot destroy every
 * army, game and collection with nothing to undo. Signing in again inside the grace period brings it
 * back and the purge does the real deletion after. Every session goes at once and the handle is
 * given up, so from every device that held one the account is already gone.
 */
export async function deleteAccount(deps: Deps, user: Pick<User, "id" | "email">): Promise<void> {
  await deps.db.batch([
    { sql: "UPDATE users SET deleted_at = ?, handle = NULL WHERE id = ?", params: [iso(deps.now()), user.id] },
    { sql: "DELETE FROM sessions WHERE user_id = ?", params: [user.id] },
    { sql: "UPDATE logins SET email = '' WHERE email = ?", params: [user.email] },
  ]);
}
