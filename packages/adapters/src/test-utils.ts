import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/** Absolute path of the repository's fixtures/synthetic directory. */
export const SYNTHETIC_DIR = fileURLToPath(new URL("../../../fixtures/synthetic/", import.meta.url));

export function readFixtureDir(sub: string, match: RegExp): Record<string, string> {
  const dir = join(SYNTHETIC_DIR, sub);
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).sort()) if (match.test(f)) out[f] = readFileSync(join(dir, f), "utf8");
  return out;
}
