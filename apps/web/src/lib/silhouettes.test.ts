import { describe, expect, it } from "vitest";
import { circleBase, ovalBase } from "@grimstat/board";
import { SILHOUETTE_FIT, SILHOUETTE_IDS, SILHOUETTE_OVERHANG, figureScale, silhouetteFor, silhouetteGeometry } from "./silhouettes";
import { UNIT_ART_IDS, unitArtFor } from "./unitArt";

describe("a figure for what a unit is", () => {
  it("exists for every class that has a picture, and uses the picture's rule", () => {
    expect(SILHOUETTE_IDS).toEqual(UNIT_ART_IDS);
    for (const keywords of [["INFANTRY"], ["VEHICLE", "TRANSPORT"], ["VEHICLE", "WALKER"], ["MONSTER"], ["FORTIFICATION"], []]) {
      expect(silhouetteFor(keywords)).toBe(unitArtFor(keywords));
    }
  });

  it("stands on the base, within the allowed overhang, and exactly as tall as the kernel measures", () => {
    for (const id of SILHOUETTE_IDS) {
      const geometry = silhouetteGeometry(id);
      const bounds = geometry.boundingBox!;
      expect(bounds.min.y, `${id} feet`).toBeGreaterThanOrEqual(-1e-6);
      expect(bounds.max.y, `${id} height`).toBeCloseTo(1, 5);
      const pos = geometry.getAttribute("position");
      let reach = 0;
      for (let i = 0; i < pos.count; i++) reach = Math.max(reach, Math.hypot(pos.getX(i), pos.getZ(i)));
      expect(reach, `${id} reach`).toBeLessThanOrEqual(SILHOUETTE_OVERHANG + 1e-6);
      expect(reach, `${id} fills its base`).toBeGreaterThan(0.5);
    }
  });

  it("is one geometry per class with an armour group and an accent group, built once and shared", () => {
    for (const id of SILHOUETTE_IDS) {
      const geometry = silhouetteGeometry(id);
      expect(geometry).toBe(silhouetteGeometry(id));
      expect(geometry.index).toBeNull();
      expect(geometry.groups.map((g) => g.materialIndex)).toEqual([0, 1]);
      expect(geometry.getAttribute("position").count).toBeGreaterThan(100);
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
