import { describe, expect, it } from "vitest";
import type { Roster } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { unitFromRosterUnit, unitFromDatasheet, parseLoadout } from "./index";

const snapshot = loadSyntheticSnapshot();
const now = new Date().toISOString();
const roster: Roster = {
  id: "r", ownerId: "local", createdAt: now, updatedAt: now, revision: 0, name: "t", gameSystemId: snapshot.gameSystemId, snapshotId: snapshot.id,
  factionId: "faction:ashen-wardens", battleSize: "incursion", pointsLimit: 1000,
  detachments: [{ id: "d1", detachmentId: "det:ashen-wardens:ember-vanguard" }],
  units: [
    { id: "u1", datasheetId: "ds:ashen-wardens:warden-squad", models: [{ modelProfileId: "mp:ashen-wardens:warden-squad:warden-sergeant", count: 1, wargear: ["Flux carbine", "Power fist"] }, { modelProfileId: "mp:ashen-wardens:warden-squad:warden", count: 9, wargear: ["Flux carbine", "Shock maul"] }], isWarlord: false },
    { id: "u2", datasheetId: "ds:ashen-wardens:warden-captain", models: [{ modelProfileId: "mp:ashen-wardens:warden-captain:warden-captain", count: 1, wargear: ["Flux pistol", "Relic blade"] }], attachedTo: { unitId: "u1", role: "leader" }, enhancementId: "enh:ashen-wardens:ember-blade", isWarlord: true },
    { id: "u3", datasheetId: "ds:ashen-wardens:ashen-crusher", models: [{ modelProfileId: "mp:ashen-wardens:ashen-crusher:ashen-crusher", count: 1, wargear: ["Fusion beamer", "Crusher fists"] }], isWarlord: false },
  ],
};

describe("unitFromRosterUnit", () => {
  it("applies model counts, wargear selection, attached characters and tiered points", () => {
    const u = unitFromRosterUnit(roster.units[0]!, roster, snapshot);
    expect(u.name).toContain("Warden Squad (+Warden Captain)");
    expect(u.models.map((m) => `${m.name}x${m.count}`)).toEqual(["Warden Sergeantx1", "Wardenx9", "Warden Captainx1"]);
    const on = u.weapons.filter((w) => w.enabled).map((w) => `${w.name}x${w.count}`);
    expect(on).toEqual(expect.arrayContaining(["Flux carbinex10", "Shock maulx9", "Power fistx1", "Warden Captain: Flux pistolx1", "Warden Captain: Relic bladex1"]));
    expect(u.points).toBe(180 + 80 + 15);
  });
  it("enables a selected non-loadout weapon and disables unselected loadout weapons", () => {
    const u = unitFromRosterUnit(roster.units[2]!, roster, snapshot);
    const byName = Object.fromEntries(u.weapons.map((w) => [w.name, w]));
    expect(byName["Fusion beamer"]!.enabled).toBe(true);
    expect(byName["Fusion beamer"]!.count).toBe(1);
    expect(byName["Twin hail gun"]!.enabled).toBe(false);
    expect(byName["Crusher fists"]!.enabled).toBe(true);
    expect(u.points).toBe(150 + 10);
  });
});

describe("parseLoadout", () => {
  it("separates every-model weapons from profile-specific ones and ignores option text", () => {
    const squad = snapshot.data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-squad")!;
    const p = parseLoadout(squad);
    expect(p.all).toEqual(["flux carbine", "shock maul"]);
    expect(p.byProfile["warden sergeant"]).toEqual(["power fist"]);
    const u = unitFromDatasheet(squad, snapshot, { modelCount: 10 });
    const by = Object.fromEntries(u.weapons.map((w) => [w.name, w]));
    expect(by["Flux carbine"]!.count).toBe(10);
    expect(by["Power fist"]!.count).toBe(1);
    expect(by["Power fist"]!.enabled).toBe(true);
  });
});
