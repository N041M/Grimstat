import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ACCOUNT_DELETE_GRACE_DAYS } from "@grimstat/schema";
import { en } from "../i18n/en";

/**
 * The privacy notice says the server holds a listed set of things "and nothing else", and states how
 * long each is kept. Both are claims about code in `apps/api`.
 *
 * These read the server's own files rather than importing them, so that a claim in the web app's
 * dictionary does not make the web app depend on the server package. A table added to a migration,
 * or a retention changed, fails here and names what moved.
 */

const here = dirname(fileURLToPath(import.meta.url));
const api = join(here, "..", "..", "..", "api");

function migrations(): string {
  const dir = join(api, "migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"))
    .join("\n");
}

const source = (file: string) => readFileSync(join(api, "src", file), "utf8");

/** A whole number written out, as the notice writes them. */
const WORDS: Record<number, string> = { 1: "a day", 30: "thirty days", 90: "ninety days", 365: "a year" };

describe("what the notice says the server holds", () => {
  /**
   * Every table the migrations create, and the bullet that accounts for it. The notice describes
   * each in its own words rather than by table name, so the mapping is written here and the test
   * only checks that nothing exists without one.
   */
  const ACCOUNTED_FOR: Record<string, string> = {
    users: "privacy.serverAccount",
    records: "privacy.serverRecords",
    sessions: "privacy.serverDevices",
    logins: "privacy.serverLogins",
    links: "privacy.serverLinks",
    email_changes: "privacy.serverEmailChange",
    email_reverts: "privacy.serverEmailChange",
    // Not about anyone: the list of migrations already applied.
    migrations: "",
  };

  it("has a bullet for every table the server creates", () => {
    const created = [...migrations().matchAll(/CREATE TABLE(?: IF NOT EXISTS)?\s+(\w+)/gi)].map((m) => (m[1] as string).toLowerCase());
    const unaccounted = [...new Set(created)].filter((t) => !(t in ACCOUNTED_FOR));
    expect(unaccounted, "a table with nothing in the notice accounting for it").toEqual([]);
  });

  it("names a string that exists for each table it accounts for", () => {
    for (const key of Object.values(ACCOUNTED_FOR)) {
      if (key) expect(en, `${key} is missing`).toHaveProperty(key);
    }
  });

  it("says the two rows behind a change of sign-in address hold an address each", () => {
    const sql = migrations();
    expect(sql).toContain("new_email");
    expect(sql).toContain("previous_email");
    const bullet = en["privacy.serverEmailChange"] as string;
    expect(bullet).toMatch(/new address/i);
    expect(bullet).toMatch(/previous address/i);
  });
});

describe("how long the notice says things are kept", () => {
  /**
   * The value of a `const NAME = <arithmetic>;` in one of the server's files. The arithmetic is
   * written in named units (`365 * 24 * HOUR`), so a name on the right-hand side is looked up in the
   * same file and substituted. Only products of integers survive that.
   */
  const number = (file: string, name: string): number => {
    const text = source(file);
    const read = (of: string): string => {
      const m = new RegExp(`\\b${of}\\s*=\\s*([0-9A-Z_*+\\s]+?);`).exec(text);
      if (!m) throw new Error(`${of} not found in ${file}`);
      return (m[1] as string).replace(/\b[A-Z_]{2,}\b/g, (unit) => `(${read(unit)})`);
    };
    // The expression reaching here is integer literals and operators, read out of our own source.
    return Number(new Function(`return ${read(name)}`)());
  };

  it("quotes the account grace period the server enforces", () => {
    expect(en["privacy.keepAccount"]).toContain("{days}");
    expect(ACCOUNT_DELETE_GRACE_DAYS).toBe(30);
  });

  it("quotes the session lifetimes the server enforces", () => {
    expect(number("purge.ts", "SESSION_IDLE_DAYS")).toBe(90);
    expect(number("auth.ts", "SESSION_LIFE")).toBe(365 * 24 * 60 * 60 * 1000);
    const kept = en["privacy.keepSessions"] as string;
    expect(kept).toContain(WORDS[90]);
    expect(kept).toContain(WORDS[365]);
  });

  it("quotes the time a change of address can be put back", () => {
    expect(number("auth.ts", "REVERT_DAYS")).toBe(30);
    expect(en["privacy.keepEmailChange"]).toContain(WORDS[30]);
    expect(en["privacy.keepEmailChange"]).toContain(WORDS[1]);
  });

  it("quotes the life of a link made without an account", () => {
    expect(number("links.ts", "ANON_LIFE")).toBe(90 * 24 * 60 * 60 * 1000);
    expect(en["privacy.keepLinks"]).toContain(WORDS[90]);
  });
});

describe("what the notice says a share link carries", () => {
  it("promises that notes and the account stay behind", () => {
    const said = en["privacy.local5"] as string;
    expect(said).toMatch(/notes/i);
    expect(said).toMatch(/account/i);
  });
});

describe("what the notice says about the script Cloudflare adds", () => {
  /**
   * The notice says the script does not run. The built page's content policy is what keeps that
   * true: it admits an inline script only by hash, and Cloudflare's bootstrap carries a token that
   * changes on every response, so no fixed hash matches it. Adding `unsafe-inline` to `script-src`
   * would let it run, which is what this reads for.
   *
   * If Cloudflare ever serves the check as `<script src="/cdn-cgi/...">` instead of inline, `'self'`
   * admits it and the sentence has to go. That half cannot be tested here.
   */
  it("keeps a content policy that admits no inline script it has not hashed", () => {
    const config = readFileSync(join(here, "..", "..", "vite.config.ts"), "utf8");
    const scriptSrc = /"(script-src [^"]*)"/.exec(config)?.[1];
    expect(scriptSrc, "script-src not found in apps/web/vite.config.ts").toBeTruthy();
    expect(scriptSrc, "an inline script would run, and the notice says none does").not.toContain("'unsafe-inline'");
    expect(scriptSrc, "inline scripts are admitted by hash, which is what blocks the injected one").toContain("{hashes}");
  });

  it("promises the injected script does not run", () => {
    expect(en["privacy.processors4"]).toMatch(/does not run/i);
  });
});
