import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { importRosterText } from "@grimstat/adapters";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { omittedDefaults, readWargearOptions } from "./loadout";
import { unitFromDatasheet, unitFromRosterUnit } from "./resolve";
import { makeScenario } from "./analysis";
import { runScenario } from "./scenario";

const snapshot: Snapshot = loadSyntheticSnapshot();
const ROSTERS = fileURLToPath(new URL("../../../fixtures/synthetic/rosters/", import.meta.url));
const listed = (file: string): Roster => importRosterText(readFileSync(join(ROSTERS, file), "utf8"), snapshot).roster;
const sheet = (id: string) => snapshot.data.datasheets.find((d) => d.id === `ds:ashen-wardens:${id}`)!;
const unitOf = (r: Roster, id: string): RosterUnit => r.units.find((u) => u.datasheetId === `ds:ashen-wardens:${id}`)!;
const weapons = (r: Roster, u: RosterUnit) => Object.fromEntries(unitFromRosterUnit(u, r, snapshot).weapons.map((w) => [w.name, w]));
const held = (r: Roster, u: RosterUnit) =>
  unitFromRosterUnit(u, r, snapshot).weapons.filter((w) => w.enabled).map((w) => `${w.name}x${w.count}`).sort();

/**
 * The GW app's attached-unit blocks print a unit's swapped and chosen weapons and leave the rest of
 * the default loadout out. Read as a full selection, a Warden Squad written that way loses the shock
 * maul every model carries and the sergeant's power fist, which leaves it with nothing to fight with.
 */
/**
 * A default the list leaves out comes back as many as the datasheet gives one model, not as one.
 * The prose writes a vehicle's pair of guns as "2 heavy bolters", and a list that mentions neither
 * of them used to get a single gun back.
 */
describe("a default the list does not mention", () => {
  const twin = () => {
    const base = sheet("ashen-crusher");
    return { ...base, loadout: "This model is equipped with: 2 vortex cannons; crusher fists.", wargearOptions: [] };
  };

  it("comes back as many as one model carries", () => {
    const ds = twin();
    expect(omittedDefaults(ds, [{ modelProfileId: ds.models[0]!.id, count: 1, wargear: [] }]).get("vortex cannon")).toBe(2);
  });

  it("counts the models as well as the copies", () => {
    const ds = twin();
    expect(omittedDefaults(ds, [{ modelProfileId: ds.models[0]!.id, count: 3, wargear: [] }]).get("vortex cannon")).toBe(6);
  });
});

describe("a list that names only part of a unit's loadout", () => {
  const roster = listed("gw-app-attached.txt");

  it("gives the Warden Squad back the weapons the block does not mention", () => {
    const squad = unitOf(roster, "warden-squad");
    expect(squad.models.map((g) => g.wargear.join("+"))).toEqual(["Flux carbine", "Flux carbine"]);
    expect(held(roster, squad)).toEqual(["Flux carbinex10", "Power fistx1", "Shock maulx10", "Warden Captain: Flux pistolx1", "Warden Captain: Relic bladex1"]);
  });

  it("leaves the squad fighting as hard as the same unit built from the datasheet", () => {
    const fromList = unitFromRosterUnit(unitOf(roster, "warden-squad"), roster, snapshot);
    const fromSheet = unitFromDatasheet(sheet("warden-squad"), snapshot, { modelCount: 10, attachedDatasheetIds: ["ds:ashen-wardens:warden-captain"] });
    const melee = (u: typeof fromList) => u.weapons.filter((w) => w.enabled && w.kind === "melee").map((w) => `${w.name}x${w.count}`);
    expect(melee(fromList)).toEqual(melee(fromSheet));
  });

  it("keeps the Ashen Crusher's crusher fists, which no option can take away", () => {
    const w = weapons(roster, unitOf(roster, "ashen-crusher"));
    expect(w["Crusher fists"]!.enabled).toBe(true);
    expect(w["Crusher fists"]!.count).toBe(1);
  });

  /**
   * The line offers a vortex cannon in place of the twin hail gun, and the block names a vortex
   * cannon — but the default loadout already gives the model that one, so nothing in the list says
   * the hail gun was given up for a second.
   */
  it("keeps the Ashen Crusher's twin hail gun, because the vortex cannon it lists is its own", () => {
    const w = weapons(roster, unitOf(roster, "ashen-crusher"));
    expect(w["Twin hail gun"]!.enabled).toBe(true);
    expect(w["Vortex cannon"]!.enabled).toBe(true);
    expect(w["Fusion beamer"]!.enabled).toBe(false);
  });

  // The Crusher has no attached character to fight for it, so with its fists switched off the
  // calculator reported a flat 0.0 for the whole unit the moment the phase was set to Fight.
  it("no longer leaves the Ashen Crusher doing nothing in the Fight phase", () => {
    const attacker = unitFromRosterUnit(unitOf(roster, "ashen-crusher"), roster, snapshot);
    const defender = unitFromDatasheet(sheet("warden-squad"), snapshot, { modelCount: 10 });
    const fight = makeScenario(attacker, defender, { phase: "fight", charged: true });
    expect(runScenario(fight, { snapshot }).expectedDamage).toBeGreaterThan(0);
  });
});

/** A weapon the list does name is never touched, whichever dialect wrote it. */
describe("a list that names a unit's whole loadout", () => {
  it.each(["gw-app.txt", "listbot.txt", "wtc-compact.txt", "new-recruit.txt"])("keeps every weapon %s names", (file) => {
    const roster = listed(file);
    for (const u of roster.units) {
      const ds = snapshot.data.datasheets.find((d) => d.id === u.datasheetId)!;
      const on = new Set(unitFromRosterUnit(u, roster, snapshot).weapons.filter((w) => w.enabled).map((w) => w.name.toLowerCase()));
      for (const item of u.models.flatMap((g) => g.wargear)) expect(on).toContain(item.toLowerCase());
      expect(ds.weapons.length).toBeGreaterThan(0);
    }
  });

  it("adds nothing to an Ashen Crusher whose whole loadout is written out", () => {
    const roster = listed("gw-app.txt");
    expect(omittedDefaults(sheet("ashen-crusher"), unitOf(roster, "ashen-crusher").models).size).toBe(0);
  });
});

describe("omittedDefaults", () => {
  const squad = sheet("warden-squad");
  const crusher = sheet("ashen-crusher");
  const group = (profile: string, count: number, wargear: string[]) => ({ modelProfileId: `mp:ashen-wardens:warden-squad:${profile}`, count, wargear });

  it("reads which weapon an option line takes away as well as which it grants", () => {
    expect(readWargearOptions(squad).options.map((o) => [o.replaces, o.grants])).toEqual([[["flux carbine"], ["shock maul"]]]);
    expect(readWargearOptions(crusher).options.map((o) => [o.replaces, o.grants])).toEqual([
      [["twin hail gun"], ["fusion beamer"]],
      [["twin hail gun"], ["vortex cannon"]],
    ]);
  });

  it("counts a missing default once per model of the group that left it out", () => {
    expect([...omittedDefaults(squad, [group("warden-sergeant", 1, ["Flux carbine"]), group("warden", 9, ["Flux carbine"])])]).toEqual([
      ["shock maul", 10],
      ["power fist", 1],
    ]);
  });

  it("withholds a default the list traded away for a weapon nothing else grants", () => {
    // The fusion beamer is on the datasheet only as a replacement for the twin hail gun.
    const traded = [{ modelProfileId: "mp:ashen-wardens:ashen-crusher:ashen-crusher", count: 1, wargear: ["Fusion beamer"] }];
    expect([...omittedDefaults(crusher, traded)]).toEqual([["vortex cannon", 1], ["crusher fists", 1]]);
  });

  it("gives a profile only the weapons its own line of the loadout names", () => {
    expect([...omittedDefaults(squad, [group("warden", 9, [])])]).toEqual([["flux carbine", 9], ["shock maul", 9]]);
  });

  it("adds nothing when the group already names every default", () => {
    expect(omittedDefaults(squad, [group("warden-sergeant", 1, ["Flux carbine", "Shock maul", "Power fist"])]).size).toBe(0);
  });
});
