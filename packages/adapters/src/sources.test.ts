import { describe, expect, it } from "vitest";
import { SOURCES, fetchSource, type FetchLike } from "./sources";

function stubFetch(routes: Record<string, string | ((url: string) => string)>): { fetch: FetchLike; calls: string[] } {
  const calls: string[] = [];
  const fetch: FetchLike = async (url) => {
    calls.push(url);
    const hit = Object.entries(routes).find(([k]) => url.includes(k));
    if (!hit) return { ok: false, status: 404, text: async () => "" };
    const body = typeof hit[1] === "function" ? hit[1](url) : hit[1];
    return { ok: true, status: 200, text: async () => body };
  };
  return { fetch, calls };
}

describe("sources registry", () => {
  it("lists the three sources with licence and attribution", () => {
    expect(Object.keys(SOURCES).sort()).toEqual(["bsdata-json", "mfm-yaml", "wahapedia-csv"]);
    for (const s of Object.values(SOURCES)) {
      expect(s.adapter.id).toBe(s.id);
      expect(s.defaultUrls.length).toBeGreaterThan(0);
      expect(s.licence).toBeTruthy();
      expect(s.attribution).toBeTruthy();
    }
  });

  it("fetches meta.yaml then every faction file for the MFM", async () => {
    const { fetch, calls } = stubFetch({ "meta.yaml": "version: '1'\nfactions:\n  - alpha\n  - beta\n", "alpha.yaml": "name: Alpha\nslug: alpha\nunits: []\n", "beta.yaml": "name: Beta\nslug: beta\nunits: []\n" });
    const res = await fetchSource("mfm-yaml", fetch, { urls: ["https://example.invalid/mfm/"] });
    expect(calls).toEqual(["https://example.invalid/mfm/meta.yaml", "https://example.invalid/mfm/alpha.yaml", "https://example.invalid/mfm/beta.yaml"]);
    expect(Object.keys(res.files).sort()).toEqual(["alpha.yaml", "beta.yaml", "meta.yaml"]);
    expect(SOURCES["mfm-yaml"].adapter.parse(res.files).factions!.map((f) => f.name)).toEqual(["Alpha", "Beta"]);
  });

  it("fetches every Wahapedia table", async () => {
    const { fetch, calls } = stubFetch({ ".csv": (url) => `${url.split("/").pop()!.replace(".csv", "")}|\n` });
    const res = await fetchSource("wahapedia-csv", fetch, { urls: ["https://example.invalid/wh/"] });
    expect(calls).toHaveLength(19);
    expect(res.files["Datasheets.csv"]).toBe("Datasheets|\n");
  });

  it("lists the BSData tree, pins the SHA and downloads top-level JSON files (libraries always included)", async () => {
    const tree = { sha: "deadbeef", tree: [{ path: "Necrons.json", type: "blob" }, { path: "Orks.json", type: "blob" }, { path: "Library - Titans.json", type: "blob" }, { path: "Warhammer 40,000.json", type: "blob" }, { path: ".github/x.yml", type: "blob" }, { path: "docs", type: "tree" }] };
    const { fetch, calls } = stubFetch({ "git/trees": JSON.stringify(tree), "raw.githubusercontent.com": (url) => `{"catalogue":{"name":"${decodeURIComponent(url.split("/").pop()!)}"}}` });
    const res = await fetchSource("bsdata-json", fetch, { filter: (name) => name === "Necrons.json" });
    expect(res.ref).toBe("deadbeef");
    expect(calls[0]).toContain("git/trees/main");
    expect(Object.keys(res.files).sort()).toEqual(["Library - Titans.json", "Necrons.json", "Warhammer 40,000.json"]);
    expect(calls.some((u) => u.endsWith("/deadbeef/Library%20-%20Titans.json"))).toBe(true);
  });

  it("propagates HTTP errors", async () => {
    const { fetch } = stubFetch({});
    await expect(fetchSource("mfm-yaml", fetch)).rejects.toThrow(/HTTP 404/);
  });
});
