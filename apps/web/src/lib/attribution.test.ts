import { describe, expect, it } from "vitest";
import { SOURCES } from "@grimstat/adapters";
import { attributionFor, attributionSummary } from "./attribution";

const AT = "2026-09-10T00:00:00.000Z";

describe("snapshot attribution", () => {
  it("maps registered adapters to their attribution and licence, collecting refs", () => {
    const lines = attributionFor([
      { adapter: "wahapedia-csv", fetchedAt: AT, url: "https://wahapedia.ru/wh40k11ed/" },
      { adapter: "bsdata-json", ref: "deadbeef", fetchedAt: AT },
      { adapter: "bsdata-json", ref: "deadbeef", fetchedAt: AT },
      { adapter: "mfm-yaml", ref: "mfm-v1@2026-09-01", fetchedAt: AT },
    ]);
    expect(lines.map((l) => l.adapter)).toEqual(["wahapedia-csv", "bsdata-json", "mfm-yaml"]);
    expect(lines[0]!.attribution).toBe(SOURCES["wahapedia-csv"].attribution);
    expect(lines[0]!.attribution).toContain("Powered by Wahapedia");
    expect(lines[0]!.licence).toBe(SOURCES["wahapedia-csv"].licence);
    expect(lines[1]!.refs).toEqual(["deadbeef"]);
    expect(lines[2]!.refs).toEqual(["mfm-v1@2026-09-01"]);
  });

  it("falls back to the adapter id for unknown adapters and keeps their url", () => {
    const [line] = attributionFor([{ adapter: "hand-made", fetchedAt: AT, url: "file:///x.json" }]);
    expect(line).toEqual({ adapter: "hand-made", attribution: undefined, licence: undefined, refs: [], url: "file:///x.json" });
    expect(attributionSummary([{ adapter: "hand-made", fetchedAt: AT }, { adapter: "mfm-yaml", fetchedAt: AT }])).toBe(`hand-made · ${SOURCES["mfm-yaml"].attribution}`);
    expect(attributionFor([])).toEqual([]);
  });
});
