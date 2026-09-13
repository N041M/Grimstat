import { describe, expect, it } from "vitest";
import type { Snapshot } from "@grimstat/schema";
import { archetypeUnit, defaultContext, defaultModel, defaultWeapon, emptyUnit, hasUnsavedEdits, isDefaultScenario, newScenario, phaseForUnit, sameScenario, touch } from "./scenario";

/** Only the field `newScenario` reads off the loaded data. */
const loaded = (gameSystemId: string) => ({ gameSystemId }) as Snapshot;

describe("scenario comparison", () => {
  it("treats a scenario as the same as itself and as its normalised copy", () => {
    const s = newScenario();
    expect(sameScenario(s, s)).toBe(true);
    expect(sameScenario({ ...s }, s)).toBe(true);
    expect(sameScenario(undefined, s)).toBe(false);
  });

  it("sees a renamed or re-stamped scenario as different", () => {
    const s = newScenario();
    expect(sameScenario(s, { ...s, name: "Other" })).toBe(false);
    expect(sameScenario(s, touch(s))).toBe(false);
  });
});

describe("unsaved edits", () => {
  it("is false for an untouched new scenario and true once it is edited", () => {
    const s = newScenario();
    expect(isDefaultScenario(s)).toBe(true);
    expect(hasUnsavedEdits(s, undefined)).toBe(false);
    const renamed = { ...s, name: "Bolters into marines" };
    expect(isDefaultScenario(renamed)).toBe(false);
    expect(hasUnsavedEdits(renamed, undefined)).toBe(true);
    const flagged = { ...s, context: { ...s.context, inCover: !s.context.inCover } };
    expect(hasUnsavedEdits(flagged, undefined)).toBe(true);
  });

  it("compares against the stored copy when there is one", () => {
    const stored = { ...newScenario(), name: "Saved" };
    expect(hasUnsavedEdits(stored, stored)).toBe(false);
    expect(hasUnsavedEdits({ ...stored, enabledToggles: ["x"] }, stored)).toBe(true);
  });
});

describe("the phase a loadout can act in", () => {
  const withWeapons = (kinds: Array<"ranged" | "melee">) => ({ ...emptyUnit("A"), models: [defaultModel()], weapons: kinds.map((k) => defaultWeapon(k)) });

  it("moves to the fight phase for a melee-only unit and back for a ranged-only one", () => {
    expect(phaseForUnit(defaultContext(), withWeapons(["melee"])).phase).toBe("fight");
    expect(phaseForUnit({ ...defaultContext(), phase: "fight" }, withWeapons(["ranged"])).phase).toBe("shooting");
  });

  it("leaves the phase alone when the unit can act in it", () => {
    const both = withWeapons(["ranged", "melee"]);
    const shooting = defaultContext();
    expect(phaseForUnit(shooting, both)).toBe(shooting);
    const fight = { ...defaultContext(), phase: "fight" as const };
    expect(phaseForUnit(fight, both)).toBe(fight);
    // Nothing enabled at all is a different problem, and moving the phase would not fix it.
    expect(phaseForUnit(shooting, emptyUnit("A"))).toBe(shooting);
  });

  it("keeps the charged flag as the player set it", () => {
    const melee = archetypeUnit("chainsword-mob")!;
    expect(phaseForUnit(defaultContext(), melee)).toEqual({ ...defaultContext(), phase: "fight" });
    expect(phaseForUnit(defaultContext(), melee).charged).toBe(false);
  });
});

describe("the edition a new scenario is scored under", () => {
  /*
   * An army imported from a roster is stamped with the game system of the data it was read against.
   * A scenario stamped from somewhere else disagrees with it, and the two are then read under
   * different rules.
   */
  it("comes from the loaded data", () => {
    expect(newScenario({}, { snapshot: loaded("wh40k-10e") }).gameSystemId).toBe("wh40k-10e");
    expect(newScenario({}, { snapshot: loaded("wh40k-11e") }).gameSystemId).toBe("wh40k-11e");
  });

  it("falls back to 11th edition when no data is loaded", () => {
    expect(newScenario().gameSystemId).toBe("wh40k-11e");
    expect(newScenario({}, {}).gameSystemId).toBe("wh40k-11e");
  });

  it("is still what a caller asked for outright", () => {
    expect(newScenario({ gameSystemId: "wh40k-10e" }).gameSystemId).toBe("wh40k-10e");
  });
});
