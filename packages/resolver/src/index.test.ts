import { describe, expect, it } from "vitest";
import { Roster, Snapshot, type PriceRule } from "@grimstat/schema";
import { createContext } from "./index";

const NOW = "2026-01-01T00:00:00.000Z";

function snapshotWith(priceRules: PriceRule[]): Snapshot {
  return Snapshot.parse({
    id: "snap_20260101_00000000",
    gameSystemId: "wh40k-11e",
    checksum: "0".repeat(64),
    createdAt: NOW,
    updatedAt: NOW,
    data: {
      gameSystem: { id: "wh40k-11e", name: "Warhammer 40,000", edition: "11" },
      datasheets: [{ id: "ds:a", gameSystemId: "wh40k-11e", factionId: "faction:f", name: "A", models: [{ id: "mp:a", name: "A", T: 4, Sv: 3, W: 1 }] }],
      priceRules,
    },
  });
}

function rosterWith(copies: number): Roster {
  return Roster.parse({
    id: "roster:1",
    name: "R",
    gameSystemId: "wh40k-11e",
    snapshotId: "snap_20260101_00000000",
    factionId: "faction:f",
    createdAt: NOW,
    updatedAt: NOW,
    units: Array.from({ length: copies }, (_, i) => ({ id: `u${i + 1}`, datasheetId: "ds:a", models: [{ modelProfileId: "mp:a", count: 1 }] })),
  });
}

const band = (min: number, max: number | undefined, points: number): PriceRule => ({
  datasheetId: "ds:a",
  copyRange: max === undefined ? { min } : { min, max },
  tiers: [{ models: 1, points }],
});

describe("unit cost: price bands", () => {
  it("charges each copy from the band that covers it", () => {
    const ctx = createContext(rosterWith(3), snapshotWith([band(1, 1, 100), band(2, 2, 150), band(3, 3, 200)]));
    expect(ctx.roster.units.map((u) => ctx.unitCost(u).base)).toEqual([100, 150, 200]);
    expect(ctx.roster.units.flatMap((u) => ctx.unitCost(u).notes)).toEqual([]);
  });

  it("takes the nearest band and says so for a copy past the last band", () => {
    const ctx = createContext(rosterWith(4), snapshotWith([band(1, 1, 100), band(2, 2, 150), band(3, 3, 200)]));
    const fourth = ctx.unitCost(ctx.roster.units[3]!);
    expect(fourth.base).toBe(200);
    expect(fourth.notes).toEqual(["No price band covers copy 4; used the band for copies 3."]);
  });

  it("prefers the band that starts latest over an open band that also covers the copy", () => {
    const ctx = createContext(rosterWith(3), snapshotWith([band(1, undefined, 100), band(3, undefined, 200)]));
    expect(ctx.roster.units.map((u) => ctx.unitCost(u).base)).toEqual([100, 100, 200]);
  });

  it("falls back to the datasheet points when the snapshot has no rule", () => {
    const snap = snapshotWith([]);
    snap.data.datasheets[0]!.fallbackPoints = 55;
    const ctx = createContext(rosterWith(1), snap);
    const cost = ctx.unitCost(ctx.roster.units[0]!);
    expect(cost.base).toBe(55);
    expect(cost.notes).toEqual(["Using fallback points (no price rule in snapshot)."]);
  });
});
