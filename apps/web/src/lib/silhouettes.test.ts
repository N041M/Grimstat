import { describe, expect, it } from "vitest";
import { circleBase, ovalBase } from "@grimstat/board";
import { SILHOUETTE_FIT, SILHOUETTE_IDS, SILHOUETTE_OVERHANG, figureMetrics, figureScale, poseCount, poseOf, silhouetteFor, silhouetteGeometry } from "./silhouettes";
import { UNIT_CLASS_IDS, unitClassFor } from "./unitArt";

/** Every class paired with each of its poses. */
function everyPose(): [ (typeof SILHOUETTE_IDS)[number], number ][] {
  return SILHOUETTE_IDS.flatMap((id) => Array.from({ length: poseCount(id) }, (_, pose) => [id, pose] as [typeof id, number]));
}

/** How far a figure reaches from its axis. */
function reachOf(id: (typeof SILHOUETTE_IDS)[number], pose: number): number {
  const pos = silhouetteGeometry(id, pose).getAttribute("position");
  let reach = 0;
  for (let i = 0; i < pos.count; i++) reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
  return reach;
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
      const reach = reachOf(id, pose);
      expect(reach, `${id}@${pose} reach`).toBeLessThanOrEqual(SILHOUETTE_OVERHANG + 1e-6);
      expect(reach, `${id}@${pose} fills its base`).toBeGreaterThan(0.5);
    }
  });

  /**
   * The overhang rule scales a figure that reaches too far down to fit. That is a safety net. A
   * figure that relies on it is drawn smaller than designed, and a squeezed pose then stands beside
   * an unsqueezed one in the same squad as a smaller man. Every figure has to fit as designed.
   */
  it("fits its overhang as designed, with no pose squeezed to fit", () => {
    const squeezed = everyPose().map(([id, pose]) => `${id}@${pose} ${figureMetrics(id, pose).squeeze.toFixed(3)}`).filter((s) => !s.endsWith(" 1.000"));
    expect(squeezed).toEqual([]);
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

  /**
   * The tones are what the figure materials multiply their colour by, one per vertex. A figure
   * without them would draw black under a material that expects them, and a tone far from one is
   * a slip: a part painted ten times brighter than its armour, or black.
   */
  it("carries a tone on every vertex, within a sane range, and uses more than one", () => {
    for (const [id, pose] of everyPose()) {
      const geometry = silhouetteGeometry(id, pose);
      const colour = geometry.getAttribute("color");
      expect(colour.itemSize, `${id}@${pose} tone channels`).toBe(3);
      expect(colour.count, `${id}@${pose} tone count`).toBe(geometry.getAttribute("position").count);
      let lowest = Infinity;
      let highest = -Infinity;
      const seen = new Set<number>();
      const values = colour.array as ArrayLike<number>;
      for (let i = 0; i < values.length; i++) {
        const c = values[i]!;
        if (c < lowest) lowest = c;
        if (c > highest) highest = c;
        if (i % 3 === 0) seen.add(c);
      }
      expect(lowest, `${id}@${pose} darkest tone`).toBeGreaterThanOrEqual(0.3);
      expect(highest, `${id}@${pose} brightest tone`).toBeLessThanOrEqual(4);
      expect(seen.size, `${id}@${pose} tones used`).toBeGreaterThan(1);
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

  it("has more than one pose for every class that turns up several models to a unit", () => {
    for (const id of ["infantry", "walker", "beast", "swarm", "bike", "mounted"] as const) expect(poseCount(id), id).toBeGreaterThan(1);
    for (const id of SILHOUETTE_IDS) for (let pose = 1; pose < poseCount(id); pose++) expect(silhouetteGeometry(id, pose), `${id}@${pose}`).not.toBe(silhouetteGeometry(id, 0));
  });

  /**
   * The poses of a class are the same model doing different things, so they are designed to the
   * same height. Each pose is normalised to the assumed height on its own, and a pose designed
   * taller than its fellows would come out with everything else about it shorter.
   */
  it("designs every pose of a class to the same height", () => {
    const uneven = everyPose()
      .filter(([id, pose]) => pose > 0 && Math.abs(figureMetrics(id, pose).height - figureMetrics(id, 0).height) > 0.02 * figureMetrics(id, 0).height)
      .map(([id, pose]) => `${id}@${pose} ${figureMetrics(id, pose).height.toFixed(3)} against ${figureMetrics(id, 0).height.toFixed(3)}`);
    expect(uneven).toEqual([]);
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
