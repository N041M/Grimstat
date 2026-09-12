import { describe, expect, it } from "vitest";
import { Euler, Vector3 } from "three";
import { CLIMBERS, CROSSFIRE, REDOUBT, RUINED_CITY, TerrainIndex, circleBase, containsPoint, dir2, reachable, type ModelHull, type TerrainPiece } from "@grimstat/board";
import { facingRotation, fromScene, surfaceHeights, toScene } from "./battleScene";

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

describe("surfaceHeights", () => {
  /** Heights drawn on a piece that none of its `floors` accounts for. */
  const roofPlates = (pieces: readonly TerrainPiece[]): number =>
    pieces.filter((p) => surfaceHeights(p).some((z) => !p.floors.some((f) => Math.abs(p.base + f - z) < 0.1))).length;

  it("draws a scalable piece's roof, and the movement search reaches the same heights", () => {
    const ruin = RUINED_CITY.pieces.find((p) => p.id === "a1")!;
    expect(ruin.height).toBe(9);
    expect(ruin.floors).toEqual([0, 4]);
    expect(surfaceHeights(ruin)).toEqual([0, 4, 9]);

    const trooper: ModelHull = { pos: { x: 4, y: 33, z: 0 }, facing: 0, foot: circleBase(32), height: 2 };
    const reach = reachable(trooper, 30, new TerrainIndex([ruin]), { keywords: [...CLIMBERS] });
    const reached = new Set(reach.nodes.filter((n) => containsPoint(ruin, n.at)).map((n) => n.at.z));
    expect([...reached].sort((a, b) => a - b)).toEqual(surfaceHeights(ruin));
  });

  it("draws nothing on top of a piece with no way up it", () => {
    const crater = REDOUBT.pieces.find((p) => p.id === "k1")!;
    expect(surfaceHeights(crater)).toEqual([0]); // the lid of a 0.4" crater was drawn as a storey
    const bunker = REDOUBT.pieces.find((p) => p.id === "bunker1")!;
    expect(surfaceHeights(bunker)).toEqual([5]); // its roof is already its only listed floor
  });

  it("keeps every roof plate on a shipped layout to a piece that can be climbed", () => {
    expect(roofPlates(RUINED_CITY.pieces)).toBe(9); // nine ruins, and every one of those roofs is reachable
    expect(roofPlates(CROSSFIRE.pieces)).toBe(5);
    expect(roofPlates(REDOUBT.pieces)).toBe(0); // four crater lids and two bunker tops, none of them a surface
  });
});
