import { describe, expect, it } from "vitest";
import type { Roster, Scenario, ScenarioUnit } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { unitFromRosterUnit, unitFromDatasheet, parseLoadout, pointsFor, listToggles, runScenario } from "./index";

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
    // The unit keeps its own name; who is attached is a field, so a screen can lay the two out.
    expect(u.name).toBe("Warden Squad");
    expect(u.attached).toEqual([{ name: "Warden Captain", role: "leader", datasheetId: "ds:ashen-wardens:warden-captain" }]);
    expect(u.models.map((m) => `${m.name}x${m.count}`)).toEqual(["Warden Sergeantx1", "Wardenx9", "Warden Captainx1"]);
    const on = u.weapons.filter((w) => w.enabled).map((w) => `${w.name}x${w.count}`);
    // Ten shock mauls for nine that are listed: the sergeant's group names a power fist and a flux
    // carbine but not the maul the datasheet gives every model, and no option takes that maul away.
    expect(on).toEqual(expect.arrayContaining(["Flux carbinex10", "Shock maulx10", "Power fistx1", "Warden Captain: Flux pistolx1", "Warden Captain: Relic bladex1"]));
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

describe("which model is which", () => {
  /**
   * The roster says who is in the unit — one sergeant, nine troopers — and the resolver used to take
   * only the total and spread it over the profiles in the order the datasheet prints them. On a
   * sheet that prints the rank and file first, a squad came out as one trooper and nine sergeants,
   * carrying the sergeant's wounds and save on nine models that do not have them.
   */
  it("follows the roster's model groups", () => {
    const u = unitFromRosterUnit(roster.units[0]!, roster, snapshot);
    expect(u.models.map((m) => `${m.count}x ${m.name}`)).toEqual(["1x Warden Sergeant", "9x Warden", "1x Warden Captain"]);
  });

  it("reads the same unit the other way round when the roster says so", () => {
    const swapped: Roster = {
      ...roster,
      units: roster.units.map((u) => (u.id === "u1" ? { ...u, models: [{ ...u.models[0]!, count: 4 }, { ...u.models[1]!, count: 6 }] } : u)),
    };
    const u = unitFromRosterUnit(swapped.units[0]!, swapped, snapshot);
    expect(u.models.map((m) => `${m.count}x ${m.name}`)).toEqual(["4x Warden Sergeant", "6x Warden", "1x Warden Captain"]);
  });

  it("falls back to the datasheet's own spread when the groups name no profile it has", () => {
    const strange: Roster = {
      ...roster,
      units: roster.units.map((u) => (u.id === "u1" ? { ...u, models: [{ modelProfileId: "mp:nothing", count: 10, wargear: [] }] } : u)),
    };
    const u = unitFromRosterUnit(strange.units[0]!, strange, snapshot);
    expect(u.models.map((m) => `${m.count}x ${m.name}`)).toEqual(["1x Warden Sergeant", "9x Warden", "1x Warden Captain"]);
  });
});

describe("attached characters", () => {
  it("takes the role from the roster rather than guessing it from the sheet", () => {
    const supported: Roster = { ...roster, units: roster.units.map((u) => (u.id === "u2" ? { ...u, attachedTo: { unitId: "u1", role: "support" as const } } : u)) };
    expect(unitFromRosterUnit(supported.units[0]!, supported, snapshot).attached[0]!.role).toBe("support");
  });

  it("is empty for a unit nobody is attached to", () => {
    expect(unitFromRosterUnit(roster.units[2]!, roster, snapshot).attached).toEqual([]);
  });

  it("names the attached character when the calculator attaches one by datasheet", () => {
    const squad = snapshot.data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-squad")!;
    const u = unitFromDatasheet(squad, snapshot, { modelCount: 10, attachedDatasheetIds: ["ds:ashen-wardens:warden-captain"] });
    expect(u.name).toBe("Warden Squad");
    expect(u.attached).toEqual([{ name: "Warden Captain", role: "leader", datasheetId: "ds:ashen-wardens:warden-captain" }]);
  });
});

/** The synthetic squad with the loadout prose under test, and weapons to read it against. */
function withLoadout(loadout: string, names: string[]) {
  const base = snapshot.data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-squad")!;
  const profile = base.weapons[0]!;
  return { ...base, loadout, wargearOptions: [], weapons: names.map((name, i) => ({ ...profile, id: `w${i}`, name, kind: i === names.length - 1 ? ("melee" as const) : ("ranged" as const) })) };
}

describe("how many of a weapon a model carries", () => {
  /**
   * The prose writes a vehicle's several guns as one line: "3 dark lances". Read as one weapon per
   * model, every unit built that way fired a fraction of the shots it has.
   */
  it("is the number the loadout prose puts in front of it", () => {
    const ds = withLoadout("Every model is equipped with: 2 flux carbines; shock maul.", ["Flux carbine", "Shock maul"]);
    expect(parseLoadout(ds).copies).toEqual({ "flux carbine": 2 });
    const by = Object.fromEntries(unitFromDatasheet(ds, snapshot, { modelCount: 5 }).weapons.map((w) => [w.name, w]));
    expect(by["Flux carbine"]!.count).toBe(10);
    expect(by["Shock maul"]!.count).toBe(5);
  });

  it("is one where the prose names the weapon on its own", () => {
    const ds = withLoadout("Every model is equipped with: flux carbine; shock maul.", ["Flux carbine", "Shock maul"]);
    expect(parseLoadout(ds).copies).toEqual({});
  });
});

describe("a weapon the prose does not name", () => {
  /**
   * The shooting half of a weapon is sometimes printed under a name of its own, and the loadout
   * sentence names only the other half. A model left with nothing of one kind takes the first weapon
   * of that kind the option lines do not mention, since a weapon an option names is one it would
   * have to swap for.
   */
  it("is taken up when no option line mentions it", () => {
    const ds = { ...withLoadout("This model is equipped with: shock maul.", ["Flux carbine", "Shock maul"]), wargearOptions: [] };
    const on = unitFromDatasheet(ds, snapshot, { modelCount: 1 }).weapons.filter((w) => w.enabled).map((w) => w.name);
    expect(on).toEqual(["Flux carbine", "Shock maul"]);
  });

  it("is left alone when an option line grants it", () => {
    const ds = { ...withLoadout("This model is equipped with: shock maul.", ["Flux carbine", "Shock maul"]), wargearOptions: ["This model's shock maul can be replaced with 1 flux carbine."] };
    const on = unitFromDatasheet(ds, snapshot, { modelCount: 1 }).weapons.filter((w) => w.enabled).map((w) => w.name);
    expect(on).toEqual(["Shock maul"]);
  });

  it("keeps both halves of a weapon that shoots and fights under one name", () => {
    const base = snapshot.data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-squad")!;
    const profile = base.weapons[0]!;
    const ds = {
      ...base,
      loadout: "Every model is equipped with: flux carbine.",
      wargearOptions: [],
      weapons: [
        { ...profile, id: "w0", name: "Flux carbine", kind: "ranged" as const },
        { ...profile, id: "w1", name: "Flux carbine", kind: "melee" as const },
      ],
    };
    const on = unitFromDatasheet(ds, snapshot, { modelCount: 5 }).weapons.filter((w) => w.enabled);
    expect(on.map((w) => `${w.name}/${w.kind}`)).toEqual(["Flux carbine/ranged", "Flux carbine/melee"]);
  });
});

describe("a weapon the prose gives to a kind of model", () => {
  /**
   * A datasheet can carry one profile for models the prose talks about separately: a Servitor
   * Battleclade's second profile is "Combat Servitors and Gun Servitors", and its loadout hands a
   * heavy arc rifle to one Gun Servitor. Read as a sentence about every model, a nine-model unit
   * fielded nine of them.
   */
  it("is carried by as many models as the sentence says", () => {
    const ds = withLoadout("Every model is equipped with: flux carbine.\n\n1 Ember Gunner is equipped with: plasma gun.", ["Flux carbine", "Plasma gun", "Shock maul"]);
    expect(parseLoadout(ds).carriers).toEqual({ "plasma gun": 1 });
    const by = Object.fromEntries(unitFromDatasheet(ds, snapshot, { modelCount: 5 }).weapons.map((w) => [w.name, w]));
    expect(by["Flux carbine"]!.count).toBe(5);
    expect(by["Plasma gun"]!.count).toBe(1);
    expect(by["Plasma gun"]!.enabled).toBe(true);
  });

  it("is carried by as many as the unit composition gives that kind", () => {
    const base = withLoadout("Every model is equipped with: flux carbine.\n\nEvery Ember Gunner is equipped with: plasma gun.", ["Flux carbine", "Plasma gun", "Shock maul"]);
    const ds = { ...base, composition: [{ description: "5 Wardens", min: 5, max: 10 }, { description: "2 Ember Gunners" }] };
    expect(parseLoadout(ds).carriers).toEqual({ "plasma gun": 2 });
    expect(Object.fromEntries(unitFromDatasheet(ds, snapshot, { modelCount: 5 }).weapons.map((w) => [w.name, w]))["Plasma gun"]!.count).toBe(2);
  });

  it("goes to every model when neither the sentence nor the composition counts them", () => {
    const ds = withLoadout("Every model is equipped with: flux carbine.\n\nEvery Ember Gunner is equipped with: plasma gun.", ["Flux carbine", "Plasma gun", "Shock maul"]);
    expect(parseLoadout(ds).carriers).toEqual({});
    expect(parseLoadout(ds).all).toEqual(["flux carbine", "plasma gun"]);
  });
});

describe("which weapon a loadout item names", () => {
  it("takes the name as written over the longer names that contain it", () => {
    const ds = withLoadout("Every model is equipped with: flux carbine; shock maul.", ["Flux carbine", "Heavy flux carbine", "Twin flux carbine", "Shock maul"]);
    expect(parseLoadout(ds).all).toEqual(["flux carbine", "shock maul"]);
  });

  it("takes the one longer name that contains it, and none when several do", () => {
    const one = withLoadout("Every model is equipped with: carbine; shock maul.", ["Heavy flux carbine", "Shock maul"]);
    expect(parseLoadout(one).all).toEqual(["heavy flux carbine", "shock maul"]);
    const several = withLoadout("Every model is equipped with: carbine; shock maul.", ["Heavy flux carbine", "Twin flux carbine", "Shock maul"]);
    expect(parseLoadout(several).all).toEqual(["shock maul"]);
  });

  it("still reads an item that spells a weapon out with words to spare", () => {
    const ds = withLoadout("Every model is equipped with: 2 flux carbines; shock maul.", ["Flux carbine", "Shock maul"]);
    expect(parseLoadout(ds).all).toEqual(["flux carbine", "shock maul"]);
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

describe("an attached character's weapons", () => {
  it("survive the host's wargear selection when the character's own group lists none", () => {
    const bare: Roster = { ...roster, units: roster.units.map((u) => (u.id === "u2" ? { ...u, models: u.models.map((m) => ({ ...m, wargear: [] })) } : u)) };
    const u = unitFromRosterUnit(bare.units[0]!, bare, snapshot);
    const captain = u.weapons.filter((w) => w.name.startsWith("Warden Captain: "));
    expect(captain.map((w) => `${w.name}x${w.count}`)).toEqual(["Warden Captain: Flux pistolx1", "Warden Captain: Relic bladex1"]);
    expect(captain.some((w) => w.enabled)).toBe(true);
    // The host's own selection is still applied.
    const by = Object.fromEntries(u.weapons.map((w) => [w.name, w]));
    expect(by["Flux carbine"]!.count).toBe(10);
  });
});

describe("pointsFor", () => {
  it("takes the largest tier the unit is big enough for, whatever order the tiers were listed in", () => {
    const squad = snapshot.data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-squad")!;
    const rule = snapshot.data.priceRules.find((r) => r.datasheetId === squad.id)!;
    const descending = { ...snapshot, data: { ...snapshot.data, priceRules: [{ ...rule, tiers: [...rule.tiers].reverse() }] } };
    expect(pointsFor(squad, descending, 5)).toBe(90);
    expect(pointsFor(squad, descending, 10)).toBe(180);
    expect(pointsFor(squad, snapshot, 5)).toBe(90);
    expect(pointsFor(squad, snapshot, 10)).toBe(180);
    // Below every tier, the smallest stands in.
    expect(pointsFor(squad, descending, 1)).toBe(90);
  });
});

describe("an attached character's ability toggle", () => {
  const squadWithCaptain = () => unitFromRosterUnit(roster.units[0]!, roster, snapshot);
  const target: ScenarioUnit = { name: "target", keywords: ["INFANTRY"], models: [{ name: "m", count: 10, T: 4, Sv: 3, W: 1, isCharacter: false, keywords: [] }], weapons: [], attached: [], effects: [] };
  const now2 = new Date().toISOString();
  const scenarioOf = (attacker: ScenarioUnit, enabledToggles: string[]): Scenario => ({
    id: "s", ownerId: "local", createdAt: now2, updatedAt: now2, revision: 0, name: "t",
    gameSystemId: "wh40k-11e", attacker, defender: target,
    context: { rangeBand: "full", charged: false, stationary: false, inCover: false, snapShooting: false, phase: "shooting", flags: [], allocationPolicy: "protect-character", lethalChoice: "auto", weaponOrder: "listed", mcIterations: 5000, backend: "exact" },
    enabledToggles, extraEffects: [],
  });

  it("is listed, and switching it off changes the result", () => {
    const attacker = squadWithCaptain();
    const toggles = listToggles(scenarioOf(attacker, []), snapshot);
    const rally = toggles.find((t) => t.id === "ability:attacker:ab:ashen-wardens:warden-captain:rally-the-line");
    expect(rally).toBeDefined();

    const on = runScenario(scenarioOf(attacker, []), { snapshot });
    const off = runScenario(scenarioOf(attacker, [`-${rally!.id}`]), { snapshot });
    // Rally the Line re-rolls hit rolls of 1 on ranged attacks, so removing it must lower the damage.
    expect(off.expectedDamage).toBeLessThan(on.expectedDamage);
  });
});
