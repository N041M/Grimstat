import { describe, expect, it } from "vitest";
import { Euler, Vector3 } from "three";
import { dir2 } from "@grimstat/board";
import { facingRotation, fromScene, toScene } from "./battleScene";

describe("board and scene coordinates", () => {
  it("round-trips a point", () => {
    const [x, y, z] = toScene({ x: 3, y: 7, z: 2 });
    expect(fromScene(x, y, z)).toEqual({ x: 3, y: 7, z: 2 });
  });
});

describe("facingRotation", () => {
  /**
   * The figures are drawn with their front along their own `+x` (see `silhouettes.ts`), so the
   * rotation is right exactly when it lands that axis on the board direction the model faces. A
   * negated angle passes on a round base and mirrors every tank, which is what this pins down.
   */
  it("turns a figure's own +x onto the board direction it faces", () => {
    for (const facing of [0, Math.PI / 6, Math.PI / 2, 2.4, -1.1, 5.9]) {
      const forward = new Vector3(1, 0, 0).applyEuler(new Euler(...facingRotation(facing)));
      const [x, y, z] = toScene({ ...dir2(facing), z: 0 });
      expect(forward.x).toBeCloseTo(x);
      expect(forward.y).toBeCloseTo(y);
      expect(forward.z).toBeCloseTo(z);
    }
  });
});
