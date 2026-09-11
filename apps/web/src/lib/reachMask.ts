/**
 * The reachable region as a soft-edged mask, from the search's lattice of nodes.
 *
 * The search answers in half-inch cells, and a field of little squares reads as a staircase. What
 * the player wants to see is the region itself: every point within the model's remaining movement
 * of *some* reachable node. So each node is painted as a disc whose radius is the movement it has
 * left — capped at a cell, so a disc never reaches far past a wall its node stopped at — and the
 * union of those discs is the region: an interior fully covered by the discs of nodes with a cell
 * or more to spare, and a frontier drawn by the discs that run out exactly where the movement does.
 * The scallops between neighbouring discs are then blurred away and the result thresholded back to
 * a crisp edge, so what remains is the region's true outline to within a fraction of a cell.
 *
 * Pure arithmetic on arrays, so it can be tested without a browser; the canvas texture is the
 * caller's business.
 */

import type { BoardSize, ReachNode } from "@grimstat/board";

export interface ReachMask {
  readonly width: number;
  readonly height: number;
  /** Coverage 0–255 per pixel, row-major, the first row along the table's far edge (`y = depth`). */
  readonly alpha: Uint8ClampedArray;
}

/** Pixels to the inch: enough for a cell to span several pixels, so the blur has room to work. */
export const MASK_PPI = 16;

/** A node's disc is never wider than this many cells, whatever movement it has left. */
const CAP_CELLS = 1;
/** The blur's half-width, in cells: a little over a scallop's depth. */
const BLUR_CELLS = 0.35;
/** Width of the soft edge left after thresholding, in pixels — one anti-aliased step. */
const EDGE_PX = 1.5;

export function reachMask(nodes: readonly Pick<ReachNode, "at" | "cost">[], size: BoardSize, cell: number, budget: number, ppi = MASK_PPI): ReachMask {
  const width = Math.max(1, Math.ceil(size.width * ppi));
  const height = Math.max(1, Math.ceil(size.depth * ppi));
  const field = new Float32Array(width * height);

  for (const n of nodes) {
    const r = Math.min(budget - n.cost, cell * CAP_CELLS);
    if (r <= 0) continue;
    const cx = n.at.x * ppi;
    const cy = (size.depth - n.at.y) * ppi;
    const rp = r * ppi;
    const x0 = Math.max(0, Math.floor(cx - rp));
    const x1 = Math.min(width - 1, Math.ceil(cx + rp));
    const y0 = Math.max(0, Math.floor(cy - rp));
    const y1 = Math.min(height - 1, Math.ceil(cy + rp));
    const r2 = rp * rp;
    for (let y = y0; y <= y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x <= x1; x++) {
        const dx = x + 0.5 - cx;
        if (dx * dx + dy * dy <= r2) field[y * width + x] = 1;
      }
    }
  }

  const radius = Math.max(1, Math.round(BLUR_CELLS * cell * ppi));
  const scratch = new Float32Array(width * height);
  blur(field, scratch, width, height, radius);
  blur(field, scratch, width, height, radius);

  // Two box blurs make a triangular edge profile 4·radius wide; the threshold puts the edge back
  // where the discs' union had it, and the gain leaves EDGE_PX of softness for anti-aliasing.
  const gain = (4 * radius) / EDGE_PX;
  const alpha = new Uint8ClampedArray(width * height);
  for (let i = 0; i < field.length; i++) alpha[i] = Math.round(Math.min(1, Math.max(0, (field[i]! - 0.5) * gain + 0.5)) * 255);
  return { width, height, alpha };
}

/** One separable box blur of `field` in place, edges replicated; `scratch` is the same size. */
function blur(field: Float32Array, scratch: Float32Array, width: number, height: number, radius: number): void {
  const span = 2 * radius + 1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += field[row + clamp(k, width)]!;
    for (let x = 0; x < width; x++) {
      scratch[row + x] = sum / span;
      sum += field[row + clamp(x + radius + 1, width)]! - field[row + clamp(x - radius, width)]!;
    }
  }
  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += scratch[clamp(k, height) * width + x]!;
    for (let y = 0; y < height; y++) {
      field[y * width + x] = sum / span;
      sum += scratch[clamp(y + radius + 1, height) * width + x]! - scratch[clamp(y - radius, height) * width + x]!;
    }
  }
}

const clamp = (i: number, n: number): number => (i < 0 ? 0 : i >= n ? n - 1 : i);
