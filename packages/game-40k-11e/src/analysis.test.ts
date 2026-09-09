import { describe, expect, it } from "vitest";
import { archetypes, durabilityProfile, efficiencyRanking, runMatrix } from "./index";

const byId = (id: string) => archetypes.find((a) => a.id === id)!.unit;

describe("army-level analyses", () => {
  it("matrix runs every pair and reports per-100-point damage", () => {
    const m = runMatrix([byId("bolter-squad"), byId("melta-squad")], [byId("marine-like"), byId("heavy-tank")], { rangeBand: "half" });
    expect(m.cells.length).toBe(2);
    expect(m.cells[0]!.length).toBe(2);
    expect(m.cells[1]![1]!.result.expectedDamage).toBeGreaterThan(m.cells[0]![1]!.result.expectedDamage); // melta beats bolters into a tank
    expect(m.cells[0]![0]!.damagePer100).toBeGreaterThan(0);
  });
  it("durability profile covers the default attacker archetypes", () => {
    const d = durabilityProfile(byId("terminator-like"));
    expect(d.length).toBe(4);
    for (const e of d) expect(e.expectedDamage).toBeGreaterThanOrEqual(0);
  });
  it("efficiency ranking sorts descending and ranks melee-only units in the fight phase", () => {
    const rows = efficiencyRanking([byId("bolter-squad"), byId("lascannon-team"), byId("melta-squad"), byId("chainsword-mob")]);
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1]!.damagePer100).toBeGreaterThanOrEqual(rows[i]!.damagePer100);
    expect(rows.find((r) => r.unit.includes("Melee horde"))!.damagePer100).toBeGreaterThan(0);
    const m = runMatrix([byId("chainsword-mob")], [byId("marine-like")]);
    expect(m.cells[0]![0]!.result.expectedDamage).toBeGreaterThan(0);
    expect(m.cells[0]![0]!.result.finalState).toBeUndefined();
  });
});
