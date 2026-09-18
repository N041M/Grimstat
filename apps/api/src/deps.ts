import type { Db } from "./db";

/** What the server sends a sign-in email through. */
export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Everything the routes need that differs between hosts and tests. */
export interface Deps {
  db: Db;
  mail: Mailer;
  /** The address the app is served from, for the links in emails. No trailing slash. */
  appUrl: string;
  /** The secret that addresses are hashed with before they are counted. */
  ipSalt: string;
  now: () => Date;
}

export const iso = (d: Date): string => d.toISOString();
export const plusMs = (d: Date, ms: number): string => iso(new Date(d.getTime() + ms));
