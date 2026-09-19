import { describe, expect, it } from "vitest";
import { PAN_RATE, panStep, tableForward } from "./cameraPan";

const ELEVATION = (36 * Math.PI) / 180;
/** The orbit camera on its opening shot: over the near edge, looking down and away across the table. */
const orbitLook = { x: 0, y: -Math.sin(ELEVATION), z: -Math.cos(ELEVATION) };
const Y_UP = { x: 0, y: 1, z: 0 };
/** The top-down camera looks straight down with the board's far edge as screen up. */
const downLook = { x: 0, y: -1, z: 0 };
const TOP_UP = { x: 0, y: 0, z: -1 };

describe("keyboard panning", () => {
  it("takes forward from the look direction flattened onto the table, or from the camera's up when it looks straight down", () => {
    expect(tableForward(orbitLook, Y_UP)).toEqual({ x: 0, y: 0, z: -1 });
    expect(tableForward(downLook, TOP_UP)).toEqual({ x: 0, y: 0, z: -1 });
    const turned = tableForward({ x: 0.5, y: -0.7, z: -0.5 }, Y_UP);
    expect(turned.x).toBeCloseTo(Math.SQRT1_2);
    expect(turned.z).toBeCloseTo(-Math.SQRT1_2);
  });

  it("sends W away from the player, S back, A left and D right, at a share of the view per second", () => {
    const forward = tableForward(orbitLook, Y_UP);
    const step = (key: string) => panStep(new Set([key]), forward, 40, 0.05)!;
    const by = PAN_RATE * 40 * 0.05;
    expect(step("w")).toEqual({ x: 0, y: 0, z: -by });
    expect(step("s")).toEqual({ x: 0, y: 0, z: by });
    expect(step("d").x).toBeCloseTo(by);
    expect(step("a").x).toBeCloseTo(-by);
    expect(step("d").z).toBeCloseTo(0);
  });

  it("moves diagonally no faster than straight, ignores keys it does not know, and caps a stalled frame", () => {
    const forward = tableForward(orbitLook, Y_UP);
    const diagonal = panStep(new Set(["w", "d"]), forward, 40, 0.05)!;
    expect(Math.hypot(diagonal.x, diagonal.z)).toBeCloseTo(PAN_RATE * 40 * 0.05);
    expect(panStep(new Set(["q"]), forward, 40, 0.05)).toBeUndefined();
    expect(panStep(new Set(), forward, 40, 0.05)).toBeUndefined();
    expect(panStep(new Set(["w"]), forward, 40, 2)!.z).toBeCloseTo(-PAN_RATE * 40 * 0.1);
  });

  it("follows the camera round: after a half turn, W goes the other way", () => {
    const behind = tableForward({ x: 0, y: -Math.sin(ELEVATION), z: Math.cos(ELEVATION) }, Y_UP);
    expect(panStep(new Set(["w"]), behind, 40, 0.05)!.z).toBeGreaterThan(0);
    expect(panStep(new Set(["d"]), behind, 40, 0.05)!.x).toBeLessThan(0);
  });
});
