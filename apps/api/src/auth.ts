/**
 * Signing in with an email address and nothing else.
 *
 * `start` stores a hashed one-time code and mails a link carrying it. `finish` takes the code back
 * from the app, makes the user on the first visit, and hands out a session token that the device
 * keeps and sends with every request. Tokens and codes are stored hashed, so a copy of the database
 * signs nobody in.
 *
 * The limits exist because every start sends one email from a daily allowance of a hundred. Five
 * starts per address per hour, twenty per network address per hour, and ninety a day in all.
 */
import { hashIp, randomToken, sha256 } from "./crypto";
import { iso, plusMs, type Deps } from "./deps";

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
  const [byEmail, byIp, today] = await Promise.all([
    deps.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM logins WHERE email = ? AND created_at > ?", address, since),
    deps.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM logins WHERE ip_hash = ? AND created_at > ?", ipHash, since),
    deps.db.first<{ n: number }>("SELECT COUNT(*) AS n FROM logins WHERE created_at > ?", iso(new Date(now.getTime() - 24 * HOUR))),
  ]);
  if ((byEmail?.n ?? 0) >= LIMIT_PER_EMAIL || (byIp?.n ?? 0) >= LIMIT_PER_IP) throw new AuthError(429, "Too many sign-in emails in the last hour. Try again later.");
  if ((today?.n ?? 0) >= LIMIT_PER_DAY) throw new AuthError(503, "Sign-in is paused for today. Everything else keeps working.");
  const code = randomToken(32);
  await deps.db.run("INSERT INTO logins (code_hash, email, ip_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", await sha256(code), address, ipHash, iso(now), plusMs(now, CODE_LIFE));
  const link = `${deps.appUrl}/#/profile?code=${code}`;
  await deps.mail.send(address, "Sign in to Grimstat", `Open this link to sign in. It works once and for fifteen minutes.\n\n${link}\n\nIf you did not ask for it, ignore this message and nothing happens.`);
}

export interface Finished {
  token: string;
  session: Session;
}

export async function finish(deps: Deps, code: string, deviceName: string): Promise<Finished> {
  const now = deps.now();
  const codeHash = await sha256(code.trim());
  const login = await deps.db.first<{ email: string; expires_at: string; used_at: string | null }>("SELECT email, expires_at, used_at FROM logins WHERE code_hash = ?", codeHash);
  if (!login || login.used_at || login.expires_at < iso(now)) throw new AuthError(400, "This sign-in link has expired. Ask for a new one.");
  let user = await deps.db.first<User>("SELECT id, email, handle FROM users WHERE email = ?", login.email);
  const stmts = [{ sql: "UPDATE logins SET used_at = ? WHERE code_hash = ?", params: [iso(now), codeHash] as unknown[] }];
  if (!user) {
    user = { id: `u_${randomToken(12)}`, email: login.email, handle: null };
    stmts.push({ sql: "INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)", params: [user.id, user.email, iso(now)] });
  }
  const token = randomToken(32);
  const id = `s_${randomToken(8)}`;
  stmts.push({
    sql: "INSERT INTO sessions (token_hash, id, user_id, device_name, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    params: [await sha256(token), id, user.id, deviceName.slice(0, 120) || "Unnamed device", iso(now), iso(now), plusMs(now, SESSION_LIFE)],
  });
  await deps.db.batch(stmts);
  return { token, session: { id, user } };
}

/** The session a bearer token names, or nothing. Touches `last_seen_at` at most once an hour. */
export async function sessionFor(deps: Deps, token: string | undefined): Promise<Session | undefined> {
  if (!token) return undefined;
  const now = deps.now();
  const hash = await sha256(token);
  const row = await deps.db.first<{ id: string; user_id: string; expires_at: string; last_seen_at: string; email: string; handle: string | null }>(
    "SELECT s.id, s.user_id, s.expires_at, s.last_seen_at, u.email, u.handle FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?",
    hash,
  );
  if (!row || row.expires_at < iso(now)) return undefined;
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

/** Everything the server holds for the user, gone. */
export async function deleteAccount(deps: Deps, userId: string): Promise<void> {
  await deps.db.batch([
    { sql: "DELETE FROM records WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM links WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM sessions WHERE user_id = ?", params: [userId] },
    { sql: "DELETE FROM users WHERE id = ?", params: [userId] },
  ]);
}
