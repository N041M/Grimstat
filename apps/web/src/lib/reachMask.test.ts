import { describe, expect, it } from "vitest";
import { MASK_PPI, reachMask } from "./reachMask";

/** A search's answer for a model at `origin` with `budget` inches on an open table: octile costs on a lattice. */
function openReach(origin: { x: number; y: number }, budget: number, cell: number) {
  const nodes: { at: { x: number; y: number; z: number }; cost: number }[] = [];
  const span = Math.ceil(budget / cell) + 1;
  for (let i = -span; i <= span; i++) {
    for (let j = -span; j <= span; j++) {
      const cost = cell * (Math.max(Math.abs(i), Math.abs(j)) + (Math.SQRT2 - 1) * Math.min(Math.abs(i), Math.abs(j)));
      if (cost <= budget + 1e-9) nodes.push({ at: { x: origin.x + i * cell, y: origin.y + j * cell, z: 0 }, cost });
    }
  }
  return nodes;
}

const size = { width: 20, depth: 20 };
const at = (mask: ReturnType<typeof reachMask>, x: number, y: number) => mask.alpha[Math.floor((size.depth - y) * MASK_PPI) * mask.width + Math.floor(x * MASK_PPI)]!;

/** How far from the origin the mask reaches along a bearing, to a sixteenth of an inch. */
function radiusAlong(mask: ReturnType<typeof reachMask>, origin: { x: number; y: number }, angle: number): number {
  let r = 0;
  for (let d = 0; d < 8; d += 1 / MASK_PPI / 2) {
    if (at(mask, origin.x + d * Math.cos(angle), origin.y + d * Math.sin(angle)) >= 128) r = d;
  }
  return r;
}

describe("the reachable region as a mask", () => {
  const origin = { x: 10, y: 10 };
  const mask = reachMask(openReach(origin, 3, 0.5), size, 0.5, 3);

  it("covers the origin fully and nothing past the movement", () => {
    expect(at(mask, origin.x, origin.y)).toBe(255);
    expect(at(mask, origin.x + 3.6, origin.y)).toBe(0);
    expect(at(mask, origin.x, origin.y - 3.6)).toBe(0);
  });

  it("reaches about the movement in every direction", () => {
    for (let k = 0; k < 72; k++) {
      const r = radiusAlong(mask, origin, (k / 72) * Math.PI * 2);
      expect(r, `bearing ${k * 5}°`).toBeGreaterThan(2.55);
      expect(r, `bearing ${k * 5}°`).toBeLessThan(3.2);
    }
  });

  it("has a smooth edge rather than a staircase", () => {
    const radii = Array.from({ length: 360 }, (_, k) => radiusAlong(mask, origin, (k / 360) * Math.PI * 2));
    let roughest = 0;
    for (let k = 0; k < 360; k++) {
      let sum = 0;
      for (let d = -6; d <= 6; d++) sum += radii[(k + d + 360) % 360]!;
      roughest = Math.max(roughest, Math.abs(radii[k]! - sum / 13));
    }
    expect(roughest).toBeLessThan(0.07);
  });

  it("is the union of what each node has left, not a fixed disc per node", () => {
    // One node with no movement left adds nothing beyond its own point; one with plenty adds a cell.
    const spent = reachMask([{ at: { x: 5, y: 5, z: 0 }, cost: 3 }], size, 0.5, 3);
    expect(at(spent, 5.3, 5)).toBe(0);
    const fresh = reachMask([{ at: { x: 5, y: 5, z: 0 }, cost: 0 }], size, 0.5, 3);
    expect(at(fresh, 5.3, 5)).toBe(255);
    expect(at(fresh, 5.8, 5)).toBe(0);
  });
});
