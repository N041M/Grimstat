import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  COHERENCY_RANGE,
  circleBase,
  coherency,
  coreSegment,
  distance,
  distanceToPoint,
  heightForKeywords,
  horizontalGap,
  inEngagementRange,
  inches,
  ovalBase,
  pointInPolygon,
  segInPolygonSpans,
  segSegDistance,
  silhouettePoints,
  unitDistance,
  verticalGap,
  type ModelHull,
} from "./index";

/** A round-based model: 32 mm base, 2" tall, at `(x, y, z)`. */
const trooper = (x: number, y: number, z = 0, height = 2): ModelHull => ({ pos: { x, y, z }, facing: 0, foot: circleBase(32), height });
/** A model with an exact base radius, so the arithmetic in a test stays legible. */
const disc = (x: number, y: number, z: number, r: number, height: number): ModelHull => ({ pos: { x, y, z }, facing: 0, foot: { kind: "circle", r }, height });

describe("segment distance", () => {
  it("measures parallel, crossing and skew segments", () => {
    expect(segSegDistance({ a: { x: 0, y: 0 }, b: { x: 10, y: 0 } }, { a: { x: 0, y: 3 }, b: { x: 10, y: 3 } })).toBeCloseTo(3);
    expect(segSegDistance({ a: { x: 0, y: -1 }, b: { x: 0, y: 1 } }, { a: { x: -1, y: 0 }, b: { x: 1, y: 0 } })).toBeCloseTo(0);
    expect(segSegDistance({ a: { x: 0, y: 0 }, b: { x: 1, y: 0 } }, { a: { x: 4, y: 0 }, b: { x: 4, y: 5 } })).toBeCloseTo(3);
  });

  it("is symmetric and never negative", () => {
    const coord = fc.double({ min: -50, max: 50, noNaN: true });
    const seg = fc.record({ a: fc.record({ x: coord, y: coord }), b: fc.record({ x: coord, y: coord }) });
    fc.assert(
      fc.property(seg, seg, (s, t) => {
        const d = segSegDistance(s, t);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(segSegDistance(t, s)).toBeCloseTo(d, 9);
      }),
      { numRuns: 300 },
    );
  });
});

describe("polygon queries", () => {
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
  ];
  /** A "C": the notch is the part a convex test would get wrong. */
  const cShape = [
    { x: 0, y: 0 },
    { x: 6, y: 0 },
    { x: 6, y: 2 },
    { x: 2, y: 2 },
    { x: 2, y: 4 },
    { x: 6, y: 4 },
    { x: 6, y: 6 },
    { x: 0, y: 6 },
  ];

  it("puts points inside, outside and on the edge", () => {
    expect(pointInPolygon({ x: 2, y: 2 }, square)).toBe(true);
    expect(pointInPolygon({ x: 5, y: 2 }, square)).toBe(false);
    expect(pointInPolygon({ x: 0, y: 2 }, square)).toBe(true); // touching the edge counts as within
    expect(pointInPolygon({ x: 4, y: 3 }, cShape)).toBe(false); // in the notch
    expect(pointInPolygon({ x: 4, y: 1 }, cShape)).toBe(true);
  });

  it("finds the spans of a segment inside a convex ring", () => {
    const spans = segInPolygonSpans({ a: { x: -2, y: 2 }, b: { x: 8, y: 2 } }, square);
    expect(spans).toHaveLength(1);
    expect(spans[0]![0]).toBeCloseTo(0.2);
    expect(spans[0]![1]).toBeCloseTo(0.6);
  });

  it("stops at the notch of a concave ring", () => {
    // y = 3 runs along the C's spine, which ends at x = 2 where the notch begins.
    const spans = segInPolygonSpans({ a: { x: -1, y: 3 }, b: { x: 9, y: 3 } }, cShape);
    expect(spans).toHaveLength(1);
    expect(spans[0]![0]).toBeCloseTo(0.1);
    expect(spans[0]![1]).toBeCloseTo(0.3);
  });

  it("reports no span for a segment that misses entirely", () => {
    expect(segInPolygonSpans({ a: { x: -5, y: 9 }, b: { x: 5, y: 9 } }, square)).toEqual([]);
  });

  it("reports the whole segment when it lies inside", () => {
    expect(segInPolygonSpans({ a: { x: 1, y: 1 }, b: { x: 3, y: 3 } }, square)).toEqual([[0, 1]]);
  });
});

describe("bases", () => {
  it("converts millimetres to inches", () => {
    expect(inches(25.4)).toBeCloseTo(1);
    expect(circleBase(32).r).toBeCloseTo(32 / 25.4 / 2);
  });

  it("models an oval as a capsule of the right length and width", () => {
    const oval = ovalBase(60, 35);
    expect(oval.kind).toBe("capsule");
    if (oval.kind !== "capsule") return;
    expect(2 * oval.r).toBeCloseTo(inches(35)); // width across
    expect(2 * (oval.half + oval.r)).toBeCloseTo(inches(60)); // length along
  });

  it("turns a capsule's facing into a core segment", () => {
    const hull: ModelHull = { pos: { x: 0, y: 0, z: 0 }, facing: Math.PI / 2, foot: ovalBase(90, 52), height: 3.5 };
    const core = coreSegment(hull);
    expect(core.a.x).toBeCloseTo(0);
    expect(core.b.x).toBeCloseTo(0);
    expect(core.b.y).toBeGreaterThan(core.a.y); // rotated to lie along +y
  });

  it("takes the tallest default among a model's keywords", () => {
    expect(heightForKeywords(["INFANTRY"])).toBe(2);
    expect(heightForKeywords(["INFANTRY", "CHARACTER"])).toBe(2.5);
    expect(heightForKeywords(["VEHICLE", "TITANIC"])).toBe(7);
    expect(heightForKeywords(["FLUFF"])).toBe(2); // unknown keywords fall back rather than vanish
  });

  it("puts the silhouette's tangents to either side of the line of sight", () => {
    const hull = disc(10, 0, 0, 1, 2);
    const pts = silhouettePoints(hull, { x: 0, y: 0 });
    expect(pts.some((p) => p.y > 0.99)).toBe(true);
    expect(pts.some((p) => p.y < -0.99)).toBe(true);
    expect(pts.some((p) => p.x < 9.01)).toBe(true); // the near point faces the viewer
  });
});

describe("measurement", () => {
  it("measures edge to edge, not centre to centre", () => {
    expect(horizontalGap(disc(0, 0, 0, 1, 2), disc(6, 0, 0, 1, 2))).toBeCloseTo(4);
    expect(horizontalGap(disc(0, 0, 0, 1, 2), disc(1.5, 0, 0, 1, 2))).toBe(0); // overlapping bases
  });

  it("combines the horizontal and vertical gaps as a taut tape would", () => {
    // 4" across, 3" up: five inches away.
    const low = disc(0, 0, 0, 1, 2);
    const high = disc(6, 0, 5, 1, 2);
    expect(verticalGap(low, high)).toBeCloseTo(3);
    expect(distance(low, high)).toBeCloseTo(5);
  });

  it("treats overlapping height spans as no vertical distance", () => {
    expect(verticalGap(disc(0, 0, 0, 1, 4), disc(6, 0, 3, 1, 2))).toBe(0);
    expect(distance(disc(0, 0, 0, 1, 4), disc(6, 0, 3, 1, 2))).toBeCloseTo(4);
  });

  it("measures to a point in space", () => {
    expect(distanceToPoint(disc(0, 0, 0, 1, 2), { x: 5, y: 0, z: 0 })).toBeCloseTo(4);
    expect(distanceToPoint(disc(0, 0, 0, 1, 2), { x: 0, y: 0, z: 5 })).toBeCloseTo(3);
  });

  it("is symmetric, non-negative and zero for a model against itself", () => {
    const coord = fc.double({ min: -30, max: 30, noNaN: true });
    const hull = fc
      .record({ x: coord, y: coord, z: fc.double({ min: 0, max: 20, noNaN: true }), r: fc.double({ min: 0.25, max: 3, noNaN: true }), h: fc.double({ min: 0.5, max: 8, noNaN: true }) })
      .map(({ x, y, z, r, h }) => disc(x, y, z, r, h));
    fc.assert(
      fc.property(hull, hull, (a, b) => {
        const d = distance(a, b);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(distance(b, a)).toBeCloseTo(d, 9);
        expect(distance(a, a)).toBe(0);
      }),
      { numRuns: 300 },
    );
  });

  it("takes a unit's distance from its closest model", () => {
    const squad = [trooper(0, 0), trooper(2, 0), trooper(4, 0)];
    const other = [trooper(20, 0)];
    expect(unitDistance(squad, other)).toBeCloseTo(distance(trooper(4, 0), trooper(20, 0)));
    expect(unitDistance([], other)).toBe(Infinity);
  });
});

describe("engagement range", () => {
  it("is one inch horizontally", () => {
    expect(inEngagementRange(disc(0, 0, 0, 1, 2), disc(3, 0, 0, 1, 2))).toBe(true); // exactly 1"
    expect(inEngagementRange(disc(0, 0, 0, 1, 2), disc(3.2, 0, 0, 1, 2))).toBe(false);
  });

  it("is five inches vertically, which the plain distance would not capture", () => {
    const ground = disc(0, 0, 0, 1, 2);
    const gantry = disc(0.5, 0, 6.5, 1, 2); // 4.5" of clear air above the trooper's head
    expect(verticalGap(ground, gantry)).toBeCloseTo(4.5);
    expect(inEngagementRange(ground, gantry)).toBe(true);
    expect(inEngagementRange(ground, disc(0.5, 0, 8, 1, 2))).toBe(false); // 6" up: out of reach
  });
});

describe("coherency", () => {
  it("passes a small squad in a chain", () => {
    const squad = [trooper(0, 0), trooper(1.5, 0), trooper(3, 0)];
    expect(coherency(squad).ok).toBe(true);
  });

  it("names the model that has drifted off", () => {
    const squad = [trooper(0, 0), trooper(1.5, 0), trooper(20, 0)];
    const report = coherency(squad);
    expect(report.ok).toBe(false);
    expect(report.lonely).toEqual([2]);
    expect(report.split).toBe(true);
  });

  it("asks for two neighbours once the unit is six strong", () => {
    // A chain of six at 2.5" centres: adjacent bases are 1.24" apart, the next one along 3.74",
    // so the two end models have exactly one neighbour each.
    const chain = [0, 2.5, 5, 7.5, 10, 12.5].map((x) => trooper(x, 0));
    const report = coherency(chain);
    expect(report.required).toBe(2);
    expect(report.lonely).toEqual([0, 5]);
    // Closed into a ring, everyone has two.
    const ring = [0, 60, 120, 180, 240, 300].map((deg) => trooper(2 * Math.cos((deg * Math.PI) / 180), 2 * Math.sin((deg * Math.PI) / 180)));
    expect(coherency(ring).ok).toBe(true);
  });

  it("catches a unit that is in two legal huddles", () => {
    const left = [trooper(0, 0), trooper(1.5, 0), trooper(0, 1.5)];
    const right = [trooper(30, 0), trooper(31.5, 0), trooper(30, 1.5)];
    const report = coherency([...left, ...right]);
    expect(report.lonely).toEqual([]); // every model has a neighbour…
    expect(report.split).toBe(true); // …but the unit is in two places
    expect(report.ok).toBe(false);
  });

  it("measures coherency in three dimensions", () => {
    const onFloor = trooper(0, 0, 0);
    const upstairs = trooper(0, 0, 5); // directly above, 3" of air between them
    expect(distance(onFloor, upstairs)).toBeGreaterThan(COHERENCY_RANGE);
    expect(coherency([onFloor, upstairs]).ok).toBe(false);
    expect(coherency([onFloor, trooper(0, 0, 3.5)]).ok).toBe(true);
  });
});
