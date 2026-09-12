import { describe, expect, it } from "vitest";
import { hasUnsavedEdits, isDefaultScenario, newScenario, sameScenario, touch } from "./scenario";

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
