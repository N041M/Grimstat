import { describe, expect, it } from "vitest";
import { bounds, isSymmetric, layoutIssues } from "@grimstat/board";
import { FORTYKDC, areaCentroid, convertFortykdc, minimumRectangle, place, simplifyPlate, simplifyRing, titleOf } from "./fortykdc";

/**
 * A fabricated dataset in the 40kdc shape: one symmetric layout of two areas on a 60 × 44 board, an
 * area template that composes a wall, a pattern with two zones. Nothing from any published card.
 */
const files = () => ({
  "terrain-layouts.json": JSON.stringify([
    {
      id: "demo-01",
      name: "Demo 01",
      source: "fabricated",
      mission_matchup_id: "take-and-hold-vs-purge-the-foe",
      variant: 2,
      deployment_pattern_id: "demo-pattern",
      pieces: [
        { id: "area-01", piece_type: "area", template: "demo-area", position: { x: 20, y: 12 }, rotation_degrees: 90, is_objective: true, objective: { position: { x: 20, y: 10 } } },
        { id: "area-02", piece_type: "area", template: "demo-area", position: { x: 40, y: 32 }, rotation_degrees: 270 },
        { id: "marker", piece_type: "area", template: "demo-bare", position: { x: 30, y: 22 }, terrain: false, objective_role: "center" },
      ],
    },
    { id: "odd", name: "Odd board", board: { width: 36, height: 36 }, pieces: [{ id: "f", piece_type: "feature", template: "demo-wall", position: { x: 18, y: 18 } }] },
  ]),
  "terrain-templates.json": JSON.stringify([
    { id: "demo-area", name: "Demo Area", kind: "area", footprint: { type: "rectangle", width: 8, height: 5 }, features: [{ id: "wall", template: "demo-wall", position: { x: 0, y: -2 } }] },
    { id: "demo-bare", name: "Bare", kind: "area", footprint: { type: "rectangle", width: 1, height: 1 } },
    { id: "demo-wall", name: "Demo Wall", kind: "feature", footprint: { type: "rectangle", width: 6, height: 0.5 }, default_height_inches: 4, default_blocking: true, terrain_category: "dense" },
    { id: "demo-ruin", name: "Demo Ruin", kind: "feature", footprint: { type: "rectangle", width: 3, height: 3 }, has_roof: true, terrain_category: "dense" },
  ]),
  "deployment-patterns.json": JSON.stringify([
    {
      id: "demo-pattern",
      name: "Demo Pattern",
      zones: [
        { player: "defender", shape: { type: "rectangle", width: 60, height: 12 }, position: { x: 0, y: 0 } },
        { player: "attacker", shape: { type: "rectangle", width: 60, height: 12 }, position: { x: 0, y: 32 } },
      ],
      objectives: [{ x: 30, y: 22 }],
    },
  ]),
  "mission-matchups.json": JSON.stringify([{ id: "take-and-hold-vs-purge-the-foe", disposition: "take-and-hold", opponent_disposition: "purge-the-foe" }]),
});

describe("placing a 40kdc piece", () => {
  it("anchors on the polygon area centroid, not the mean of the vertices", () => {
    // A right triangle: mean of vertices is (1, 1); area centroid is (1, 1) too — so use an L.
    const l = [{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 4 }, { x: 0, y: 4 }];
    const c = areaCentroid(l);
    expect(c.x).toBeCloseTo(1.357, 2);
    expect(c.y).toBeCloseTo(1.357, 2);
  });

  it("rotates clockwise in the y-down frame, then translates", () => {
    const local = [{ x: -4, y: -2.5 }, { x: 4, y: -2.5 }, { x: 4, y: 2.5 }, { x: -4, y: 2.5 }];
    const placed = place(local, undefined, 90, { x: 10, y: 10 });
    const box = bounds(placed);
    expect(box.maxX - box.minX).toBeCloseTo(5, 6);
    expect(box.maxY - box.minY).toBeCloseTo(8, 6);
    // Clockwise on screen (y down): the local +x axis turns to point down (+y).
    const tip = place([{ x: 1, y: 0 }], undefined, 90, { x: 0, y: 0 })[0]!;
    expect(tip.x).toBeCloseTo(0, 6);
    expect(tip.y).toBeCloseTo(1, 6);
  });

  it("mirrors before it rotates", () => {
    const tip = place([{ x: 1, y: 0.5 }], "horizontal", 90, { x: 0, y: 0 })[0]!;
    expect(tip.x).toBeCloseTo(-0.5, 6);
    expect(tip.y).toBeCloseTo(-1, 6);
  });

  it("drops the nubs of a die-cut outline and keeps the corners", () => {
    const nubbed = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2.05, y: -0.05 }, { x: 2.1, y: 0 }, { x: 8, y: 0 }, { x: 8, y: 5 }, { x: 4, y: 5.04 }, { x: 0, y: 5 }];
    const ring = simplifyRing(nubbed, 0.2);
    expect(ring).toHaveLength(4);
    expect(simplifyRing([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], 0.2)).toHaveLength(3);
  });

  it("squares a rounded, nubbed plate back into its rectangle, whichever way round it was traced", () => {
    // A 8 × 5 plate with rounded corners and a nub, traced twice: once as is, once rotated 180°.
    const arc = (cx: number, cy: number, r: number, from: number, to: number) => Array.from({ length: 6 }, (_, i) => ({ x: cx + r * Math.cos(from + ((to - from) * i) / 5), y: cy + r * Math.sin(from + ((to - from) * i) / 5) }));
    const plate = [...arc(7.5, 0.5, 0.5, -Math.PI / 2, 0), ...arc(7.5, 4.5, 0.5, 0, Math.PI / 2), ...arc(0.5, 4.5, 0.5, Math.PI / 2, Math.PI), { x: 0, y: 2.6 }, { x: 0.05, y: 2.55 }, { x: 0, y: 2.5 }, ...arc(0.5, 0.5, 0.5, Math.PI, 1.5 * Math.PI)];
    const squared = simplifyPlate(plate, 0.2);
    expect(squared).toHaveLength(4);
    const box = bounds(squared);
    expect([box.minX, box.minY, box.maxX, box.maxY].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 8, 5]);
    const twin = bounds(simplifyPlate([...plate].reverse().map((p) => ({ x: 8 - p.x, y: 5 - p.y })), 0.2));
    expect([twin.minX, twin.minY, twin.maxX, twin.maxY].map((v) => Math.round(v * 1e6) / 1e6)).toEqual([0, 0, 8, 5]);
  });

  it("keeps a trapezoid a trapezoid", () => {
    const trapezoid = [{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 2, y: 11.5 }, { x: 0, y: 11.5 }];
    expect(simplifyPlate([...trapezoid, { x: 0, y: 5 }], 0.2)).toHaveLength(4);
    expect(minimumRectangle(trapezoid).length).toBe(4);
  });

  it("names a matchup the way the card does", () => {
    expect(titleOf("take-and-hold")).toBe("Take and Hold");
    expect(titleOf("priority-assets")).toBe("Priority Assets");
  });
});

describe("converting a 40kdc dataset", () => {
  const { layouts, warnings } = convertFortykdc(files(), { importedFrom: "https://example.invalid/data/", ref: "abc123" });
  const demo = layouts.find((l) => l.id === `${FORTYKDC.idPrefix}demo-01`)!;

  it("converts every layout, named for its matchup, with provenance and a note that says what was assumed", () => {
    expect(warnings).toEqual([]);
    expect(layouts.map((l) => l.id)).toEqual(["40kdc-demo-01", "40kdc-odd"]);
    expect(demo.name).toBe("Take and Hold vs Purge the Foe · 2");
    expect(demo.note).toContain("Deployment: Demo Pattern.");
    expect(demo.note).toContain("assumed");
    expect(demo.provenance).toEqual({ source: FORTYKDC.attribution, licence: "CC BY 4.0", importedFrom: "https://example.invalid/data/ @ abc123" });
  });

  it("flips the y-down frame onto the table, so the data's top edge is the far edge", () => {
    // area-01 sits at y-down (20, 12): on the table that is 12 up from the far edge, 32 from the near one.
    const area = demo.pieces.find((p) => p.id === "area-01")!;
    const box = bounds(area.polygon);
    expect((box.minY + box.maxY) / 2).toBeCloseTo(32, 6);
    // Rotated 90°, the 8 × 5 area stands 5 wide and 8 deep.
    expect(box.maxX - box.minX).toBeCloseTo(5, 6);
    expect(box.maxY - box.minY).toBeCloseTo(8, 6);
    expect(area.height).toBe(0);
    expect(area.traits).toEqual(["light-cover"]);
  });

  it("composes a template's scenery with the area's own placement", () => {
    // The wall sits 2 above the area's centroid in area-local y-down; rotated 90° with the area, that
    // is 2 to the left of its centre on the board — and it turns with it, so it stands 0.5 wide, 6 deep.
    const wall = demo.pieces.find((p) => p.id === "area-01/wall")!;
    const box = bounds(wall.polygon);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(22, 6);
    expect(box.maxX - box.minX).toBeCloseTo(0.5, 6);
    expect(box.maxY - box.minY).toBeCloseTo(6, 6);
    expect(wall.height).toBe(4);
    expect(wall.traits).toEqual(["obscuring", "heavy-cover", "impassable"]);
    expect(wall.floors).toEqual([]);
  });

  it("keeps a symmetric card symmetric, which is the check that catches a wrong rotation", () => {
    expect(isSymmetric(demo)).toBe(true);
    expect(layoutIssues(demo)).toEqual([]);
  });

  it("takes objectives from the pieces that carry them, an empty area included, and zones from the pattern", () => {
    expect(demo.objectives.map((o) => o.at)).toEqual([
      { x: 20, y: 34 },
      { x: 30, y: 22 },
    ]);
    expect(demo.pieces.find((p) => p.id === "marker")).toBeUndefined();
    expect(demo.zones?.map((z) => z.owner)).toEqual(["defender", "attacker"]);
    // The defender's zone is along the data's top edge, which is the table's far edge.
    expect(bounds(demo.zones![0]!.polygon).minY).toBeCloseTo(32, 6);
  });

  it("honours a per-layout board and reads a lone feature", () => {
    const odd = layouts.find((l) => l.id === "40kdc-odd")!;
    expect(odd.size).toEqual({ width: 36, depth: 36 });
    expect(odd.pieces).toHaveLength(1);
    expect(odd.name).toBe("Odd board");
  });

  it("says what it skipped rather than failing the whole fetch", () => {
    const broken = files();
    const doc = JSON.parse(broken["terrain-layouts.json"]) as unknown[];
    doc.push({ id: "bad", name: "Bad", pieces: [{ id: "x", template: "nope", position: { x: 1, y: 1 } }] });
    const result = convertFortykdc({ ...broken, "terrain-layouts.json": JSON.stringify(doc) });
    expect(result.layouts.map((l) => l.id)).toContain("40kdc-bad");
    expect(result.warnings).toEqual([expect.stringMatching(/unknown template "nope"/)]);
  });
});
