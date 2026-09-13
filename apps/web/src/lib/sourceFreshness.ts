/**
 * Is a stored source still the one upstream is serving?
 *
 * Each source names its own version cheaply, well short of downloading it again: the MFM index
 * carries a version, the BSData tree listing carries the sha the files were read at, and Wahapedia's
 * export carries the date it was last built. Those are the same identifiers the adapters store as a
 * source's `ref`, so the check is a string comparison against what the snapshot already holds.
 */
import { BSDATA_TREE_URL, MFM_DEFAULT_URL, parsePipeCsv } from "@grimstat/adapters";
import type { BrowserSourceId } from "./importProgress";

export type Freshness = "current" | "stale" | "unknown";

export interface FreshnessCheck {
  /** What upstream reports now. Absent when the check could not run. */
  latest?: string;
  state: Freshness;
}

export type FetchText = (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** The MFM ref is `mfm-v<version>@<faction file date>`; only the version half is cheap to read. */
function mfmVersionOf(ref: string | undefined): string | undefined {
  const head = ref?.split("@")[0]?.trim();
  return head || undefined;
}

async function text(fetchImpl: FetchText, url: string): Promise<string> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

/**
 * Ask a source what its current version is. One small request each: the MFM index, the BSData tree
 * listing (which spends one of GitHub's hourly anonymous requests) and the mirror's Last_update
 * table. Returns undefined when the source does not say.
 */
export async function latestRefFor(id: BrowserSourceId, opts: { fetch: FetchText; mirror?: string }): Promise<string | undefined> {
  if (id === "mfm-yaml") {
    const base = MFM_DEFAULT_URL.endsWith("/") ? MFM_DEFAULT_URL : MFM_DEFAULT_URL + "/";
    const version = /^\s*version:\s*["']?([^"'\n\r]+)/m.exec(await text(opts.fetch, base + "meta.yaml"))?.[1]?.trim();
    return version ? `mfm-v${version}` : undefined;
  }
  if (id === "bsdata-json") {
    const tree = JSON.parse(await text(opts.fetch, BSDATA_TREE_URL)) as { sha?: string };
    return tree.sha;
  }
  const mirror = opts.mirror?.trim();
  if (!mirror) return undefined;
  const base = mirror.endsWith("/") ? mirror : mirror + "/";
  const rows = parsePipeCsv(await text(opts.fetch, base + "Last_update.csv")).rows;
  const first = rows[0] ?? {};
  const key = Object.keys(first).find((k) => k.toLowerCase().replace(/\s+/g, "_") === "last_update");
  const value = key ? String(first[key] ?? "").trim() : "";
  return value || undefined;
}

/**
 * Compare a stored ref with what upstream reports. The MFM comparison is on the version alone, so a
 * points file rebuilt under the same version reads as current.
 */
export function freshnessOf(id: BrowserSourceId, stored: string | undefined, latest: string | undefined): Freshness {
  if (!stored || !latest) return "unknown";
  const a = id === "mfm-yaml" ? mfmVersionOf(stored) : stored.trim();
  const b = id === "mfm-yaml" ? mfmVersionOf(latest) : latest.trim();
  if (!a || !b) return "unknown";
  return a === b ? "current" : "stale";
}

/**
 * What is known about upstream once a run finishes.
 *
 * A run that fetched one source proves nothing about the others: the snapshot it produced carries
 * their refs forward untouched, and reading those back as "this is what upstream serves" would mark
 * a stale source current. Only the sources the run actually fetched move.
 */
export function knownAfterFetch(
  previous: Partial<Record<BrowserSourceId, string>>,
  fetched: readonly BrowserSourceId[],
  sources: readonly { adapter: string; ref?: string }[],
): Partial<Record<BrowserSourceId, string>> {
  const next = { ...previous };
  for (const src of sources) {
    const id = fetched.find((f) => f === src.adapter);
    if (id && src.ref) next[id] = src.ref;
  }
  return next;
}
