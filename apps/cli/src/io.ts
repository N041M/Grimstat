import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root (this file lives in apps/cli/src). */
export const REPO_ROOT = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

export function readDirFiles(dir: string, match: RegExp): Record<string, string> {
  if (!existsSync(dir)) return {};
  const out: Record<string, string> = {};
  for (const f of readdirSync(dir).sort()) if (match.test(f)) out[f] = readFileSync(join(dir, f), "utf8");
  return out;
}

export function writeText(path: string, text: string): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, text);
}

export function readJson<T = unknown>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function exists(path: string): boolean {
  return existsSync(path);
}
