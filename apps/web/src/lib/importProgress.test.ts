import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { wahapediaUrlFor } from "@grimstat/adapters";
import { IDLE_PROGRESS, WAHAPEDIA_DEV_PROXY, WAHAPEDIA_EDITIONS, catalogueFilter, catalogueTerms, classifyError, fetchedLabel, hasMirror, importRequestFor, isRunning, isSameFetch, rebuildRequestFor, refreshRequestFor, reduceProgress, rulesTextState, sourcesToFetch, wahapediaMirrorBase, withoutRulesText, type BrowserSourceId, type HeldFetch, type ImportProgress, type ImportRequest, type ImportSummary, type SourceCounts } from "./importProgress";

const COUNTS: SourceCounts = { factions: 1, datasheets: 2, abilities: 3, detachments: 4, enhancements: 5, stratagems: 6, priceRules: 7, wargearPrices: 8 };
const SUMMARY: ImportSummary = { snapshotId: "snap_20260910_abcdef01", label: "Fetched 2026-09-10", checksum: "abcdef01", counts: COUNTS, conflicts: 0, sources: [{ adapter: "mfm-yaml", ref: "mfm-v1" }], missingSources: [], elapsedMs: 1234 };
const NOW = new Date("2026-09-10T12:34:56Z");

describe("catalogue filter", () => {
  it("splits comma-separated terms and matches file names case-insensitively", () => {
    expect(catalogueTerms(" Necrons , space marines,, ")).toEqual(["necrons", "space marines"]);
    const f = catalogueFilter("necrons, Space Marines")!;
    expect(f("Necrons.json")).toBe(true);
    expect(f("Imperium - Space Marines.json")).toBe(true);
    expect(f("Orks.json")).toBe(false);
  });

  it("is absent for blank input so the fetch stays unfiltered", () => {
    expect(catalogueFilter("")).toBeUndefined();
    expect(catalogueFilter(" , ,")).toBeUndefined();
  });
});

const MIRROR = "https://raw.githubusercontent.com/someone/mirror/main/";
const all = (over: Partial<Record<"mfm-yaml" | "bsdata-json" | "wahapedia-csv", boolean>> = {}) => ({ "mfm-yaml": true, "bsdata-json": true, "wahapedia-csv": true, ...over });

describe("what a snapshot holds of the rules text", () => {
  const failed = { adapter: "wahapedia-csv", url: "https://mirror.test/wh40k-11e/", reason: "GET https://mirror.test/wh40k-11e/Factions.csv -> HTTP 404" };

  it("reads it from the snapshot, so the answer outlives the run that built it", () => {
    expect(rulesTextState({ sources: [{ adapter: "mfm-yaml" }, { adapter: "wahapedia-csv" }] })).toEqual({ state: "present" });
    expect(rulesTextState({ sources: [{ adapter: "mfm-yaml" }] })).toEqual({ state: "absent" });
    expect(rulesTextState({ sources: [{ adapter: "mfm-yaml" }], missingSources: [failed] })).toEqual({ state: "failed", url: failed.url, reason: failed.reason });
  });

  it("tells a mirror that was never asked for apart from one that did not answer", () => {
    // The two need different advice. Telling somebody to set up a mirror they have already set up
    // is what sent the last one looking in the wrong place.
    expect(rulesTextState({ sources: [] }).state).toBe("absent");
    expect(rulesTextState({ sources: [], missingSources: [failed] }).state).toBe("failed");
  });

  it("answers for a snapshot stored before any of this was recorded", () => {
    expect(rulesTextState(undefined).state).toBe("absent");
    expect(rulesTextState({}).state).toBe("absent");
  });
});

describe("Fix data: rebuilding what is already here", () => {
  const base = [
    { adapter: "mfm-yaml", fetchedAt: "2026-09-14T00:00:00.000Z", url: "https://mfm.test/", ref: "mfm-v1.4" },
    { adapter: "bsdata-json", fetchedAt: "2026-09-14T00:00:00.000Z", url: "https://bs.test/", ref: "sha" },
  ];

  it("asks for no source, so the files on this machine are what it reads", () => {
    const req = rebuildRequestFor(base, NOW);
    expect(req.sources).toEqual([]);
    expect(req.base).toBe(base);
    expect(req.label).toBe("Rebuilt 2026-09-10");
    expect(req.wahapediaMirror).toBeUndefined();
  });

  it("downloads nothing while every source of the snapshot has its files here", () => {
    const held = (id: BrowserSourceId): HeldFetch | undefined => {
      const src = base.find((b) => b.adapter === id);
      return src ? { url: src.url, ref: src.ref, fetchedAt: src.fetchedAt } : undefined;
    };
    expect(sourcesToFetch(rebuildRequestFor(base, NOW), held)).toEqual([]);
    // One whose files are not here is downloaded, rather than dropped out of the rebuild.
    expect(sourcesToFetch(rebuildRequestFor(base, NOW), (id) => (id === "bsdata-json" ? undefined : held(id)))).toEqual(["bsdata-json"]);
  });
});

describe("the run offered after a mirror will not answer", () => {
  it("drops the rules text export and the address it failed at, and keeps the rest", () => {
    const req = importRequestFor({ sources: all(), factionFilter: "Necrons" }, NOW, MIRROR);
    const without = withoutRulesText(req);
    expect(without.sources).toEqual(["mfm-yaml", "bsdata-json"]);
    expect(without.wahapediaMirror).toBeUndefined();
    expect(without.catalogueFilter).toBe("Necrons");
    expect(without.label).toBe(req.label);
    // The request it was made from is untouched, so a retry still asks for everything.
    expect(req.sources).toContain("wahapedia-csv");
  });
});

describe("selection → worker request", () => {
  it("keeps the canonical source order, forwards the filter only with BSData and labels by date", () => {
    const req = importRequestFor({ sources: all(), factionFilter: " Necrons " }, NOW, MIRROR);
    expect(req).toEqual({
      gameSystemId: "wh40k-11e",
      sources: ["mfm-yaml", "bsdata-json", "wahapedia-csv"],
      catalogueFilter: "Necrons",
      wahapediaMirror: `${MIRROR}wh40k-11e/`,
      label: "Fetched 2026-09-10 · Necrons",
    });
    const pointsOnly = importRequestFor({ sources: all({ "bsdata-json": false, "wahapedia-csv": false }), factionFilter: "Necrons" }, NOW, MIRROR);
    expect(pointsOnly.sources).toEqual(["mfm-yaml"]);
    expect(pointsOnly.catalogueFilter).toBeUndefined();
    expect(pointsOnly.label).toBe("Fetched 2026-09-10");
    expect(importRequestFor({ sources: all({ "mfm-yaml": false }), factionFilter: " " }, NOW, MIRROR).catalogueFilter).toBeUndefined();
    expect(fetchedLabel(NOW)).toBe("Fetched 2026-09-10");
  });

  it("leaves Wahapedia out when no mirror is configured, so the run still goes ahead", () => {
    for (const mirror of [undefined, "", "   "]) {
      const req = importRequestFor({ sources: all(), factionFilter: "" }, NOW, mirror);
      expect(req.sources, String(mirror)).toEqual(["mfm-yaml", "bsdata-json"]);
      expect(req.wahapediaMirror).toBeUndefined();
    }
  });

  it("points the mirror at the edition's own directory, however the URL was typed", () => {
    expect(wahapediaMirrorBase("https://x/y/", "wh40k-11e")).toBe("https://x/y/wh40k-11e/");
    expect(wahapediaMirrorBase("https://x/y", "wh40k-10e")).toBe("https://x/y/wh40k-10e/");
    expect(wahapediaMirrorBase("  https://x/y///  ", "wh40k-11e")).toBe("https://x/y/wh40k-11e/");
    expect(hasMirror(undefined)).toBe(false);
    expect(hasMirror("  ")).toBe(false);
    expect(hasMirror(MIRROR)).toBe(true);
  });
});

describe("progress reducer", () => {
  it("walks a run from start to done", () => {
    let p: ImportProgress = reduceProgress(IDLE_PROGRESS, { type: "start", sources: ["mfm-yaml", "bsdata-json"] });
    expect(p.stage).toBe("fetching");
    expect(isRunning(p)).toBe(true);
    expect(p.sources.map((s) => [s.id, s.stage])).toEqual([
      ["mfm-yaml", "pending"],
      ["bsdata-json", "pending"],
    ]);
    p = reduceProgress(p, { type: "downloading", source: "bsdata-json", index: 3, total: 12 });
    expect(p.sources[1]).toMatchObject({ stage: "downloading", index: 3, total: 12 });
    expect(p.sources[0]!.stage).toBe("pending");
    p = reduceProgress(p, { type: "parsing", source: "bsdata-json", files: 12, ref: "deadbeef" });
    expect(p.sources[1]).toMatchObject({ stage: "parsing", index: 12, files: 12, ref: "deadbeef" });
    p = reduceProgress(p, { type: "parsed", source: "bsdata-json", warnings: 2, sample: ["a", "b"], counts: COUNTS });
    expect(p.sources[1]).toMatchObject({ stage: "parsed", warnings: 2, sample: ["a", "b"], counts: COUNTS, ref: "deadbeef" });
    p = reduceProgress(p, { type: "parsed", source: "mfm-yaml", warnings: 0, sample: [], counts: COUNTS, ref: "mfm-v1" });
    p = reduceProgress(p, { type: "merging" });
    expect(p.stage).toBe("merging");
    p = reduceProgress(p, { type: "merged", conflicts: 5, warnings: 1, unmatched: 9 });
    expect(p.merge).toEqual({ conflicts: 5, warnings: 1, unmatched: 9 });
    p = reduceProgress(p, { type: "building" });
    expect(p.stage).toBe("building");
    p = reduceProgress(p, { type: "done", summary: SUMMARY });
    expect(p.stage).toBe("done");
    expect(p.summary).toBe(SUMMARY);
    expect(isRunning(p)).toBe(false);
    // the per-source detail survives for the result view
    expect(p.sources[0]!.ref).toBe("mfm-v1");
  });

  it("records failures and cancellation, ignores events for unknown sources or outside a run", () => {
    const started = reduceProgress(IDLE_PROGRESS, { type: "start", sources: ["mfm-yaml"] });
    const failed = reduceProgress(started, { type: "failed", source: "mfm-yaml", message: "HTTP 404" });
    expect(failed.sources[0]).toMatchObject({ stage: "failed", message: "HTTP 404" });
    const errored = reduceProgress(failed, { type: "error", message: "GET x -> HTTP 404", kind: "other" });
    expect(errored.stage).toBe("error");
    expect(errored.error).toEqual({ message: "GET x -> HTTP 404", kind: "other" });
    // late worker message after the run ended: no change
    expect(reduceProgress(errored, { type: "downloading", source: "mfm-yaml", index: 1, total: 2 })).toBe(errored);
    // a source that is not part of this run: no change
    expect(reduceProgress(started, { type: "downloading", source: "bsdata-json", index: 1, total: 2 })).toBe(started);
    const cancelled = reduceProgress(reduceProgress(started, { type: "downloading", source: "mfm-yaml", index: 3, total: 9 }), { type: "cancelled" });
    expect(cancelled).toEqual({ stage: "cancelled", sources: [] });
    expect(reduceProgress(errored, { type: "reset" })).toBe(IDLE_PROGRESS);
    // idle state ignores worker events entirely
    expect(reduceProgress(IDLE_PROGRESS, { type: "merging" })).toBe(IDLE_PROGRESS);
  });
});

describe("error classification", () => {
  it("tells GitHub API quota, connectivity and cancellation apart", () => {
    expect(classifyError(new Error("GET https://api.github.com/repos/BSData/wh40k-11e/git/trees/main -> HTTP 403"))).toBe("rate-limit");
    expect(classifyError(new Error("GET https://raw.githubusercontent.com/x -> HTTP 429"))).toBe("rate-limit");
    expect(classifyError(new TypeError("Failed to fetch"))).toBe("network");
    expect(classifyError(new Error("GET https://raw.githubusercontent.com/x -> HTTP 502"))).toBe("network");
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(classifyError(abort)).toBe("cancelled");
    expect(classifyError(new Error("GET https://raw.githubusercontent.com/x -> HTTP 404"))).toBe("other");
    expect(classifyError("boom")).toBe("other");
  });
});

describe("the dev proxy", () => {
  it("keeps the config's copy of the path and the edition list in step with this module", async () => {
    const config = await readFile(new URL("../../vite.config.ts", import.meta.url), "utf8");
    expect(config).toContain(`const WAHAPEDIA_DEV_PROXY = "${WAHAPEDIA_DEV_PROXY}"`);
    for (const id of WAHAPEDIA_EDITIONS) expect(config, id).toContain(`"${id}":`);
    // The upstream paths the config rewrites to are the ones the adapter names.
    for (const id of WAHAPEDIA_EDITIONS) expect(config).toContain(new URL(wahapediaUrlFor(id)).pathname.replace(/\/$/, ""));
  });

  it("points the mirror base at the proxy's own directory for the edition", () => {
    expect(wahapediaMirrorBase(WAHAPEDIA_DEV_PROXY, "wh40k-11e")).toBe("/wahapedia/wh40k-11e/");
  });
});

describe("refreshRequestFor", () => {
  const base = [{ adapter: "mfm-yaml", fetchedAt: "2026-01-01T00:00:00.000Z" }];
  const sel = { sources: { "mfm-yaml": true, "bsdata-json": true, "wahapedia-csv": true }, factionFilter: "orks" };

  it("asks for the one source and carries the sources of the snapshot it rebuilds", () => {
    const req = refreshRequestFor("mfm-yaml", sel, base, new Date("2026-09-13T00:00:00.000Z"));
    expect(req.sources).toEqual(["mfm-yaml"]);
    expect(req.base).toBe(base);
    expect(req.label).toBe("MFM updated 2026-09-13");
  });

  it("keeps the faction filter, whichever source was asked for", () => {
    // The filter decides which factions the rebuilt snapshot keeps, not just which catalogues are
    // downloaded, so it applies to every refresh rather than to BSData's alone.
    expect(refreshRequestFor("bsdata-json", sel, base, new Date("2026-09-13T00:00:00.000Z")).catalogueFilter).toBe("orks");
    expect(refreshRequestFor("mfm-yaml", sel, base, new Date("2026-09-13T00:00:00.000Z")).catalogueFilter).toBe("orks");
    expect(refreshRequestFor("mfm-yaml", { ...sel, factionFilter: "  " }, base, new Date()).catalogueFilter).toBeUndefined();
  });

  it("passes the mirror whichever source was asked for", () => {
    // Any refresh can pull Wahapedia into the run, because a source with no files kept here is
    // downloaded alongside the one that was asked for.
    expect(refreshRequestFor("wahapedia-csv", sel, base, new Date(), "https://example.test/mirror/").wahapediaMirror).toContain("https://example.test/mirror/");
    expect(refreshRequestFor("mfm-yaml", sel, base, new Date(), "https://example.test/mirror/").wahapediaMirror).toContain("https://example.test/mirror/");
    expect(refreshRequestFor("mfm-yaml", sel, base, new Date(), "  ").wahapediaMirror).toBeUndefined();
  });
});

describe("sourcesToFetch", () => {
  const AT = "2026-01-01T00:00:00.000Z";
  const stored = [
    { adapter: "mfm-yaml", fetchedAt: AT, url: "https://mfm.test/" },
    { adapter: "bsdata-json", fetchedAt: AT, url: "https://bsdata.test/", ref: "abc123" },
    { adapter: "wahapedia-csv", fetchedAt: AT, url: "https://waha.test/" },
  ];
  const files: Record<string, HeldFetch> = {
    "mfm-yaml": { url: "https://mfm.test/", fetchedAt: AT },
    "bsdata-json": { url: "https://bsdata.test/", ref: "abc123", fetchedAt: AT },
    "wahapedia-csv": { url: "https://waha.test/", fetchedAt: AT },
  };
  const request = (sources: BrowserSourceId[], base = stored): ImportRequest => ({ gameSystemId: "wh40k-11e", sources, label: "x", base });
  const held = (have: Partial<Record<BrowserSourceId, HeldFetch>>) => (id: BrowserSourceId) => have[id];

  it("downloads only the source asked for when the others are here", () => {
    expect(sourcesToFetch(request(["bsdata-json"]), held(files))).toEqual(["bsdata-json"]);
    expect(sourcesToFetch(request(["mfm-yaml"]), held(files))).toEqual(["mfm-yaml"]);
    expect(sourcesToFetch(request(["wahapedia-csv"]), held(files))).toEqual(["wahapedia-csv"]);
  });

  it("downloads a source whose files are not here", () => {
    const { "mfm-yaml": _gone, ...rest } = files;
    expect(sourcesToFetch(request(["bsdata-json"]), held(rest))).toEqual(["mfm-yaml", "bsdata-json"]);
  });

  it("downloads a source whose files came from a different download", () => {
    // The snapshot was built from one download and the files here are from another, so re-reading
    // them would rebuild a snapshot that is not the one being updated.
    const other = { ...files, "wahapedia-csv": { url: "https://waha.test/", fetchedAt: "2026-02-02T00:00:00.000Z" } };
    expect(sourcesToFetch(request(["mfm-yaml"]), held(other))).toEqual(["mfm-yaml", "wahapedia-csv"]);
    const moved = { ...files, "bsdata-json": { url: "https://bsdata.test/", ref: "def456", fetchedAt: AT } };
    expect(sourcesToFetch(request(["mfm-yaml"]), held(moved))).toEqual(["mfm-yaml", "bsdata-json"]);
  });

  it("downloads everything when nothing is here", () => {
    expect(sourcesToFetch(request(["mfm-yaml"]), held({}))).toEqual(["mfm-yaml", "bsdata-json", "wahapedia-csv"]);
  });

  it("returns the canonical order whichever source was asked for", () => {
    expect(sourcesToFetch(request(["wahapedia-csv"]), held({}))).toEqual(["mfm-yaml", "bsdata-json", "wahapedia-csv"]);
  });

  it("asks for nothing beyond the selection when there is no snapshot to rebuild", () => {
    const req: ImportRequest = { gameSystemId: "wh40k-11e", sources: ["mfm-yaml", "bsdata-json"], label: "x" };
    expect(sourcesToFetch(req, held({}))).toEqual(["mfm-yaml", "bsdata-json"]);
  });

  it("keeps a source of the snapshot that only one of its two records matches", () => {
    const twoOfThree = { "mfm-yaml": files["mfm-yaml"]!, "bsdata-json": files["bsdata-json"]! };
    expect(sourcesToFetch(request(["mfm-yaml"]), held(twoOfThree))).toEqual(["mfm-yaml", "wahapedia-csv"]);
  });
});

describe("isSameFetch", () => {
  const AT = "2026-01-01T00:00:00.000Z";

  it("matches the download a snapshot was built from", () => {
    expect(isSameFetch({ adapter: "mfm-yaml", fetchedAt: AT, url: "https://mfm.test/" }, { url: "https://mfm.test/", fetchedAt: AT })).toBe(true);
  });

  it("treats a source with no url on either side as a match", () => {
    expect(isSameFetch({ adapter: "mfm-yaml", fetchedAt: AT }, { url: "", fetchedAt: AT })).toBe(true);
  });

  it("rejects a different time, url or ref", () => {
    const stored = { adapter: "bsdata-json", fetchedAt: AT, url: "https://bsdata.test/", ref: "abc" };
    expect(isSameFetch(stored, { url: "https://bsdata.test/", ref: "abc", fetchedAt: "2026-03-03T00:00:00.000Z" })).toBe(false);
    expect(isSameFetch(stored, { url: "https://elsewhere.test/", ref: "abc", fetchedAt: AT })).toBe(false);
    expect(isSameFetch(stored, { url: "https://bsdata.test/", ref: "def", fetchedAt: AT })).toBe(false);
    expect(isSameFetch(stored, { url: "https://bsdata.test/", fetchedAt: AT })).toBe(false);
  });
});
