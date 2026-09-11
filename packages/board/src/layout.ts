/**
 * Terrain layouts as data.
 *
 * A layout is a board size, a set of terrain pieces and a set of objectives. The ones shipped here
 * are **generic** arrangements — nothing from any published mission pack, which is user-imported
 * data like every other piece of rules text in this project.
 *
 * Real tournament layouts are built with 180° rotational symmetry so neither side is favoured, and
 * `mirrored` builds one that way from a half-table's worth of pieces.
 */

import type { BoardSize, Objective, Zone } from "./board";
import { BATTLE_SIZES, rectZone } from "./board";
import type { TerrainPiece, TerrainTrait } from "./terrain";
import { terrain, topOf } from "./terrain";
import type { Vec2 } from "./vec";
import { bounds, pointInPolygon, signedArea } from "./vec";

export interface TerrainLayout {
  readonly id: string;
  readonly name: string;
  readonly size: BoardSize;
  readonly pieces: readonly TerrainPiece[];
  readonly objectives: readonly Objective[];
  /**
   * Deployment zones, when the layout carries its own. Most do not: zones usually come from the
   * mission rather than the terrain, and `edgeZones` supplies a generic pair. A layout that *does*
   * define them — an imported tournament map, say — has nowhere else to put them.
   */
  readonly zones?: readonly Zone[];
  /** What the layout is for, and anything a player should know about how it was abstracted. */
  readonly note?: string;
}

/** An axis-aligned rectangular piece, given by its centre and extents. */
export function box(id: string, centre: Vec2, width: number, depth: number, height: number, traits: readonly TerrainTrait[] = [], floors?: readonly number[], climbableBy?: readonly string[]): TerrainPiece {
  const w = width / 2;
  const d = depth / 2;
  return terrain({
    id,
    polygon: [
      { x: centre.x - w, y: centre.y - d },
      { x: centre.x + w, y: centre.y - d },
      { x: centre.x + w, y: centre.y + d },
      { x: centre.x - w, y: centre.y + d },
    ],
    height,
    traits,
    floors: floors ?? [0],
    climbableBy: climbableBy ?? [],
  });
}

/** Who can get up a ruin: models on their own feet, not a tank. An edition may say otherwise. */
export const CLIMBERS = ["INFANTRY", "CHARACTER", "BEAST", "SWARM"] as const;

/** A ruin: obscuring, gives heavy cover, hollow at ground level with storeys every 4". */
export function ruin(id: string, centre: Vec2, width: number, depth: number, storeys = 2): TerrainPiece {
  const floors = Array.from({ length: storeys }, (_, i) => i * 4);
  return box(id, centre, width, depth, storeys * 4 + 1, ["obscuring", "heavy-cover", "scalable", "breachable"], floors, CLIMBERS);
}

/**
 * A right-angled triangular footprint, given by its centre and the extents of its bounding box.
 *
 * `flip` mirrors it across the x axis, because the shape is used in mirrored pairs — a layout built
 * from one handedness only cannot be made symmetric.
 */
export function wedge(id: string, centre: Vec2, width: number, depth: number, height: number, traits: readonly TerrainTrait[] = [], floors?: readonly number[], climbableBy?: readonly string[], flip = false): TerrainPiece {
  const w = width / 2;
  const d = depth / 2;
  const y = (dy: number) => (flip ? -dy : dy);
  return terrain({
    id,
    polygon: [
      { x: centre.x - w, y: centre.y + y(-d) },
      { x: centre.x + w, y: centre.y + y(-d) },
      { x: centre.x - w, y: centre.y + y(d) },
    ],
    height,
    traits,
    floors: floors ?? [0],
    climbableBy: climbableBy ?? [],
  });
}

/**
 * The footprints an 11th-edition table is laid out with: sixteen areas in five sizes.
 *
 * Sizes only — these are the dimensions of the terrain areas the edition's layouts are specified in,
 * which is what makes transcribing one a matter of choosing a shape and typing two measurements. No
 * layout is reproduced here; the numbers are the shapes themselves, not anyone's arrangement of them.
 */
export interface FootprintPreset {
  readonly id: string;
  readonly label: string;
  readonly width: number;
  readonly depth: number;
  readonly shape: "rectangle" | "wedge";
  /** How many of this size a standard set contains. */
  readonly count: number;
}

export const TERRAIN_AREA_PRESETS: readonly FootprintPreset[] = [
  { id: "large-rect", label: 'Large rectangle 11.5 x 7"', width: 11.5, depth: 7, shape: "rectangle", count: 4 },
  { id: "large-wedge", label: 'Large wedge 11.5 x 8"', width: 11.5, depth: 8, shape: "wedge", count: 2 },
  { id: "medium-rect", label: 'Medium rectangle 6 x 4"', width: 6, depth: 4, shape: "rectangle", count: 4 },
  { id: "long-line", label: 'Long line 10 x 2.5"', width: 10, depth: 2.5, shape: "rectangle", count: 2 },
  { id: "short-line", label: 'Short line 6 x 2"', width: 6, depth: 2, shape: "rectangle", count: 4 },
];

/** A crater or wreck: low, gives light cover, never blocks a sight line. */
export function crater(id: string, centre: Vec2, width: number, depth: number): TerrainPiece {
  return box(id, centre, width, depth, 0.4, ["light-cover", "transparent"], [0]);
}

/** Rotate a point 180° about the table's centre — the symmetry every fair layout is built on. */
export const opposite = (p: Vec2, size: BoardSize): Vec2 => ({ x: size.width - p.x, y: size.depth - p.y });

/**
 * Build a layout from half of it: each piece and objective is placed, then placed again rotated 180°
 * about the centre. Anything already on the centre point is left alone rather than doubled.
 */
export function mirrored(spec: {
  id: string;
  name: string;
  size: BoardSize;
  note?: string;
  half: (place: { box: typeof box; ruin: typeof ruin; crater: typeof crater }, size: BoardSize) => readonly TerrainPiece[];
  objectives: readonly Vec2[];
}): TerrainLayout {
  const { size } = spec;
  const half = spec.half({ box, ruin, crater }, size);
  const pieces: TerrainPiece[] = [];
  for (const piece of half) {
    pieces.push(piece);
    const twin = terrain({ ...piece, id: `${piece.id}'`, polygon: piece.polygon.map((p) => opposite(p, size)) });
    if (!sameFootprint(piece, twin)) pieces.push(twin);
  }

  const objectives: Objective[] = [];
  const seen = new Set<string>();
  for (const at of spec.objectives) {
    for (const p of [at, opposite(at, size)]) {
      const key = `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      objectives.push({ id: `obj${objectives.length + 1}`, at: p });
    }
  }

  return { id: spec.id, name: spec.name, size, pieces, objectives, note: spec.note };
}

function sameFootprint(a: TerrainPiece, b: TerrainPiece): boolean {
  const ba = bounds(a.polygon);
  const bb = bounds(b.polygon);
  return Math.abs(ba.minX - bb.minX) < 0.01 && Math.abs(ba.minY - bb.minY) < 0.01 && Math.abs(ba.maxX - bb.maxX) < 0.01 && Math.abs(ba.maxY - bb.maxY) < 0.01;
}

/**
 * The five-objective arrangement most missions use: one in the centre, four at the quarter points.
 * A pattern, not anyone's copyrighted map.
 */
export function quincunx(size: BoardSize): Vec2[] {
  const { width: w, depth: d } = size;
  return [
    { x: w / 2, y: d / 2 },
    { x: w / 4, y: d / 4 },
    { x: (3 * w) / 4, y: d / 4 },
    { x: w / 4, y: (3 * d) / 4 },
    { x: (3 * w) / 4, y: (3 * d) / 4 },
  ];
}

/**
 * A generic pair of deployment zones: a strip along each short edge, facing one another. Published
 * missions use more interesting shapes; those are user-imported data, and any `Zone` polygon works.
 */
export function edgeZones(size: BoardSize, depth = 12): readonly [Zone, Zone] {
  return [rectZone("attacker-zone", "attacker", 0, 0, size.width, depth), rectZone("defender-zone", "defender", 0, size.depth - depth, size.width, size.depth)];
}

/* ---- the shipped layouts ---------------------------------------------------------------------- */

const SF = BATTLE_SIZES.strikeForce;

/** Sparse: long sight lines, little to hide behind. Shooting armies love it. */
export const OPEN_APPROACH: TerrainLayout = mirrored({
  id: "open-approach",
  name: "Open Approach",
  size: SF,
  note: "Sparse cover and long firing lanes. A test of whether a list can cross a table.",
  objectives: [{ x: 30, y: 22 }, { x: 15, y: 11 }, { x: 45, y: 11 }],
  half: ({ ruin, crater }) => [ruin("r1", { x: 16, y: 30 }, 9, 6, 2), crater("c1", { x: 30, y: 34 }, 8, 6), crater("c2", { x: 46, y: 33 }, 7, 5), ruin("r2", { x: 8, y: 14 }, 6, 8, 1)],
});

/** Dense: twelve ruins in the layout most tournament packs approximate. Movement is a puzzle. */
export const RUINED_CITY: TerrainLayout = mirrored({
  id: "ruined-city",
  name: "Ruined City",
  size: SF,
  note: "Dense two-storey ruins. Line of sight is scarce and upper floors are worth taking.",
  objectives: quincunx(SF).slice(0, 3),
  half: ({ ruin }) => [
    ruin("a1", { x: 11, y: 33 }, 9, 6, 2),
    ruin("a2", { x: 30, y: 33 }, 7, 6, 2),
    ruin("a3", { x: 49, y: 33 }, 9, 6, 2),
    ruin("b1", { x: 18, y: 22 }, 6, 9, 2),
    ruin("b2", { x: 30, y: 22 }, 8, 7, 2),
  ],
});

/** A single dominating centrepiece with approaches: the fight is about who holds the middle. */
export const CROSSFIRE: TerrainLayout = mirrored({
  id: "crossfire",
  name: "Crossfire",
  size: SF,
  note: "One three-storey centrepiece and four flanking ruins. Whoever holds the middle sees everything.",
  objectives: quincunx(SF),
  half: ({ ruin, box }) => [box("core", { x: 30, y: 22 }, 12, 10, 13, ["obscuring", "heavy-cover", "scalable", "breachable"], [0, 4, 8], CLIMBERS), ruin("f1", { x: 13, y: 32 }, 8, 6, 2), ruin("f2", { x: 47, y: 32 }, 8, 6, 2)],
});

/** Hard cover that cannot be walked through, plus low craters: a layout about angles, not floors. */
export const REDOUBT: TerrainLayout = mirrored({
  id: "redoubt",
  name: "Redoubt",
  size: SF,
  note: "Sealed bunkers block movement as well as sight; craters give light cover in the open ground between them.",
  objectives: quincunx(SF),
  half: ({ box, crater }) => [
    box("bunker1", { x: 20, y: 30 }, 8, 6, 5, ["obscuring", "heavy-cover", "impassable"], [5]),
    box("bunker2", { x: 42, y: 28 }, 6, 8, 5, ["obscuring", "heavy-cover", "impassable"], [5]),
    crater("k1", { x: 30, y: 34 }, 9, 6),
    crater("k2", { x: 10, y: 18 }, 7, 7),
  ],
});

export const LAYOUTS: readonly TerrainLayout[] = [OPEN_APPROACH, RUINED_CITY, CROSSFIRE, REDOUBT];

/* ---- validation -------------------------------------------------------------------------------- */

/**
 * Problems with a layout, in the words a layout editor would use. An empty list means the layout is
 * playable; it says nothing about whether it is balanced.
 */
export function layoutIssues(layout: TerrainLayout): string[] {
  const issues: string[] = [];
  const { width, depth } = layout.size;

  for (const piece of layout.pieces) {
    const box2 = bounds(piece.polygon);
    if (box2.minX < -0.01 || box2.minY < -0.01 || box2.maxX > width + 0.01 || box2.maxY > depth + 0.01) issues.push(`${piece.id}: hangs off the table`);
    if (piece.polygon.length < 3) issues.push(`${piece.id}: footprint is not a polygon`);
    for (const f of piece.floors) {
      if (f < -0.01 || piece.base + f > topOf(piece) + 0.01) issues.push(`${piece.id}: floor at ${f}" is outside the piece`);
    }
  }

  const ids = layout.pieces.map((p) => p.id);
  for (const id of new Set(ids)) if (ids.filter((x) => x === id).length > 1) issues.push(`${id}: duplicate piece id`);

  // A ring whose points are collinear looks like a piece in the data and blocks nothing on the
  // table, which is the worst way for terrain to be wrong: present in the list, absent in play.
  for (const piece of layout.pieces) if (piece.polygon.length >= 3 && Math.abs(signedArea(piece.polygon)) < 1e-6) issues.push(`${piece.id}: footprint encloses no area`);

  const objectiveIds = layout.objectives.map((o) => o.id);
  for (const id of new Set(objectiveIds)) if (objectiveIds.filter((x) => x === id).length > 1) issues.push(`${id}: duplicate objective id`);

  for (const objective of layout.objectives) {
    const { x, y } = objective.at;
    if (x < 0 || y < 0 || x > width || y > depth) issues.push(`${objective.id}: off the table`);
    for (const piece of layout.pieces) {
      if (!piece.traits.includes("impassable")) continue;
      if (pointInPolygon(objective.at, piece.polygon)) issues.push(`${objective.id}: sits inside impassable terrain (${piece.id})`);
    }
  }

  return issues;
}
