/**
 * The server on Node, for a local run and as the fallback host. SQLite in a file, sign-in links
 * printed to the console, and the same routes as on Cloudflare.
 *
 *   pnpm --filter @grimstat/api dev
 *
 * The web app's dev server sends /api and /l here (see vite.config.ts), so a local sign-in works
 * end to end: the link is in this terminal.
 */
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { sqliteDb } from "./db";
import type { Mailer } from "./deps";

const here = dirname(fileURLToPath(import.meta.url));

/** Prints the message to the terminal instead of sending it. */
const terminalMailer: Mailer = {
  async send(to, subject, text) {
    process.stdout.write(`\n--- mail to ${to}: ${subject}\n${text}\n---\n\n`);
  },
};

/** Apply every migration file, in name order, that this database has not seen. */
export function migrate(sqlite: DatabaseSync, dir = join(here, "..", "migrations")): void {
  sqlite.exec("CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const done = new Set((sqlite.prepare("SELECT name FROM migrations").all() as Array<{ name: string }>).map((r) => r.name));
  for (const name of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(name)) continue;
    sqlite.exec(readFileSync(join(dir, name), "utf8"));
    sqlite.prepare("INSERT INTO migrations (name, applied_at) VALUES (?, ?)").run(name, new Date().toISOString());
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const dataDir = join(here, "..", "..", "..", "data");
  mkdirSync(dataDir, { recursive: true });
  const sqlite = new DatabaseSync(join(dataDir, "api.sqlite"));
  migrate(sqlite);
  const port = Number(process.env.PORT ?? 8787);
  const app = createApp({
    db: sqliteDb(sqlite),
    mail: terminalMailer,
    appUrl: process.env.APP_URL ?? "http://localhost:5173",
    ipSalt: "local",
    now: () => new Date(),
  });
  serve({ fetch: app.fetch, port }, () => process.stdout.write(`grimstat api on http://localhost:${port}\n`));
}
