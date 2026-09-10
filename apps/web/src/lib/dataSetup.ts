import { BSDATA_TREE_URL, MFM_DEFAULT_URL, catalogueFactionName, isAlwaysFetchedCatalogue, type FetchLike } from "@grimstat/adapters";
import type { Snapshot } from "@grimstat/schema";

/**
 * Pure model behind first-run data setup and the upstream update check. The app never rehosts game data:
 * a visitor picks factions, the browser fetches the community sources itself (see importProgress.ts), and
 * later visits compare the stored snapshot's pinned refs (BSData git SHA, MFM version) with upstream.
 */

export type CatalogueGroup = "Imperium" | "Chaos" | "Aeldari" | "Xenos";
export const CATALOGUE_GROUPS: readonly CatalogueGroup[] = ["Imperium", "Chaos", "Aeldari", "Xenos"];

export interface CatalogueChoice {
  /** Top-level file name in the BSData repository, e.g. "Imperium - Blood Angels.json". */
  file: string;
  /** Display name without the group prefix, e.g. "Blood Angels". */
  name: string;
  group: CatalogueGroup;
}

interface GitTreeLike {
  sha: string;
  tree: Array<{ path: string; type: string }>;
}

/** Display name of a BSData catalogue file ("Imperium - Space Marines.json" → "Space Marines"). */
export function catalogueDisplayName(file: string): string {
  return catalogueFactionName(file.replace(/\.json$/i, ""));
}

function groupOf(file: string): CatalogueGroup {
  const m = /^(Imperium|Chaos|Aeldari)\s*-\s*/i.exec(file);
  if (!m) return "Xenos";
  const g = m[1]!.toLowerCase();
  return g === "imperium" ? "Imperium" : g === "chaos" ? "Chaos" : "Aeldari";
}

/** The catalogues a visitor can pick: top-level JSON files minus libraries and the game-system file, sorted by name. */
export function catalogueChoices(tree: GitTreeLike): CatalogueChoice[] {
  return tree.tree
    .filter((t) => t.type === "blob" && /\.json$/i.test(t.path) && !t.path.includes("/") && !isAlwaysFetchedCatalogue(t.path))
    .map((t) => ({ file: t.path, name: catalogueDisplayName(t.path), group: groupOf(t.path) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Refs the browser can see upstream right now. */
export interface UpstreamRefs {
  /** Git SHA of BSData/wh40k-11e main. */
  bsdataSha?: string;
  /** "mfm-v1.4@2026-09-02", built the same way the MFM adapter builds `sourceRef.ref`. */
  mfmRef?: string;
  checkedAt: string;
}

export interface Upstream extends UpstreamRefs {
  choices: CatalogueChoice[];
}

/** Mirror of the MFM adapter's ref: `mfm-v<version>[@<lastUpdated>]` from meta.yaml. */
export function mfmRefFromMeta(text: string): string | undefined {
  const version = /^version:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(text)?.[1]?.trim();
  const updated = /^lastUpdated:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(text)?.[1]?.trim();
  const parts: string[] = [];
  if (version) parts.push(`mfm-v${version}`);
  if (updated) parts.push(updated);
  return parts.length ? parts.join("@") : undefined;
}

export interface SnapshotRefs {
  bsdataSha?: string;
  mfmRef?: string;
  /** Wahapedia text is CLI-only (no CORS); such a snapshot cannot be refreshed in the browser without losing it. */
  hasWahapedia: boolean;
  /** True when every source can be fetched from a browser. */
  browserFetchable: boolean;
}

export function snapshotRefs(s: Pick<Snapshot, "sources">): SnapshotRefs {
  const out: SnapshotRefs = { hasWahapedia: false, browserFetchable: s.sources.length > 0 };
  for (const src of s.sources) {
    if (src.adapter === "bsdata-json" && src.ref) out.bsdataSha = src.ref;
    else if (src.adapter === "mfm-yaml" && src.ref) out.mfmRef = src.ref;
    else if (src.adapter === "wahapedia-csv") out.hasWahapedia = true;
    if (src.adapter !== "bsdata-json" && src.adapter !== "mfm-yaml") out.browserFetchable = false;
  }
  return out;
}

export interface UpdateStatus {
  bsdata: boolean;
  mfm: boolean;
  any: boolean;
}

/** A source counts as changed only when both the snapshot and upstream carry a ref for it and they differ. */
export function updateAvailable(s: Pick<Snapshot, "sources">, up: UpstreamRefs): UpdateStatus {
  const refs = snapshotRefs(s);
  const bsdata = Boolean(refs.bsdataSha && up.bsdataSha && refs.bsdataSha !== up.bsdataSha);
  const mfm = Boolean(refs.mfmRef && up.mfmRef && refs.mfmRef !== up.mfmRef);
  return { bsdata, mfm, any: bsdata || mfm };
}

export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** At most one upstream check per interval (one GitHub API call each; 60/hour are allowed anonymously). */
export function shouldCheck(lastCheckedIso: string | undefined, now: Date, intervalMs = UPDATE_CHECK_INTERVAL_MS): boolean {
  if (!lastCheckedIso) return true;
  const last = Date.parse(lastCheckedIso);
  if (Number.isNaN(last)) return true;
  return now.getTime() - last >= intervalMs;
}

/** Key stored when the user dismisses an update notice: it stays hidden until upstream moves again. */
export function dismissKey(snapshotId: string, up: UpstreamRefs): string {
  return `${snapshotId}|${up.bsdataSha ?? ""}|${up.mfmRef ?? ""}`;
}

export function shortSha(sha: string | undefined): string {
  return sha ? sha.slice(0, 7) : "?";
}

/** Two requests: the BSData tree (git SHA + catalogue list) and the MFM meta.yaml (version). */
export async function fetchUpstream(fetchImpl: FetchLike = globalThis.fetch as unknown as FetchLike, now = new Date()): Promise<Upstream> {
  const [treeRes, metaRes] = await Promise.all([fetchImpl(BSDATA_TREE_URL, { headers: { Accept: "application/vnd.github+json" } }), fetchImpl(`${MFM_DEFAULT_URL}meta.yaml`, { headers: { Accept: "text/plain, */*" } })]);
  if (!treeRes.ok) throw new Error(`GET ${BSDATA_TREE_URL} -> HTTP ${treeRes.status}`);
  const tree = JSON.parse(await treeRes.text()) as GitTreeLike;
  const out: Upstream = { bsdataSha: tree.sha, choices: catalogueChoices(tree), checkedAt: now.toISOString() };
  if (metaRes.ok) {
    const ref = mfmRefFromMeta(await metaRes.text());
    if (ref) out.mfmRef = ref;
  }
  return out;
}
