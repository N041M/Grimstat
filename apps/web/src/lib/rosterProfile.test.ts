import { describe, expect, it } from "vitest";
import type { Roster, Snapshot } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { deploymentCensus, threatProfile } from "./rosterProfile";

const snapshot: Snapshot = loadSyntheticSnapshot();
const now = "2026-09-10T10:00:00.000Z";

function roster(units: Roster["units"]): Roster {
  return { id: "r", ownerId: "local", createdAt: now, updatedAt: now, revision: 0, name: "t", gameSystemId: snapshot.gameSystemId, snapshotId: snapshot.id, factionId: "faction:ashen-wardens", battleSize: "strike-force", pointsLimit: 2000, detachments: [], units };
}

const squad = { id: "u1", datasheetId: "ds:ashen-wardens:warden-squad", models: [{ modelProfileId: "mp:ashen-wardens:warden-squad:warden-sergeant", count: 1, wargear: ["Flux carbine"] }, { modelProfileId: "mp:ashen-wardens:warden-squad:warden", count: 4, wargear: ["Flux carbine"] }], isWarlord: false };
const crusher = { id: "u2", datasheetId: "ds:ashen-wardens:ashen-crusher", models: [{ modelProfileId: "mp:ashen-wardens:ashen-crusher:ashen-crusher", count: 1, wargear: ["Vortex cannon", "Crusher fists"] }], isWarlord: false };

describe("threatProfile", () => {
  it("adds movement to the longest weapon range, and a charge for melee", () => {
    const { rows } = threatProfile(roster([squad, crusher]), snapshot);
    const byName = Object.fromEntries(rows.map((r) => [r.unit, r]));
    const c = byName["Ashen Crusher"]!;
    expect(c.move).toBeGreaterThan(0);
    expect(c.shooting).toBe((c.move ?? 0) + 36); // vortex cannon
    expect(c.melee).toBe((c.move ?? 0) + 7); // crusher fists, average charge
  });

  it("sorts by reach and buckets units into bands", () => {
    const { rows, bands } = threatProfile(roster([squad, crusher]), snapshot);
    const reach = (r: (typeof rows)[number]) => Math.max(r.shooting ?? 0, r.melee ?? 0);
    expect(reach(rows[0]!)).toBeGreaterThanOrEqual(reach(rows[1]!));
    expect(bands.reduce((s, b) => s + b.units, 0)).toBe(2);
    expect(bands.map((b) => b.label)).toEqual(['≤12"', '≤18"', '≤24"', '≤36"', '≤48"', '48"+']);
  });

  it("returns nothing to report for an empty army", () => {
    const { rows, bands } = threatProfile(roster([]), snapshot);
    expect(rows).toEqual([]);
    expect(bands.every((b) => b.units === 0)).toBe(true);
  });
});

describe("deploymentCensus", () => {
  it("counts every unit, defaulting to standard deployment when nothing is tagged", () => {
    const rows = deploymentCensus(roster([squad, crusher]), snapshot);
    expect(rows.reduce((s, r) => s + r.units, 0)).toBe(2);
    expect(rows.every((r) => ["DEEP STRIKE", "SCOUTS", "INFILTRATORS", "STANDARD"].includes(r.kind))).toBe(true);
    const standard = rows.find((r) => r.kind === "STANDARD");
    if (standard) expect(standard.models).toBeGreaterThan(0);
  });

  it("leaves attached characters out of the count, since they deploy with their host", () => {
    const captain = { id: "u3", datasheetId: "ds:ashen-wardens:warden-captain", models: [{ modelProfileId: "mp:ashen-wardens:warden-captain:warden-captain", count: 1, wargear: [] }], attachedTo: { unitId: "u1", role: "leader" as const }, isWarlord: true };
    expect(deploymentCensus(roster([squad, captain]), snapshot).reduce((s, r) => s + r.units, 0)).toBe(1);
  });
});
