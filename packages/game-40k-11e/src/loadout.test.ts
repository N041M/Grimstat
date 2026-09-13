import { describe, expect, it } from "vitest";
import type { Datasheet, ScenarioUnit } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { checkLoadout, readWargearOptions, UNLIMITED } from "./loadout";
import { unitFromDatasheet } from "./resolve";

const snapshot = loadSyntheticSnapshot();
const squad = snapshot.data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-squad")!;

/**
 * A datasheet in the synthetic vocabulary, so no test here carries a word of published game text.
 * Only the fields the loadout reader looks at are filled in.
 */
function sheet(partial: { options?: string[]; loadout?: string; weapons?: string[]; composition?: Array<{ description: string; min?: number; max?: number }> }): Datasheet {
  const names = partial.weapons ?? ["Flux carbine", "Shock maul", "Ember lance"];
  return {
    id: "ds:test",
    gameSystemId: "wh40k-11e",
    factionId: "faction:ashen-wardens",
    name: "Test Squad",
    isLegends: false,
    isCharacter: false,
    isEpicHero: false,
    isBattleline: false,
    isSupport: false,
    keywords: ["INFANTRY"],
    factionKeywords: [],
    models: [{ id: "mp:test", name: "Warden", M: 6, T: 4, Sv: 3, W: 2, Ld: 6, OC: 2 }],
    weapons: names.map((name, i) => ({ id: `w${i}`, name, kind: "ranged" as const, range: 24, A: "1", skill: 3, S: 4, AP: 0, D: "1", keywords: [] })),
    abilityIds: [],
    stratagemIds: [],
    leaderTo: [],
    supportTo: [],
    composition: partial.composition ?? [{ description: "5 Wardens", min: 5, max: 10 }],
    ...(partial.loadout !== undefined ? { loadout: partial.loadout } : { loadout: "Every model is equipped with: flux carbine." }),
    wargearOptions: partial.options ?? [],
  };
}

/** The datasheet's unit with one weapon forced on at `count`. */
function withWeapon(ds: Datasheet, models: number, weapon: string, count: number): ScenarioUnit {
  const base = unitFromDatasheet(ds, snapshot, { modelCount: models });
  return { ...base, weapons: base.weapons.map((w) => (w.name === weapon ? { ...w, enabled: true, count } : w)) };
}

describe("reading wargear option prose", () => {
  it("reads the synthetic squad's option and keeps the line it came from", () => {
    const r = readWargearOptions(squad);
    expect(r.complete).toBe(true);
    expect(r.fixed).toBe(false);
    expect(r.options).toHaveLength(1);
    expect(r.options[0]!.grants).toEqual(["shock maul"]);
    expect(r.options[0]!.limit(10)).toBe(UNLIMITED);
    expect(r.options[0]!.text).toBe(squad.wargearOptions[0]);
  });

  it('treats "None" as a datasheet with no options rather than a line it failed to read', () => {
    const r = readWargearOptions(sheet({ options: ["None"] }));
    expect(r.fixed).toBe(true);
    expect(r.unread).toEqual([]);
    expect(r.options).toEqual([]);
  });

  it("counts a fixed allowance, and scales one written per so many models", () => {
    const upTo = readWargearOptions(sheet({ options: ["Up to 2 Wardens can each have their flux carbine replaced with 1 ember lance."] }));
    expect(upTo.options[0]!.grants).toEqual(["ember lance"]);
    expect(upTo.options[0]!.limit(10)).toBe(2);

    const perFive = readWargearOptions(sheet({ options: ["For every 5 models in the unit, up to 2 Wardens can each have their flux carbine replaced with 1 ember lance."] }));
    expect(perFive.options[0]!.limit(5)).toBe(2);
    expect(perFive.options[0]!.limit(10)).toBe(4);
    expect(perFive.options[0]!.limit(4)).toBe(0);
  });

  it("reads a bulleted choice as one allowance over each weapon it offers, and counts the copies each grants", () => {
    const r = readWargearOptions(sheet({ options: ["Up to 2 Wardens can each have their flux carbine replaced with one of the following:\n\n- 1 shock maul\n- 2 ember lances"] }));
    expect(r.options.map((o) => o.grants[0])).toEqual(["shock maul", "ember lance"]);
    expect(r.options.find((o) => o.grants[0] === "shock maul")!.limit(10)).toBe(2);
    // Two each, to two models.
    expect(r.options.find((o) => o.grants[0] === "ember lance")!.limit(10)).toBe(4);
  });

  it("files a line it cannot read rather than assuming it permits nothing", () => {
    const r = readWargearOptions(sheet({ options: ["If this unit contains 10 models, whichever Warden the sergeant nominates may carry 1 ember lance."] }));
    expect(r.options).toEqual([]);
    expect(r.unread).toHaveLength(1);
    expect(r.complete).toBe(false);
  });

  /**
   * A weapon whose name opens with the letters of an article or a number word. Stripping those
   * letters left "shen blade", which matches nothing the datasheet carries, so the line read as one
   * granting the shock maul alone and the blade was reported as a weapon nothing grants.
   */
  it("keeps the first letter of a weapon whose name opens with an article or a number word", () => {
    for (const name of ["Ashen blade", "Anvil hammer", "Thermal cutter", "Sixth lance"]) {
      const ds = sheet({ weapons: ["Flux carbine", "Shock maul", name], options: [`Any number of models can each have their flux carbine replaced with 1 shock maul or ${name}.`] });
      const r = readWargearOptions(ds);
      expect(r.complete).toBe(true);
      expect(r.options.map((o) => o.grants[0])).toContain(name.toLowerCase());
      expect(checkLoadout(ds, withWeapon(ds, 10, name, 3)).problems).toEqual([]);
    }
    // A count written in front of such a name is still read as a count.
    const counted = readWargearOptions(sheet({ weapons: ["Flux carbine", "Ashen blade"], options: ["Up to 2 Wardens can each have their flux carbine replaced with 2 Ashen blades."] }));
    expect(counted.options[0]!.grants).toEqual(["ashen blade"]);
    expect(counted.options[0]!.limit(10)).toBe(4);
  });

  it("ignores a weapon the datasheet does not carry", () => {
    const r = readWargearOptions(sheet({ options: ["Up to 2 Wardens can each have their flux carbine replaced with 1 void hammer."] }));
    expect(r.options).toEqual([]);
    expect(r.unread).toHaveLength(1);
  });
});

describe("checking a unit against its datasheet", () => {
  it("passes the loadout the app itself builds", () => {
    const unit = unitFromDatasheet(squad, snapshot, { modelCount: 10 });
    expect(checkLoadout(squad, unit).problems).toEqual([]);
  });

  it("reports a model count outside the composition", () => {
    const ds = sheet({ composition: [{ description: "5 Wardens", min: 5, max: 10 }] });
    const few = checkLoadout(ds, unitFromDatasheet(ds, snapshot, { modelCount: 3 }));
    expect(few.problems.map((p) => p.code)).toEqual(["models.min"]);
    const many = checkLoadout(ds, unitFromDatasheet(ds, snapshot, { modelCount: 14 }));
    expect(many.problems.map((p) => p.code)).toEqual(["models.max"]);
  });

  it("reports more of an optional weapon than the options allow, and quotes the line", () => {
    const line = "Up to 2 Wardens can each have their flux carbine replaced with 1 ember lance.";
    const ds = sheet({ options: [line] });
    const check = checkLoadout(ds, withWeapon(ds, 10, "Ember lance", 5));
    expect(check.problems).toHaveLength(1);
    expect(check.problems[0]!.code).toBe("weapon.overLimit");
    expect(check.problems[0]!.weapon).toBe("Ember lance");
    expect(check.problems[0]!.rule).toBe(line);
    expect(check.problems[0]!.message).toContain("allow 2");
  });

  it("accepts a count inside the allowance", () => {
    const ds = sheet({ options: ["Up to 2 Wardens can each have their flux carbine replaced with 1 ember lance."] });
    expect(checkLoadout(ds, withWeapon(ds, 10, "Ember lance", 2)).problems).toEqual([]);
  });

  it("never questions a weapon the default loadout gives every model", () => {
    const ds = sheet({ loadout: "Every model is equipped with: flux carbine; shock maul.", options: ["None"] });
    expect(checkLoadout(ds, withWeapon(ds, 10, "Shock maul", 10)).problems).toEqual([]);
  });

  it("reports a weapon nothing grants when the datasheet prints no options", () => {
    const ds = sheet({ loadout: "Every model is equipped with: flux carbine.", options: ["None"] });
    const check = checkLoadout(ds, withWeapon(ds, 10, "Ember lance", 1));
    expect(check.problems.map((p) => p.code)).toEqual(["weapon.unsourced"]);
  });

  /**
   * The whole point of withholding this one. A line the parser could not read might be the very
   * line that grants the weapon, so accusing the player would be a coin toss.
   */
  it("withholds that report when any option line went unread", () => {
    const ds = sheet({
      loadout: "Every model is equipped with: flux carbine.",
      options: ["Whichever Warden the sergeant nominates may carry 1 shock maul."],
    });
    const check = checkLoadout(ds, withWeapon(ds, 10, "Ember lance", 1));
    expect(check.complete).toBe(false);
    expect(check.unread).toHaveLength(1);
    expect(check.problems).toEqual([]);
  });

  it("reports a weapon that is not on the datasheet at all", () => {
    const ds = sheet({ options: ["None"] });
    const unit = unitFromDatasheet(ds, snapshot, { modelCount: 10 });
    const check = checkLoadout(ds, { ...unit, weapons: [...unit.weapons, { name: "Void hammer", count: 1, kind: "melee", range: null, A: "3", skill: 3, S: 8, AP: 2, D: "2", keywords: [], enabled: true }] });
    expect(check.problems.map((p) => p.code)).toContain("weapon.unknown");
  });

  it("keeps quiet about a problem the app's own default loadout already has", () => {
    const ds = sheet({ loadout: "Every model carries whatever it likes.", options: ["None"] });
    const base = unitFromDatasheet(ds, snapshot, { modelCount: 10 });
    // The loadout prose names nothing matchable, so the unit arrives already unexplainable.
    expect(checkLoadout(ds, base).problems.length).toBeGreaterThan(0);
    expect(checkLoadout(ds, base, { baseline: base }).problems).toEqual([]);
  });

  it("still reports a count the player pushed past the default", () => {
    const ds = sheet({ loadout: "Every model carries whatever it likes.", options: ["None"] });
    const base = unitFromDatasheet(ds, snapshot, { modelCount: 10 });
    const worse = { ...base, weapons: base.weapons.map((w) => ({ ...w, enabled: true, count: 99 })) };
    expect(checkLoadout(ds, worse, { baseline: base }).problems.length).toBeGreaterThan(0);
  });
});
