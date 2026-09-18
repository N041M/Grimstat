/**
 * The device's side of an account: the session it holds and the calls it makes.
 *
 * The session token lives in `settings` under a key that never syncs. Everything here is a plain
 * request to the API, which is same-origin on the site and proxied by the dev server.
 */
import type { DeviceInfo, UserInfo } from "../services/auth";
import { db, type GrimstatDb } from "../db";

export const SESSION_SETTING = "account.session";
export const CURSOR_SETTING = "sync.cursor";
export const LAST_SYNC_SETTING = "sync.lastAt";

export interface StoredSession {
  token: string;
  sessionId: string;
  user: { id: string; email: string; handle: string | null };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly pausedUntil?: string,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** One JSON call. Throws `ApiError` with the server's own sentence on anything but success. */
export async function api<T>(fetchImpl: FetchLike, method: string, path: string, body?: unknown, token?: string): Promise<T> {
  const res = await fetchImpl(path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }
  if (!res.ok) {
    const err = (parsed ?? {}) as { error?: string; pausedUntil?: string };
    throw new ApiError(res.status, err.error ?? `The server answered ${res.status}.`, err.pausedUntil);
  }
  return parsed as T;
}

export async function readSession(store: GrimstatDb = db): Promise<StoredSession | undefined> {
  const s = (await store.settings.get(SESSION_SETTING))?.value as StoredSession | undefined;
  return s && typeof s.token === "string" && s.user?.id ? s : undefined;
}

export async function writeSession(s: StoredSession | undefined, store: GrimstatDb = db): Promise<void> {
  if (s) await store.settings.put({ key: SESSION_SETTING, value: s, updatedAt: new Date().toISOString() });
  else await store.settings.delete(SESSION_SETTING);
}

export const userInfo = (s: StoredSession): UserInfo => ({ id: s.user.id, displayName: s.user.handle ?? s.user.email, anonymous: false });

/** A short name for this device, for the Profile page's list. */
export function deviceName(): string {
  if (typeof navigator === "undefined") return "Device";
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? "iPhone" : /Android/.test(ua) ? "Android" : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Device";
  const browser = /Firefox\//.test(ua) ? "Firefox" : /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return browser ? `${browser} on ${os}` : os;
}

export interface MeResponse {
  session: { id: string; user: { id: string; email: string; handle: string | null } };
  devices: DeviceInfo[];
}
