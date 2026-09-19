import type { Db } from "./db";
import type { RateLimiter } from "./limits";

/** What the server sends a sign-in email through. */
export interface Mailer {
  /** `html` is the same message set for a mail client that shows it; the text form is the fallback. */
  send(to: string, subject: string, text: string, html?: string): Promise<void>;
}

/** Everything the routes need that differs between hosts and tests. */
export interface Deps {
  db: Db;
  mail: Mailer;
  /** The address the app is served from, for the links in emails. No trailing slash. */
  appUrl: string;
  /** The secret that addresses are hashed with before they are counted. */
  ipSalt: string;
  /** Requests per address, per kind, per minute. */
  limiter: RateLimiter;
  /**
   * The origins a browser may send a state-changing request from, besides `appUrl`'s own. A
   * request that names another origin is refused before it is read. A request naming none, as a
   * command-line tool sends, is allowed, since it carries no one's credentials but its own.
   */
  extraOrigins?: string[];
  now: () => Date;
}

export const iso = (d: Date): string => d.toISOString();
export const plusMs = (d: Date, ms: number): string => iso(new Date(d.getTime() + ms));

/** Midnight UTC after `now`, when Cloudflare's daily allowances start again. */
export function nextReset(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}
