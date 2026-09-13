/**
 * What a scenario is allowed to hold.
 *
 * A scenario is stored on the player's machine and carried whole in a permalink, so anything that
 * reads one has to cope with what arrives. These tests cover the fields where a wrong value would be
 * taken as real rather than refused.
 */

import { describe, expect, it } from "vitest";
import { ScenarioUnit } from "./scenario";

const unit = (over: Record<string, unknown> = {}) => ({ name: "Warden Squad", ...over });

describe("a unit's points", () => {
  it("can be left out, and is kept when it is a real cost", () => {
    expect(ScenarioUnit.parse(unit()).points).toBeUndefined();
    expect(ScenarioUnit.parse(unit({ points: 0 })).points).toBe(0);
    expect(ScenarioUnit.parse(unit({ points: 90 })).points).toBe(90);
  });

  it("is refused when it is negative", () => {
    // A negative cost reaches the efficiency and points-per-wound figures as a real number and turns
    // them upside down, so it is refused where it arrives rather than carried into the sums.
    expect(() => ScenarioUnit.parse(unit({ points: -1 }))).toThrow();
    expect(() => ScenarioUnit.parse(unit({ points: -90 }))).toThrow();
  });
});
