import { describe, expect, it } from "vitest";
import { freshnessOf, knownAfterFetch, latestRefFor, type FetchText } from "./sourceFreshness";

const serve = (body: Record<string, string>): FetchText => async (url: string) => {
  const key = Object.keys(body).find((k) => url.endsWith(k));
  return key === undefined
    ? { ok: false, status: 404, text: async () => "" }
    : { ok: true, status: 200, text: async () => body[key]! };
};

describe("latestRefFor", () => {
  it("reads the MFM version from the index", async () => {
    const ref = await latestRefFor("mfm-yaml", { fetch: serve({ "meta.yaml": 'version: "1.5"\nfactions:\n  - orks\n' }) });
    expect(ref).toBe("mfm-v1.5");
  });

  it("reads the sha the BSData tree listing was served at", async () => {
    const ref = await latestRefFor("bsdata-json", { fetch: serve({ "trees/main": JSON.stringify({ sha: "abc123", tree: [] }) }) });
    expect(ref).toBe("abc123");
  });

  it("reads the mirror's last update", async () => {
    const ref = await latestRefFor("wahapedia-csv", { fetch: serve({ "Last_update.csv": "last_update|\n2026-09-11 01:31:12|\n" }), mirror: "https://example.test/wh40k-11e" });
    expect(ref).toBe("2026-09-11 01:31:12");
  });

  it("says nothing when no mirror is set", async () => {
    expect(await latestRefFor("wahapedia-csv", { fetch: serve({}) })).toBeUndefined();
  });
});

describe("freshnessOf", () => {
  it("compares the MFM version and ignores the file date after it", () => {
    expect(freshnessOf("mfm-yaml", "mfm-v1.4@2026-09-02", "mfm-v1.4")).toBe("current");
    expect(freshnessOf("mfm-yaml", "mfm-v1.4@2026-09-02", "mfm-v1.5")).toBe("stale");
  });

  it("compares the other sources whole", () => {
    expect(freshnessOf("bsdata-json", "abc123", "abc123")).toBe("current");
    expect(freshnessOf("bsdata-json", "abc123", "def456")).toBe("stale");
    expect(freshnessOf("wahapedia-csv", "2026-09-11 01:31:12", "2026-09-12 04:00:00")).toBe("stale");
  });

  it("is unknown when either side is missing", () => {
    expect(freshnessOf("bsdata-json", undefined, "abc123")).toBe("unknown");
    expect(freshnessOf("bsdata-json", "abc123", undefined)).toBe("unknown");
  });
});

describe("knownAfterFetch", () => {
  const sources = [
    { adapter: "mfm-yaml", ref: "mfm-v0.1@2026-01-01" },
    { adapter: "wahapedia-csv", ref: "2026-09-13 03:43:55" },
  ];

  it("moves only the source the run fetched", () => {
    const next = knownAfterFetch({ "mfm-yaml": "mfm-v1.5" }, ["wahapedia-csv"], sources);
    expect(next["wahapedia-csv"]).toBe("2026-09-13 03:43:55");
    // The run carried MFM's stored ref into the new snapshot; that is not news from upstream.
    expect(next["mfm-yaml"]).toBe("mfm-v1.5");
  });

  it("records every source of a full run", () => {
    const next = knownAfterFetch({}, ["mfm-yaml", "wahapedia-csv"], sources);
    expect(next).toEqual({ "mfm-yaml": "mfm-v0.1@2026-01-01", "wahapedia-csv": "2026-09-13 03:43:55" });
  });

  it("leaves a source that came back without a ref alone", () => {
    expect(knownAfterFetch({ "bsdata-json": "abc" }, ["bsdata-json"], [{ adapter: "bsdata-json" }])["bsdata-json"]).toBe("abc");
  });
});
