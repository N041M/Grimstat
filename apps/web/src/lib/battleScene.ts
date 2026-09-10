/**
 * The one place board coordinates become scene coordinates.
 *
 * `@grimstat/board` measures in inches on the `xy` table plane with `z` up, because that is how a
 * player thinks about a table. three.js wants `y` up. Rather than let the two conventions leak into
 * every component, they meet here: `toScene` and nothing else.
 */

import type { TerrainPiece, Vec2, Vec3 } from "@grimstat/board";
import { hasTrait, topOf } from "@grimstat/board";

/** A three.js position tuple. */
export type Scene3 = [number, number, number];

/** Board `(x, y, z)` → scene `(x, z, −y)`. The negation keeps the table right-handed. */
export const toScene = (p: Vec3): Scene3 => [p.x, p.z, -p.y];

/** A point on the table at a given height. */
export const toSceneFlat = (p: Vec2, z = 0): Scene3 => [p.x, z, -p.y];

/** Scene `(x, y, z)` → board `(x, y, z)`, for turning a pointer hit back into a board position. */
export const fromScene = (x: number, y: number, z: number): Vec3 => ({ x, y: -z, z: y });

/**
 * Colours, as scene material inputs rather than CSS.
 *
 * The table is deliberately drab: terrain and models have to read at a glance from above, and they
 * only do that against a ground that stays out of the way.
 */
export const SCENE_COLOURS = {
  table: "#23262d",
  tableEdge: "#3d434f",
  grid: "#2c313a",
  terrain: "#4a5260",
  terrainRoof: "#5b6474",
  terrainImpassable: "#5c4444",
  terrainLow: "#4a4433",
  floorEdge: "#79839a",
  objective: "#d8b45c",
  zoneAttacker: "#3d6fb5",
  zoneDefender: "#b8452f",
  reachable: "#4d8fe0",
  reachableUpper: "#e0a458",
  rayClear: "#4ec9a0",
  rayBlocked: "#c9464b",
  path: "#4ec9a0",
  selected: "#f2f4f7",
} as const;

/** Faction colours for the two sides, kept distinct in both themes. */
export const SIDE_COLOURS = { attacker: "#3d6fb5", defender: "#b8452f" } as const;

/**
 * How a terrain piece should look. Height and traits carry the meaning, so the renderer never has to
 * be told separately what a piece is.
 */
export function terrainAppearance(piece: TerrainPiece): { colour: string; opacity: number } {
  if (hasTrait(piece, "impassable")) return { colour: SCENE_COLOURS.terrainImpassable, opacity: 0.92 };
  if (piece.height <= 2) return { colour: SCENE_COLOURS.terrainLow, opacity: 0.9 };
  // Tall pieces are part-way see-through, or the table becomes a box of walls seen from the side and
  // the models inside a ruin — the whole reason floors are modelled — are hidden by their own cover.
  return { colour: SCENE_COLOURS.terrain, opacity: 0.62 };
}

/** Absolute heights of a piece's walkable surfaces, including its roof when it has one. */
export function surfaceHeights(piece: TerrainPiece): number[] {
  const out = piece.floors.map((f) => piece.base + f);
  const roof = topOf(piece);
  if (!out.some((z) => Math.abs(z - roof) < 0.1)) out.push(roof);
  return [...new Set(out)].sort((a, b) => a - b);
}
