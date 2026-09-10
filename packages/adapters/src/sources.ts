import type { Adapter } from "./types";
import { mfmYamlAdapter, MFM_DEFAULT_URL } from "./mfm-yaml/index";
import { wahapediaCsvAdapter, WAHAPEDIA_BASE_URL, WAHAPEDIA_TABLES } from "./wahapedia-csv/index";
import { bsdataJsonAdapter, BSDATA_RAW_URL, BSDATA_TREE_URL } from "./bsdata-json/index";

export type SourceId = "mfm-yaml" | "wahapedia-csv" | "bsdata-json";

/** Wahapedia keeps one export per edition; the same adapter reads both. */
export const WAHAPEDIA_BASE_URL_10E = "https://wahapedia.ru/wh40k10ed/";

export function wahapediaUrlFor(gameSystemId: string): string {
  return gameSystemId === "wh40k-10e" ? WAHAPEDIA_BASE_URL_10E : WAHAPEDIA_BASE_URL;
}

/** Sources that carry data for a game system. MFM YAML and BSData JSON are 11th-edition only. */
export function sourcesForSystem(gameSystemId: string): SourceId[] {
  return gameSystemId === "wh40k-10e" ? ["wahapedia-csv"] : ["mfm-yaml", "bsdata-json", "wahapedia-csv"];
}

export interface SourceDef {
  id: SourceId;
  adapter: Adapter;
  /** Entry-point URLs. Some sources expand these into many files (see `fetchSource`). */
  defaultUrls: string[];
  licence: string;
  attribution: string;
  /** Short description of what the source is authoritative for. */
  role: string;
}

export const SOURCES: Record<SourceId, SourceDef> = {
  "mfm-yaml": {
    id: "mfm-yaml",
    adapter: mfmYamlAdapter,
    defaultUrls: [MFM_DEFAULT_URL],
    licence: "MIT (repository); points values (c) Games Workshop",
    attribution: "BSData/wh40k-11e-mfm — daily scrape of the online Munitorum Field Manual",
    role: "points, Detachment Points, unique tags, leader/support lists",
  },
  "wahapedia-csv": {
    id: "wahapedia-csv",
    adapter: wahapediaCsvAdapter,
    defaultUrls: [WAHAPEDIA_BASE_URL],
    licence: "Permission-style terms: attribute as 'Powered by Wahapedia'; text (c) Games Workshop",
    attribution: "Powered by Wahapedia (https://wahapedia.ru)",
    role: "datasheets, stats, weapons, abilities, stratagems, enhancements, detachment rules",
  },
  "bsdata-json": {
    id: "bsdata-json",
    adapter: bsdataJsonAdapter,
    defaultUrls: [BSDATA_TREE_URL],
    licence: "No licence stated on the data repository; data (c) Games Workshop",
    attribution: "BSData/wh40k-11e (https://github.com/BSData/wh40k-11e)",
    role: "buildable structure: option trees, unit sizes, leader/support associations",
  },
};

export type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface FetchSourceOptions {
  /** Override the entry URL(s) (e.g. a mirror or a pinned git SHA). */
  urls?: string[];
  /** Called once per downloaded file. */
  onProgress?: (info: { url: string; index: number; total: number }) => void;
  /** For bsdata-json: only download catalogues whose file name matches (libraries and the game system are always included). */
  filter?: (fileName: string) => boolean;
}

export interface FetchedSource {
  id: SourceId;
  /** File name (as the adapter expects it) -> file content. */
  files: Record<string, string>;
  /** Upstream ref when the fetch discovered one (e.g. git SHA). */
  ref?: string;
  url: string;
}

async function getText(fetchImpl: FetchLike, url: string): Promise<string> {
  const res = await fetchImpl(url, { headers: { Accept: "application/vnd.github+json, text/plain, */*" } });
  if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
  return res.text();
}

interface GitTree {
  sha: string;
  tree: { path: string; type: string }[];
}

/**
 * Download the files a source needs. `fetchImpl` is injectable so this works in the browser (window.fetch)
 * and in tests (a stub). Nothing is cached here — callers decide where the files live.
 */
export async function fetchSource(id: SourceId, fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike, opts: FetchSourceOptions = {}): Promise<FetchedSource> {
  const def = SOURCES[id];
  const entry = opts.urls?.[0] ?? def.defaultUrls[0];
  if (!entry) throw new Error(`source ${id} has no URL`);
  const files: Record<string, string> = {};
  const progress = (url: string, index: number, total: number): void => opts.onProgress?.({ url, index, total });

  if (id === "mfm-yaml") {
    const base = entry.endsWith("/") ? entry : entry + "/";
    const meta = await getText(fetchImpl, base + "meta.yaml");
    files["meta.yaml"] = meta;
    const slugs = [...meta.matchAll(/^\s*-\s*([a-z0-9-]+)\s*$/gm)].map((m) => m[1] as string);
    let i = 0;
    for (const slug of slugs) {
      const url = `${base}${slug}.yaml`;
      progress(url, ++i, slugs.length);
      files[`${slug}.yaml`] = await getText(fetchImpl, url);
    }
    return { id, files, url: base };
  }

  if (id === "wahapedia-csv") {
    const base = entry.endsWith("/") ? entry : entry + "/";
    let i = 0;
    for (const table of WAHAPEDIA_TABLES) {
      const url = `${base}${table}.csv`;
      progress(url, ++i, WAHAPEDIA_TABLES.length);
      files[`${table}.csv`] = await getText(fetchImpl, url);
    }
    return { id, files, url: base };
  }

  // bsdata-json: list the repository tree, then download every top-level JSON file.
  const treeText = await getText(fetchImpl, entry);
  const tree = JSON.parse(treeText) as GitTree;
  const names = tree.tree
    .filter((t) => t.type === "blob" && /\.json$/i.test(t.path) && !t.path.includes("/"))
    .map((t) => t.path)
    .filter((p) => {
      if (!opts.filter) return true;
      if (/library/i.test(p) || /^Warhammer 40,000\.json$/i.test(p)) return true;
      return opts.filter(p);
    });
  const raw = `${BSDATA_RAW_URL}${tree.sha}/`;
  let i = 0;
  for (const name of names) {
    const url = raw + encodeURIComponent(name);
    progress(url, ++i, names.length);
    files[name] = await getText(fetchImpl, url);
  }
  return { id, files, ref: tree.sha, url: raw };
}
