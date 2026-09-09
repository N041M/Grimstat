import { describe, expect, it } from "vitest";
import { buildSnapshot, normaliseData, verifySnapshot } from "./build";
import { loadSyntheticSnapshot } from "./synthetic/index";

describe("buildSnapshot", () => {
  const base = loadSyntheticSnapshot();

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

  it("sorts collections deterministically", () => {
    const n = normaliseData({ ...base.data, factions: [...base.data.factions].reverse() });
    expect(n.factions.map((f) => f.id)).toEqual([...base.data.factions.map((f) => f.id)].sort());
  });
});
