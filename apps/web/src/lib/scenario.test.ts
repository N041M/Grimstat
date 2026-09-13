import { describe, expect, it } from "vitest";
import type { Snapshot } from "@grimstat/schema";
import { hasUnsavedEdits, isDefaultScenario, newScenario, sameScenario, touch } from "./scenario";

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
