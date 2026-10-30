import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { TerrainIndex, boxesOverlap, terrain, type Aabb2, type TerrainPiece } from "./index";

/** `count` small squares scattered over a 60 × 44 table, a few of them overlapping. */
function scatter(count: number): TerrainPiece[] {
  const out: TerrainPiece[] = [];
  for (let i = 0; i < count; i++) {
    const x = (i * 7.31) % 58;
    const y = (i * 3.77) % 42;
    const s = 0.2 + ((i * 1.3) % 1.6);
    out.push(terrain({ id: `p${i}`, polygon: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }], height: 1 + (i % 5) }));
  }
  return out;
}

/** What a scan of every piece answers, in list order. */
const scan = (pieces: readonly TerrainPiece[], index: TerrainIndex, region: Aabb2): string[] => pieces.filter((_, i) => boxesOverlap(region, index.box(i))).map((p) => p.id);

describe("the terrain index", () => {
  it("answers every region with the pieces a scan finds, in the order they are listed", () => {
    const pieces = scatter(300);
    const index = new TerrainIndex(pieces);
    fc.assert(
      fc.property(fc.double({ min: -10, max: 70, noNaN: true }), fc.double({ min: -10, max: 55, noNaN: true }), fc.double({ min: 0, max: 30, noNaN: true }), fc.double({ min: 0, max: 30, noNaN: true }), (x, y, w, h) => {
        const region = { minX: x, minY: y, maxX: x + w, maxY: y + h };
        expect(index.candidates(region).map((p) => p.id)).toEqual(scan(pieces, index, region));
      }),
      { numRuns: 400 },
    );
    // A point, and a region turned inside out, which the overlap test still decides.
    for (const region of [{ minX: 12, minY: 9, maxX: 12, maxY: 9 }, { minX: 40, minY: 30, maxX: 20, maxY: 10 }]) {
      expect(index.candidates(region).map((p) => p.id)).toEqual(scan(pieces, index, region));
    }
  });

  it("finds nothing on an empty table", () => {
    expect(new TerrainIndex([]).candidates({ minX: 0, minY: 0, maxX: 60, maxY: 44 })).toEqual([]);
  });

  it("reads only the pieces filed near a query, however many the table holds", () => {
    const pieces = scatter(2800);
    let reads = 0;
    const counted = new Proxy(pieces, {
      get(target, key, receiver) {
        if (typeof key === "string" && /^\d+$/.test(key)) reads++;
        return Reflect.get(target, key, receiver) as unknown;
      },
    });
    const index = new TerrainIndex(counted);
    reads = 0;
    index.at({ x: 30.05, y: 22.05 });
    index.near({ x: 12.3, y: 30.7 }, 1);
    expect(reads).toBeLessThan(40);
  });
});
