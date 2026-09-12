import { describe, expect, it } from "vitest";
import { isZip, looksLikeJson, looksLikeRosterXml, rosterFileKind, rostersFromJson } from "./rosterFile";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const withBom = (s: string): Uint8Array => new Uint8Array([0xef, 0xbb, 0xbf, ...bytes(s)]);

const NOW = "2026-09-09T10:00:00.000Z";
/** A complete saved army, as the database stores it. */
const roster = (id: string, name: string) => ({
  id,
  ownerId: "local",
  createdAt: NOW,
  updatedAt: NOW,
  revision: 3,
  name,
  gameSystemId: "wh40k-11e",
  snapshotId: "snap-1",
  factionId: "f1",
  battleSize: "strike-force",
  pointsLimit: 2000,
  detachments: [],
  units: [{ id: "u1", datasheetId: "ds-1", models: [{ modelProfileId: "m1", count: 5, wargear: [] }], isWarlord: false }],
});

describe("recognising a zip", () => {
  it("knows the signature, whatever the file is called", () => {
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14]))).toBe(true);
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x05, 0x06]))).toBe(true); // an empty archive
    expect(isZip(new Uint8Array([0x50, 0x4b, 0x07, 0x08]))).toBe(true); // a spanned one
  });

  it("is not fooled by text that happens to start with PK", () => {
    expect(isZip(bytes("PKZ Warband (2000 points)"))).toBe(false);
    expect(isZip(bytes(""))).toBe(false);
  });
});

describe("recognising roster XML", () => {
  it("takes a declaration or a bare roster element", () => {
    expect(looksLikeRosterXml('<?xml version="1.0"?><roster/>')).toBe(true);
    expect(looksLikeRosterXml('<roster name="Warband">')).toBe(true);
    expect(looksLikeRosterXml("  \n <ROSTER>")).toBe(true);
  });

  it("sees past a byte-order mark, which BattleScribe writes", () => {
    expect(looksLikeRosterXml('\uFEFF<?xml version="1.0"?>')).toBe(true);
  });

  it("rejects a text list, and XML that is not a roster", () => {
    expect(looksLikeRosterXml("Warband (2000 points)\n\nChar1: Captain")).toBe(false);
    expect(looksLikeRosterXml("<html><body>")).toBe(false);
    expect(looksLikeRosterXml("")).toBe(false);
  });
});

describe("recognising JSON", () => {
  it("takes an object or an array, behind a byte-order mark or not", () => {
    expect(looksLikeJson('{"format":"grimstat-rosters"}')).toBe(true);
    expect(looksLikeJson("  \n [1]")).toBe(true);
    expect(looksLikeJson("\uFEFF{}")).toBe(true);
  });

  it("rejects text lists and XML", () => {
    expect(looksLikeJson("Warband (2000 points)")).toBe(false);
    expect(looksLikeJson("<roster/>")).toBe(false);
    expect(looksLikeJson("")).toBe(false);
  });
});

describe("reading rosters out of JSON", () => {
  it("reads the Export-all envelope", () => {
    const text = JSON.stringify({ format: "grimstat-rosters", version: 1, exportedAt: NOW, rosters: [roster("r1", "First"), roster("r2", "Second")] });
    const out = rostersFromJson(text);
    expect(out?.rosters.map((r) => [r.id, r.name])).toEqual([
      ["r1", "First"],
      ["r2", "Second"],
    ]);
    expect(out?.skipped).toBe(0);
  });

  it("reads one saved army", () => {
    const out = rostersFromJson(JSON.stringify(roster("r1", "Solo")));
    expect(out?.rosters).toHaveLength(1);
    expect(out?.rosters[0]?.units[0]?.models[0]?.count).toBe(5);
    expect(rostersFromJson("\uFEFF" + JSON.stringify(roster("r1", "Solo")))?.rosters).toHaveLength(1);
  });

  it("skips envelope entries that are not rosters and keeps the rest", () => {
    const text = JSON.stringify({ format: "grimstat-rosters", version: 1, rosters: [roster("r1", "Good"), { id: "r2" }, "junk"] });
    const out = rostersFromJson(text);
    expect(out?.rosters.map((r) => r.id)).toEqual(["r1"]);
    expect(out?.skipped).toBe(2);
  });

  it("returns nothing for other JSON, arrays and broken text", () => {
    expect(rostersFromJson(JSON.stringify({ format: "grimstat-export", version: 1, stores: {} }))).toBeUndefined();
    expect(rostersFromJson(JSON.stringify({ format: "grimstat-rosters", version: 1 }))).toBeUndefined();
    expect(rostersFromJson(JSON.stringify([roster("r1", "In an array")]))).toBeUndefined();
    expect(rostersFromJson("{ not json")).toBeUndefined();
    expect(rostersFromJson("null")).toBeUndefined();
  });
});

describe("choosing what to do with a file", () => {
  it("sorts the four shapes apart", () => {
    expect(rosterFileKind(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("zip");
    expect(rosterFileKind(bytes('<?xml version="1.0"?><roster/>'))).toBe("xml");
    expect(rosterFileKind(withBom("<roster/>"))).toBe("xml");
    expect(rosterFileKind(bytes('{"format":"grimstat-rosters","rosters":[]}'))).toBe("json");
    expect(rosterFileKind(withBom("  {}"))).toBe("json");
    expect(rosterFileKind(bytes("Warband (2000 points)"))).toBe("text");
  });

  it("does not need the whole file to decide", () => {
    const long = bytes(`<?xml version="1.0"?><roster>${"<selection/>".repeat(5000)}</roster>`);
    expect(rosterFileKind(long)).toBe("xml");
  });
});
