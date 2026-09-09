import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import type { Override, Snapshot } from "@grimstat/schema";
import { SOURCES, fetchSource, exportJson, type AdapterOutput, type SourceId } from "@grimstat/adapters";
import { applyOverrides, buildSnapshot, mergeSources, type MergeResult } from "@grimstat/snapshot";
import { exists, readDirFiles, readJson, writeText } from "../io";

export interface ImportOptions {
  system: string;
  out: string;
  sources: SourceId[];
  fromDir: string;
  label?: string;
  refresh: boolean;
  overrides?: string;
  quiet: boolean;
}

const ALL_SOURCES: SourceId[] = ["mfm-yaml", "bsdata-json", "wahapedia-csv"];
const SOURCE_ALIASES: Record<string, SourceId> = { mfm: "mfm-yaml", "mfm-yaml": "mfm-yaml", wahapedia: "wahapedia-csv", "wahapedia-csv": "wahapedia-csv", bsdata: "bsdata-json", "bsdata-json": "bsdata-json" };

export function parseImportArgs(argv: string[]): ImportOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      system: { type: "string", default: "wh40k-11e" },
      out: { type: "string", default: "data/snapshots" },
      source: { type: "string", multiple: true },
      "from-dir": { type: "string", default: "data" },
      label: { type: "string" },
      refresh: { type: "boolean", default: false },
      overrides: { type: "string" },
      quiet: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const sources = (values.source?.length ? values.source : ALL_SOURCES).map((s) => {
    const id = SOURCE_ALIASES[s.toLowerCase()];
    if (!id) throw new Error(`unknown source "${s}" (use mfm | wahapedia | bsdata)`);
    return id;
  });
  const opts: ImportOptions = { system: values.system!, out: values.out!, sources, fromDir: values["from-dir"]!, refresh: values.refresh!, quiet: values.quiet! };
  if (values.label) opts.label = values.label;
  if (values.overrides) opts.overrides = values.overrides;
  return opts;
}

/** Conventional on-disk layout under the data dir (git-ignored). */
export function localFilesFor(id: SourceId, dataDir: string): { files: Record<string, string>; ref?: string; dir: string } {
  if (id === "mfm-yaml") {
    const repoData = join(dataDir, "mfm", "repo", "data");
    const dir = exists(repoData) ? repoData : join(dataDir, "mfm");
    return { files: readDirFiles(dir, /\.ya?ml$/i), dir };
  }
  if (id === "wahapedia-csv") {
    const dir = join(dataDir, "wahapedia");
    return { files: readDirFiles(dir, /\.csv$/i), dir };
  }
  const dir = join(dataDir, "bsdata");
  const files = readDirFiles(dir, /\.json$/i);
  delete files["tree.json"];
  const shaFile = join(dir, "HEAD_SHA.txt");
  const out: { files: Record<string, string>; ref?: string; dir: string } = { files, dir };
  if (exists(shaFile)) out.ref = readJsonText(shaFile).trim();
  return out;
}

function readJsonText(path: string): string {
  return readDirFiles(resolve(path, ".."), new RegExp(`^${path.split("/").pop()!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`))[path.split("/").pop()!] ?? "";
}

export interface ImportRun {
  snapshot: Snapshot;
  path: string;
  reportPath: string;
  merge: MergeResult;
  parts: AdapterOutput[];
}

export async function runImport(opts: ImportOptions, log: (s: string) => void = console.log): Promise<ImportRun> {
  const parts: AdapterOutput[] = [];
  const fetchedAt = new Date().toISOString();
  for (const id of opts.sources) {
    const def = SOURCES[id];
    let { files, ref, dir } = localFilesFor(id, opts.fromDir);
    if (opts.refresh || Object.keys(files).length === 0) {
      log(`[${id}] downloading (${def.attribution})`);
      const fetched = await fetchSource(id, undefined, { onProgress: ({ index, total }) => (index % 10 === 0 || index === total) && log(`[${id}]   ${index}/${total}`) });
      files = fetched.files;
      ref = fetched.ref;
      dir = id === "mfm-yaml" ? join(opts.fromDir, "mfm") : dir;
      for (const [name, text] of Object.entries(files)) writeText(join(dir, name), text);
      if (ref) writeText(join(dir, "HEAD_SHA.txt"), ref + "\n");
      log(`[${id}] saved ${Object.keys(files).length} files to ${dir}`);
    } else log(`[${id}] using ${Object.keys(files).length} local files from ${dir}`);
    const t0 = Date.now();
    const parseOpts: { gameSystemId: string; fetchedAt: string; ref?: string } = { gameSystemId: opts.system, fetchedAt };
    if (ref) parseOpts.ref = ref;
    const out = def.adapter.parse(files, parseOpts);
    log(`[${id}] parsed in ${Date.now() - t0} ms: ${describe(out)}${out.warnings.length ? ` (${out.warnings.length} warnings)` : ""}`);
    if (!opts.quiet) for (const w of out.warnings.slice(0, 8)) log(`[${id}]   warn: ${w}`);
    parts.push(out);
  }

  const merge = mergeSources(parts, { gameSystem: undefined });
  log(`[merge] ${merge.conflicts.length} conflicts, ${merge.unmatched.length} unmatched, ${merge.warnings.length} warnings`);
  if (!opts.quiet) for (const w of merge.warnings.slice(0, 12)) log(`[merge]   ${w}`);
  let data = merge.data;
  if (opts.overrides) {
    const overrides = readJson<Override[]>(opts.overrides);
    const res = applyOverrides(data, overrides);
    data = res.data;
    log(`[overrides] applied ${res.applied}, missing ${res.missing.length}`);
  }
  const buildInput: Parameters<typeof buildSnapshot>[0] = { data, sources: parts.map((p) => p.sourceRef), conflicts: merge.conflicts };
  if (opts.label) buildInput.label = opts.label;
  const snapshot = await buildSnapshot(buildInput);
  const path = join(opts.out, `${snapshot.id}.json`);
  writeText(path, exportJson(snapshot));
  const reportPath = join(opts.out, `${snapshot.id}.report.json`);
  writeText(reportPath, JSON.stringify({ id: snapshot.id, checksum: snapshot.checksum, counts: counts(snapshot), conflictCategories: conflictCategories(snapshot), warnings: parts.map((p) => ({ adapter: p.sourceRef.adapter, warnings: p.warnings })), mergeWarnings: merge.warnings, unmatched: merge.unmatched }, null, 2) + "\n");
  log(`[snapshot] ${snapshot.id} -> ${path}`);
  log(`[snapshot] ${Object.entries(counts(snapshot)).map(([k, v]) => `${k}=${v}`).join(" ")}`);
  const cats = conflictCategories(snapshot);
  if (cats.length) {
    log(`[conflicts] top categories:`);
    for (const c of cats.slice(0, 12)) log(`  ${String(c.count).padStart(6)}  ${c.category}`);
  }
  return { snapshot, path, reportPath, merge, parts };
}

export function describe(o: AdapterOutput): string {
  const n = (x: unknown[] | undefined): number => x?.length ?? 0;
  return `factions=${n(o.factions)} datasheets=${n(o.datasheets)} abilities=${n(o.abilities)} detachments=${n(o.detachments)} enhancements=${n(o.enhancements)} stratagems=${n(o.stratagems)} priceRules=${n(o.priceRules)} wargearPrices=${n(o.wargearPrices)}`;
}

export function counts(s: Snapshot): Record<string, number> {
  const d = s.data;
  return {
    factions: d.factions.length,
    datasheets: d.datasheets.length,
    abilities: d.abilities.length,
    detachments: d.detachments.length,
    enhancements: d.enhancements.length,
    stratagems: d.stratagems.length,
    priceRules: d.priceRules.length,
    wargearPrices: d.wargearPrices.length,
    conflicts: s.conflicts.length,
  };
}

/** Group conflicts by entity + field shape ("datasheet.models[*].T"). */
export function conflictCategories(s: Snapshot): { category: string; count: number }[] {
  const m = new Map<string, number>();
  for (const c of s.conflicts) {
    const key = `${c.entity}.${c.field.replace(/\[[^\]]*\]/g, "[*]")}`;
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return [...m].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
}
