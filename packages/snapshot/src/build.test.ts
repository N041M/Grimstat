import { describe, expect, it } from "vitest";
import { buildSnapshot, normaliseData, verifySnapshot } from "./build";
import { loadSyntheticSnapshot } from "./synthetic/index";

describe("buildSnapshot", () => {
  const base = loadSyntheticSnapshot();
  const SOME_DAY = "2026-01-01T00:00:00.000Z";

  it("produces a dated id with the checksum prefix and record meta", async () => {
    const snap = await buildSnapshot({ data: base.data, now: "2026-03-04T05:06:07.000Z", label: "x", sources: base.sources });
    expect(snap.id).toBe(`snap_20260304_${snap.checksum.slice(0, 8)}`);
    expect(snap.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(snap.createdAt).toBe("2026-03-04T05:06:07.000Z");
    expect(snap.updatedAt).toBe(snap.createdAt);
    expect(snap.ownerId).toBe("local");
    expect(snap.revision).toBe(0);
    expect(snap.gameSystemId).toBe(base.data.gameSystem.id);
    expect(snap.label).toBe("x");
  });

  it("checksum ignores key order and collection order", async () => {
    const shuffled = { ...base.data, datasheets: [...base.data.datasheets].reverse().map((d) => ({ ...Object.fromEntries(Object.entries(d).reverse()) })) } as typeof base.data;
    const a = await buildSnapshot({ data: base.data });
    const b = await buildSnapshot({ data: shuffled });
    expect(b.checksum).toBe(a.checksum);
    expect(b.checksum).toBe(base.checksum);
  });

  it("changes when the data changes and verifies", async () => {
    const changed = { ...base.data, datasheets: base.data.datasheets.map((d) => (d.name === "Thornlings" ? { ...d, fallbackPoints: 65 } : d)) };
    const snap = await buildSnapshot({ data: changed });
    expect(snap.checksum).not.toBe(base.checksum);
    expect((await verifySnapshot(snap)).ok).toBe(true);
    expect((await verifySnapshot({ ...snap, checksum: "0".repeat(64) })).ok).toBe(false);
  });

  it("records the sources that did not answer, and leaves the checksum alone", async () => {
    // The checksum covers the data, so a snapshot that is missing a source has the same checksum as
    // one built from the same files without anybody asking for that source. What it is missing is
    // recorded beside the data, where a screen can read it back days later.
    const missing = [{ adapter: "wahapedia-csv", url: "https://example.test/wh40k-11e/", reason: "GET https://example.test/wh40k-11e/Factions.csv -> HTTP 404" }];
    const snap = await buildSnapshot({ data: base.data, missingSources: missing });
    expect(snap.missingSources).toEqual(missing);
    expect(snap.checksum).toBe(base.checksum);
  });

  it("says nothing about missing sources when the run got everything", async () => {
    expect((await buildSnapshot({ data: base.data })).missingSources).toBeUndefined();
    expect((await buildSnapshot({ data: base.data, missingSources: [] })).missingSources).toBeUndefined();
  });

  it("sorts collections deterministically", () => {
    const n = normaliseData({ ...base.data, factions: [...base.data.factions].reverse() });
    expect(n.factions.map((f) => f.id)).toEqual([...base.data.factions.map((f) => f.id)].sort());
  });

  it("orders wargear items by code unit so the host locale cannot move the checksum", async () => {
    const wargearPrices = [
      { datasheetId: "ds:ashen-wardens:warden-squad", item: "Zeal cannon", points: 5 },
      { datasheetId: "ds:ashen-wardens:warden-squad", item: "Åsh blade", points: 10 },
    ];
    expect(normaliseData({ ...base.data, wargearPrices }).wargearPrices.map((w) => w.item)).toEqual(["Zeal cannon", "Åsh blade"]);
    const a = await buildSnapshot({ data: { ...base.data, wargearPrices }, now: SOME_DAY });
    const b = await buildSnapshot({ data: { ...base.data, wargearPrices: [...wargearPrices].reverse() }, now: SOME_DAY });
    expect(b.checksum).toBe(a.checksum);
  });

  it("keeps the checksum stable when two keys compare equal to a collator", async () => {
    // A soft hyphen makes localeCompare report 0 for these two items while they are distinct strings.
    const wargearPrices = [
      { datasheetId: "ds:ashen-wardens:warden-squad", item: "Plasma\u00adgun", points: 5 },
      { datasheetId: "ds:ashen-wardens:warden-squad", item: "Plasmagun", points: 10 },
    ];
    const a = await buildSnapshot({ data: { ...base.data, wargearPrices }, now: SOME_DAY });
    const b = await buildSnapshot({ data: { ...base.data, wargearPrices: [...wargearPrices].reverse() }, now: SOME_DAY });
    expect(b.checksum).toBe(a.checksum);
  });

  it("sorts the glossary, and leaves the checksum of a snapshot without one alone", async () => {
    const glossary = [
      { id: "gl:torrent", name: "Torrent", key: "TORRENT", text: "b" },
      { id: "gl:blast", name: "Blast", key: "BLAST", text: "a" },
    ];
    expect(normaliseData({ ...base.data, glossary }).glossary!.map((g) => g.id)).toEqual(["gl:blast", "gl:torrent"]);
    // An empty glossary is not written, so a snapshot built before any source supplied one keeps its
    // checksum rather than being reported as changed.
    const empty = await buildSnapshot({ data: { ...base.data, glossary: [] }, now: SOME_DAY });
    const absent = await buildSnapshot({ data: { ...base.data, glossary: undefined }, now: SOME_DAY });
    expect(empty.checksum).toBe(absent.checksum);
    expect(empty.data.glossary).toBeUndefined();
    const full = await buildSnapshot({ data: { ...base.data, glossary }, now: SOME_DAY });
    expect(full.checksum).not.toBe(absent.checksum);
    expect((await verifySnapshot(full)).ok).toBe(true);
  });

  it("breaks ties between price rules of one datasheet on copy range and label", () => {
    const priceRules = [
      { datasheetId: "ds:ashen-wardens:ashen-crusher", copyRange: { min: 1 }, label: "B", tiers: [{ models: 1, points: 20 }] },
      { datasheetId: "ds:ashen-wardens:ashen-crusher", copyRange: { min: 1, max: 1 }, label: "A", tiers: [{ models: 1, points: 10 }] },
    ];
    expect(normaliseData({ ...base.data, priceRules }).priceRules.map((r) => r.label)).toEqual(["A", "B"]);
    expect(normaliseData({ ...base.data, priceRules: [...priceRules].reverse() }).priceRules.map((r) => r.label)).toEqual(["A", "B"]);
  });
});
