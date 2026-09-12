import { describe, expect, it } from "vitest";
import { circleBase, ovalBase } from "@grimstat/board";
import { SILHOUETTE_FIT, SILHOUETTE_IDS, SILHOUETTE_OVERHANG, figureScale, poseCount, poseOf, silhouetteFor, silhouetteGeometry } from "./silhouettes";
import { UNIT_CLASS_IDS, unitClassFor } from "./unitArt";

/** Every class paired with each of its poses. */
function everyPose(): [ (typeof SILHOUETTE_IDS)[number], number ][] {
  return SILHOUETTE_IDS.flatMap((id) => Array.from({ length: poseCount(id) }, (_, pose) => [id, pose] as [typeof id, number]));
}

/** How far a figure reaches from its axis, and how wide it is across the facing. */
function spread(id: (typeof SILHOUETTE_IDS)[number], pose: number): { reach: number; width: number } {
  const pos = silhouetteGeometry(id, pose).getAttribute("position");
  let reach = 0;
  let width = 0;
  for (let i = 0; i < pos.count; i++) {
    reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
    width = Math.max(width, Math.abs(pos.getZ(i)));
  }
  return { reach, width };
}

describe("a figure for what a unit is", () => {
  it("exists for every class that has a picture, and uses the picture's class rule", () => {
    expect(SILHOUETTE_IDS).toEqual(UNIT_CLASS_IDS);
    for (const keywords of [["INFANTRY"], ["VEHICLE", "TRANSPORT"], ["VEHICLE", "WALKER"], ["MONSTER"], ["FORTIFICATION"], []]) {
      expect(silhouetteFor(keywords)).toBe(unitClassFor(keywords));
    }
  });

  it("stands on the base, within the allowed overhang, and exactly as tall as the kernel measures", () => {
    for (const [id, pose] of everyPose()) {
      const geometry = silhouetteGeometry(id, pose);
      const bounds = geometry.boundingBox!;
      expect(bounds.min.y, `${id}@${pose} feet`).toBeGreaterThanOrEqual(-1e-6);
      expect(bounds.max.y, `${id}@${pose} height`).toBeCloseTo(1, 5);
      const { reach } = spread(id, pose);
      expect(reach, `${id}@${pose} reach`).toBeLessThanOrEqual(SILHOUETTE_OVERHANG + 1e-6);
      expect(reach, `${id}@${pose} fills its base`).toBeGreaterThan(0.5);
    }
  });

  it("is one geometry per class and pose with an armour group and an accent group, built once and shared", () => {
    for (const [id, pose] of everyPose()) {
      const geometry = silhouetteGeometry(id, pose);
      expect(geometry).toBe(silhouetteGeometry(id, pose));
      expect(geometry.index).toBeNull();
      expect(geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
      expect(geometry.getAttribute("position").count).toBeGreaterThan(100);
    }
  });

  it("gives a model a pose by its place in its unit, and wraps round for a unit larger than the set", () => {
    expect(poseCount("infantry")).toBeGreaterThan(1);
    expect(poseCount("vehicle")).toBe(1);
    const n = poseCount("infantry");
    expect(Array.from({ length: n + 2 }, (_, i) => poseOf("infantry", i))).toEqual([...Array.from({ length: n }, (_, i) => i), 0, 1]);
    expect(poseOf("vehicle", 7)).toBe(0);
    expect(silhouetteGeometry("infantry", 0)).not.toBe(silhouetteGeometry("infantry", 1));
    expect(silhouetteGeometry("infantry", n)).toBe(silhouetteGeometry("infantry", 0));
  });

  /**
   * The poses of a class are the same soldier doing different things, so they have to come out the
   * same size. They would not if one of them reached further than the overhang allows: the rule at
   * the end of `silhouettes.ts` scales that whole figure in to fit, which would shrink the body
   * along with the gun that broke the limit and put men of two sizes in one squad.
   */
  it("draws every pose of a class at one size, so a squad is not men of two sizes", () => {
    for (const id of SILHOUETTE_IDS) {
      const first = spread(id, 0);
      for (let pose = 1; pose < poseCount(id); pose++) {
        expect(spread(id, pose).width, `${id}@${pose} width`).toBeCloseTo(first.width, 6);
      }
    }
  });

  it("scales a figure to its model: the base across, the assumed height up, the longer of base and figure along", () => {
    const round = { pos: { x: 0, y: 0, z: 0 }, facing: 0, foot: circleBase(32), height: 2 };
    expect(figureScale("infantry", round)).toEqual([round.foot.r * SILHOUETTE_FIT, 2, round.foot.r * SILHOUETTE_FIT]);
    const oval = { pos: { x: 0, y: 0, z: 0 }, facing: 0, foot: ovalBase(120, 92), height: 3.5 };
    const [sx, sy, sz] = figureScale("vehicle", oval);
    expect(sy).toBe(3.5);
    expect(sx / sz).toBeCloseTo(120 / 92, 2);
    // A tank on a round base keeps its length rather than being squashed square.
    const [rx, , rz] = figureScale("vehicle", { ...round, foot: circleBase(100) });
    expect(rx / rz).toBeCloseTo(120 / 92, 2);
  });
});
