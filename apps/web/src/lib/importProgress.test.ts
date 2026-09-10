import { describe, expect, it } from "vitest";
import { IDLE_PROGRESS, catalogueFilter, catalogueTerms, classifyError, fetchedLabel, importRequestFor, isRunning, reduceProgress, type ImportProgress, type ImportSummary, type SourceCounts } from "./importProgress";

const COUNTS: SourceCounts = { factions: 1, datasheets: 2, abilities: 3, detachments: 4, enhancements: 5, stratagems: 6, priceRules: 7, wargearPrices: 8 };
const SUMMARY: ImportSummary = { snapshotId: "snap_20260910_abcdef01", label: "Fetched 2026-09-10", checksum: "abcdef01", counts: COUNTS, conflicts: 0, sources: [{ adapter: "mfm-yaml", ref: "mfm-v1" }], elapsedMs: 1234 };
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

describe("selection → worker request", () => {
  it("keeps the canonical source order, forwards the filter only with BSData and labels by date", () => {
    const req = importRequestFor({ sources: { "bsdata-json": true, "mfm-yaml": true }, factionFilter: " Necrons " }, NOW);
    expect(req).toEqual({ gameSystemId: "wh40k-11e", sources: ["mfm-yaml", "bsdata-json"], catalogueFilter: "Necrons", label: "Fetched 2026-09-10 · Necrons" });
    const pointsOnly = importRequestFor({ sources: { "bsdata-json": false, "mfm-yaml": true }, factionFilter: "Necrons" }, NOW);
    expect(pointsOnly.sources).toEqual(["mfm-yaml"]);
    expect(pointsOnly.catalogueFilter).toBeUndefined();
    expect(pointsOnly.label).toBe("Fetched 2026-09-10");
    expect(importRequestFor({ sources: { "bsdata-json": true, "mfm-yaml": false }, factionFilter: " " }, NOW).catalogueFilter).toBeUndefined();
    expect(fetchedLabel(NOW)).toBe("Fetched 2026-09-10");
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
