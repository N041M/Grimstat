import { describe, expect, it } from "vitest";
import type { AttachedCharacter } from "@grimstat/schema";
import { attachedOf, attachmentLine, hasAttached, unitLabel } from "./attachment";

const leader: AttachedCharacter = { name: "Warden Captain", role: "leader" };
const support: AttachedCharacter = { name: "Warden Banner", role: "support" };
const unit = (attached: AttachedCharacter[]) => ({ name: "Warden Squad", attached });

describe("naming what is attached", () => {
  it("says who leads and who supports, keeping the two jobs apart", () => {
    expect(attachmentLine(unit([leader]))).toBe("Led by Warden Captain");
    expect(attachmentLine(unit([support]))).toBe("Supported by Warden Banner");
    expect(attachmentLine(unit([leader, support]))).toBe("Led by Warden Captain · Supported by Warden Banner");
  });

  it("has nothing to say about a unit standing on its own", () => {
    expect(attachmentLine(unit([]))).toBeUndefined();
    expect(hasAttached(unit([]))).toBe(false);
    expect(hasAttached(unit([leader]))).toBe(true);
  });

  it("puts the unit and whoever is with it on one line where that is all there is", () => {
    expect(unitLabel(unit([]))).toBe("Warden Squad");
    expect(unitLabel(unit([leader]))).toBe("Warden Squad + Warden Captain");
    expect(unitLabel(unit([leader, support]))).toBe("Warden Squad + Warden Captain + Warden Banner");
  });

  /**
   * Scenarios saved before the field existed come back without it. Nothing should throw over a unit
   * that simply predates the feature.
   */
  it("treats a unit stored before the field existed as having nothing attached", () => {
    const old = { name: "Warden Squad" } as { name: string; attached?: AttachedCharacter[] };
    expect(hasAttached(old)).toBe(false);
    expect(attachedOf(old)).toEqual([]);
    expect(attachmentLine(old)).toBeUndefined();
    expect(unitLabel(old)).toBe("Warden Squad");
  });
});
