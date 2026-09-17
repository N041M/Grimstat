import { describe, expect, it } from "vitest";
import type { Datasheet, ScenarioUnit } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { checkLoadout, readWargearOptions, wargearItems, UNLIMITED } from "./loadout";
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

/** The datasheet's unit holding exactly these weapons, in these numbers. */
function holding(ds: Datasheet, models: number, counts: Record<string, number>): ScenarioUnit {
  const base = unitFromDatasheet(ds, snapshot, { modelCount: models });
  return { ...base, weapons: base.weapons.map((w) => ({ ...w, count: counts[w.name] ?? 0, enabled: (counts[w.name] ?? 0) > 0 })) };
}

/** A one-model sheet with two guns to swap and a fist that stays. */
function walker(options: string[]): Datasheet {
  return sheet({
    weapons: ["Flux carbine", "Shock maul", "Ember lance", "Plasma gun"],
    loadout: "This model is equipped with: flux carbine; shock maul; power fist.",
    composition: [{ description: "1 Warden", min: 1, max: 1 }],
    options,
  });
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

describe("the wargear a datasheet offers that is not a weapon", () => {
  it("names what an option line grants and the datasheet has no weapon for", () => {
    expect(wargearItems(sheet({ options: ["Any number of Wardens can each be equipped with 1 ember banner."] }))).toEqual(["Ember banner"]);
  });

  it("names both halves of an option that grants two things", () => {
    expect(wargearItems(sheet({ options: ["1 Warden can be equipped with 1 ember banner and 1 warden's horn."] }))).toEqual(["Ember banner", "Warden's horn"]);
  });

  it("offers nothing for a line that only moves weapons about", () => {
    expect(wargearItems(squad)).toEqual([]);
  });

  it("leaves a weapon alone, whichever way the line writes it", () => {
    const ds = sheet({ options: ["Any number of Wardens can each have their flux carbine replaced with 1 shock maul."] });
    expect(wargearItems(ds)).toEqual([]);
  });

  it("reads nothing out of a line whose allowance it does not understand", () => {
    // A footnote qualifies the lines above it. Read as a grant, its prose would arrive as item names.
    expect(wargearItems(sheet({ options: ["* You cannot select the same option twice, and no model can have an ember banner and a warden's horn."] }))).toEqual([]);
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

  /**
   * A walker with a gun on each mount and a line for each mount is offered two of the same weapon,
   * one line at a time. Reading only the larger of the two lines called the second one illegal, and
   * the loadout the datasheet plainly offers could not be built.
   */
  it("adds up the lines that grant the same weapon", () => {
    const options = ["This model's flux carbine can be replaced with 1 ember lance.", "This model's shock maul can be replaced with 1 ember lance."];
    const ds = sheet({ options, loadout: "This model is equipped with: flux carbine; shock maul.", composition: [{ description: "1 Warden", min: 1, max: 1 }] });
    // Both guns swapped: the lances are all the model is holding.
    expect(checkLoadout(ds, holding(ds, 1, { "Ember lance": 2 })).problems).toEqual([]);
    const over = checkLoadout(ds, holding(ds, 1, { "Ember lance": 3 }));
    expect(over.problems.map((p) => p.code)).toEqual(["weapon.overLimit"]);
    expect(over.problems[0]!.message).toContain("allow 2");
    // No one line set that limit, so none is quoted as the rule it broke.
    expect(over.problems[0]!.rule).toBeUndefined();
  });

  it("reads an allowance written after the subject", () => {
    const ds = sheet({ options: ["This model can be equipped with up to 2 ember lances."], composition: [{ description: "1 Warden", min: 1, max: 1 }] });
    expect(checkLoadout(ds, withWeapon(ds, 1, "Ember lance", 2)).problems).toEqual([]);
    expect(checkLoadout(ds, withWeapon(ds, 1, "Ember lance", 3)).problems.map((p) => p.code)).toEqual(["weapon.overLimit"]);
  });

  it("withholds the over-limit report when an unread line names that weapon", () => {
    const ds = sheet({
      options: [
        "Up to 1 Warden can have their flux carbine replaced with 1 ember lance.",
        "Up to 1 Warden can have their flux carbine replaced with 1 shock maul.",
        "* A Warden nominated by the sergeant may carry a second ember lance.",
      ],
    });
    const lances = checkLoadout(ds, withWeapon(ds, 10, "Ember lance", 2));
    expect(lances.unread).toHaveLength(1);
    expect(lances.problems).toEqual([]);
    // The same unread line says nothing about the shock maul, so that count is still checked.
    expect(checkLoadout(ds, withWeapon(ds, 10, "Shock maul", 4)).problems.map((p) => p.code)).toEqual(["weapon.overLimit"]);
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

/**
 * A swap is a trade, and the mounts run out before the allowances do. Each weapon on a model can sit
 * inside its own option's limit and the loadout still be one the datasheet never offers.
 */
describe("weapons the model has not paid for", () => {
  const twoMounts = ["This model's flux carbine can be replaced with 1 ember lance.", "This model's shock maul can be replaced with 1 ember lance."];

  it("passes a model that gave up a printed weapon for each one it took", () => {
    const ds = walker(twoMounts);
    expect(checkLoadout(ds, holding(ds, 1, { "Ember lance": 2 })).problems).toEqual([]);
    expect(checkLoadout(ds, holding(ds, 1, { "Ember lance": 1, "Shock maul": 1 })).problems).toEqual([]);
  });

  it("reports a model that took both and kept one of the weapons they replace", () => {
    const ds = walker(twoMounts);
    const check = checkLoadout(ds, holding(ds, 1, { "Ember lance": 2, "Flux carbine": 1 }));
    expect(check.problems.map((p) => p.code)).toEqual(["weapon.noSlot"]);
    expect(check.problems[0]!.message).toContain("still carries Flux carbine");
  });

  it("counts a line that hands over two weapons for one as one mount", () => {
    const ds = walker(["This model's flux carbine can be replaced with 1 ember lance and 1 plasma gun."]);
    expect(checkLoadout(ds, holding(ds, 1, { "Ember lance": 1, "Plasma gun": 1, "Shock maul": 1 })).problems).toEqual([]);
    expect(checkLoadout(ds, holding(ds, 1, { "Ember lance": 1, "Plasma gun": 1, "Flux carbine": 1, "Shock maul": 1 })).problems.map((p) => p.code)).toEqual(["weapon.noSlot"]);
  });

  it("asks nothing of a weapon a line only adds", () => {
    const ds = walker(["This model can be equipped with 1 ember lance."]);
    expect(checkLoadout(ds, holding(ds, 1, { "Ember lance": 1, "Flux carbine": 1, "Shock maul": 1 })).problems).toEqual([]);
  });

  it("leaves a unit of several models alone, whose mounts are not the unit's to count", () => {
    const ds = sheet({ options: ["Any number of models can each have their flux carbine replaced with 1 ember lance."], loadout: "Every model is equipped with: flux carbine; shock maul." });
    expect(checkLoadout(ds, holding(ds, 10, { "Ember lance": 10, "Flux carbine": 10, "Shock maul": 10 })).problems).toEqual([]);
  });

  it("withholds the verdict while a line went unread", () => {
    const ds = walker([...twoMounts, "* A Warden nominated by the sergeant keeps whatever they were holding."]);
    expect(checkLoadout(ds, holding(ds, 1, { "Ember lance": 2, "Flux carbine": 1 })).problems).toEqual([]);
  });
});

