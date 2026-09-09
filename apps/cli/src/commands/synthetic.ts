import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { Snapshot } from "@grimstat/schema";
import { exportJson, parseBsdataJson, parseMfmYaml, parseWahapediaCsv, type AdapterOutput } from "@grimstat/adapters";
import { buildSnapshot, mergeSources, type MergeResult } from "@grimstat/snapshot";
import { REPO_ROOT, readDirFiles, writeText } from "../io";

export const SYNTHETIC_DIR = join(REPO_ROOT, "fixtures", "synthetic");
export const SYNTHETIC_OUTPUTS = [join(SYNTHETIC_DIR, "snapshot.json"), join(REPO_ROOT, "packages", "snapshot", "src", "synthetic", "snapshot.json")];
/** Fixed timestamp so the fixture is byte-for-byte reproducible. */
export const SYNTHETIC_NOW = "2026-01-01T00:00:00.000Z";

export function parseSyntheticParts(dir = SYNTHETIC_DIR): AdapterOutput[] {
  const opts = { fetchedAt: SYNTHETIC_NOW };
  return [
    parseMfmYaml(readDirFiles(join(dir, "mfm"), /\.ya?ml$/), { ...opts, url: "fixture://mfm/" }),
    parseBsdataJson(readDirFiles(join(dir, "bsdata"), /\.json$/), { ...opts, url: "fixture://bsdata/", ref: "synthetic" }),
    parseWahapediaCsv(readDirFiles(join(dir, "wahapedia"), /\.csv$/), { ...opts, url: "fixture://wahapedia/" }),
  ];
}

export async function buildSyntheticSnapshot(dir = SYNTHETIC_DIR): Promise<{ snapshot: Snapshot; merge: MergeResult; parts: AdapterOutput[] }> {
  const parts = parseSyntheticParts(dir);
  const merge = mergeSources(parts);
  const snapshot = await buildSnapshot({ data: merge.data, sources: parts.map((p) => p.sourceRef), conflicts: merge.conflicts, label: "synthetic fixture", now: SYNTHETIC_NOW });
  return { snapshot, merge, parts };
}

/** Regenerate the committed synthetic snapshot (or, with `check`, verify it is up to date). */
export async function runSynthetic(check: boolean, log: (s: string) => void = console.log): Promise<boolean> {
  const { snapshot, merge, parts } = await buildSyntheticSnapshot();
  const text = exportJson(snapshot);
  for (const p of parts) for (const w of p.warnings) log(`[${p.sourceRef.adapter}] warn: ${w}`);
  for (const w of merge.warnings) log(`[merge] ${w}`);
  log(`[synthetic] ${snapshot.id} conflicts=${snapshot.conflicts.length} datasheets=${snapshot.data.datasheets.length}`);
  let ok = true;
  for (const out of SYNTHETIC_OUTPUTS) {
    if (check) {
      let current = "";
      try {
        current = readFileSync(out, "utf8");
      } catch {
        current = "";
      }
      if (current !== text) {
        ok = false;
        log(`[synthetic] OUT OF DATE: ${out}`);
      }
    } else {
      writeText(out, text);
      log(`[synthetic] wrote ${out}`);
    }
  }
  return ok;
}
