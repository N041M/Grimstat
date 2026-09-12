/**
 * Editing a terrain layout.
 *
 * Pure functions over `TerrainLayout`, so the editor's behaviour can be tested without a canvas and
 * so every change is a new layout rather than a mutation — which is what makes undo, comparison and
 * "mirror this" cheap.
 *
 * The editor exists because shipping layouts is not an option this project has. Published and
 * community layouts belong to the people who made them; what Grimstat can offer is the means to
 * build your own and to import theirs onto your own machine.
 */

import type { BoardSize, Objective, TerrainLayout, TerrainPiece, TerrainTrait, Vec2 } from "@grimstat/board";
import { CLIMBERS, LAYOUTS, bounds, defaultBreachers, isSymmetric, layoutIssues, opposite, terrain } from "@grimstat/board";
import { newId } from "./ids";

/**
 * A piece or objective id the way a person reads it: `ruin-2` is Ruin 2, `area-l` is Area L.
 *
 * Ids are how pieces are identified in the data and in a layout file, so they stay as they are. This
 * is what the panel prints when it is talking to the person editing the table.
 */
export function displayName(id: string): string {
  const words = id.split(/[-_\s]+/).filter(Boolean);
  if (!words.length) return id;
  return words.map((w) => (/^\d+$/.test(w) ? w : w.length <= 2 ? w.toUpperCase() : w[0]!.toUpperCase() + w.slice(1))).join(" ");
}

/** A new id that does not collide with anything already in the layout. */
export function freeId(layout: TerrainLayout, stem: string): string {
  const taken = new Set(layout.pieces.map((p) => p.id));
  if (!taken.has(stem)) return stem;
  for (let i = 2; ; i++) if (!taken.has(`${stem}-${i}`)) return `${stem}-${i}`;
}

const withPieces = (layout: TerrainLayout, pieces: readonly TerrainPiece[]): TerrainLayout => ({ ...layout, pieces });

/* ---- pieces -------------------------------------------------------------------------------- */

export const addPiece = (layout: TerrainLayout, piece: TerrainPiece): TerrainLayout => withPieces(layout, [...layout.pieces, piece]);

export const removePiece = (layout: TerrainLayout, id: string): TerrainLayout => withPieces(layout, layout.pieces.filter((p) => p.id !== id));

export function updatePiece(layout: TerrainLayout, id: string, change: (p: TerrainPiece) => TerrainPiece): TerrainLayout {
  return withPieces(layout, layout.pieces.map((p) => (p.id === id ? terrain(change(p)) : p)));
}

export const movePiece = (layout: TerrainLayout, id: string, by: Vec2): TerrainLayout =>
  updatePiece(layout, id, (p) => ({ ...p, polygon: p.polygon.map((q) => ({ x: q.x + by.x, y: q.y + by.y })) }));

/** Put a piece's centre at a point, keeping its shape. */
export function placePiece(layout: TerrainLayout, id: string, at: Vec2): TerrainLayout {
  const piece = layout.pieces.find((p) => p.id === id);
  if (!piece) return layout;
  const c = centre(piece);
  return movePiece(layout, id, { x: at.x - c.x, y: at.y - c.y });
}

export function centre(piece: TerrainPiece): Vec2 {
  const box = bounds(piece.polygon);
  return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

export function extent(piece: TerrainPiece): { width: number; depth: number } {
  const box = bounds(piece.polygon);
  return { width: box.maxX - box.minX, depth: box.maxY - box.minY };
}

/** The grid published layouts are written on: half an inch. */
export const EDIT_STEP = 0.5;

/** Round a length onto the editing grid, with the float noise a division leaves behind removed. */
export const snap = (v: number, step = EDIT_STEP): number => Math.round(Math.round(v / step) * step * 1e4) / 1e4;

export const snapPoint = (p: Vec2, step = EDIT_STEP): Vec2 => ({ x: snap(p.x, step), y: snap(p.y, step) });

/**
 * Put a piece's centre at `at`, then settle it so its left and bottom sides land on the grid.
 *
 * The sides are snapped rather than the centre. A published layout gives edge distances in half inches, and an 11.5"
 * piece whose *centre* sits on the grid has both its sides a quarter inch off it — so a dragged piece
 * would never read back the round numbers the diagram was written in.
 */
export function placePieceSnapped(layout: TerrainLayout, id: string, at: Vec2, step = EDIT_STEP): TerrainLayout {
  const placed = placePiece(layout, id, at);
  const piece = placed.pieces.find((p) => p.id === id);
  if (!piece) return placed;
  const box = bounds(piece.polygon);
  const dx = snap(box.minX, step) - box.minX;
  const dy = snap(box.minY, step) - box.minY;
  const settled = updatePiece(placed, id, (p) => ({ ...p, polygon: p.polygon.map((q) => ({ x: tidy(q.x + dx), y: tidy(q.y + dy) })) }));
  // A drag that ends on the cell it started in is not an edit, and must not read as one.
  const before = layout.pieces.find((p) => p.id === id);
  const after = settled.pieces.find((p) => p.id === id);
  return before && after && samePolygon(before.polygon, after.polygon) ? layout : settled;
}

const samePolygon = (a: readonly Vec2[], b: readonly Vec2[]): boolean => a.length === b.length && a.every((p, i) => Math.abs(p.x - b[i]!.x) < 1e-9 && Math.abs(p.y - b[i]!.y) < 1e-9);

/** Drop the sub-micron noise that a chain of moves leaves on a coordinate, so 17 reads as 17. */
const tidy = (v: number): number => Math.round(v * 1e4) / 1e4;

/**
 * A copy of a piece beside the original, under a free id.
 *
 * Building a table is mostly placing the same footprint sixteen times, and copying the last one keeps
 * its size, height, storeys and traits — everything but where it stands.
 */
export function duplicatePiece(layout: TerrainLayout, id: string, by: Vec2 = { x: 2, y: -2 }): { layout: TerrainLayout; id: string } | undefined {
  const piece = layout.pieces.find((p) => p.id === id);
  if (!piece) return undefined;
  const stem = piece.id.replace(/-\d+$/, "");
  const nextId = freeId(layout, stem);
  const twin = terrain({ ...piece, id: nextId, polygon: piece.polygon.map((q) => ({ x: q.x + by.x, y: q.y + by.y })) });
  return { layout: addPiece(layout, twin), id: nextId };
}

/**
 * Scale a piece to a new footprint about its own centre.
 *
 * Works on the bounding box and maps every vertex proportionally, so a rectangle resizes exactly and
 * an irregular footprint keeps its shape. A degenerate axis (a piece with no width) is left alone on
 * that axis rather than dividing by zero.
 */
export function resizePiece(layout: TerrainLayout, id: string, width: number, depth: number): TerrainLayout {
  return updatePiece(layout, id, (p) => {
    const box = bounds(p.polygon);
    const w = box.maxX - box.minX;
    const d = box.maxY - box.minY;
    const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
    const sx = w > 1e-6 ? Math.max(0.5, width) / w : 1;
    const sy = d > 1e-6 ? Math.max(0.5, depth) / d : 1;
    return { ...p, polygon: p.polygon.map((q) => ({ x: c.x + (q.x - c.x) * sx, y: c.y + (q.y - c.y) * sy })) };
  });
}

/** Rotate a piece about its own centre. */
export function rotatePiece(layout: TerrainLayout, id: string, radians: number): TerrainLayout {
  return updatePiece(layout, id, (p) => {
    const c = centre(p);
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    return {
      ...p,
      polygon: p.polygon.map((q) => {
        const dx = q.x - c.x;
        const dy = q.y - c.y;
        return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
      }),
    };
  });
}

/** Toggle a trait. Making a piece breachable names who may pass its walls, or it would admit nobody. */
export function setTrait(layout: TerrainLayout, id: string, trait: TerrainTrait, on: boolean): TerrainLayout {
  return updatePiece(layout, id, (p) => defaultBreachers({ ...p, traits: on ? [...new Set([...p.traits, trait])] : p.traits.filter((t) => t !== trait) }));
}

/**
 * Set how many storeys a piece has, keeping four inches between them and a roof above the top one.
 *
 * One storey means a solid with a walkable top — a hill or a bunker. Two or more make it a ruin you
 * can walk into, which is why the climbing keywords are attached at the same time: the moment a
 * piece has an upstairs, the question of who may go up it has an answer.
 */
export function setStoreys(layout: TerrainLayout, id: string, storeys: number, storeyHeight = 4): TerrainLayout {
  const n = Math.max(1, Math.round(storeys));
  return updatePiece(layout, id, (p) => {
    if (n === 1) return { ...p, floors: [p.height], climbableBy: [] };
    return { ...p, height: Math.max(p.height, (n - 1) * storeyHeight + 1), floors: Array.from({ length: n }, (_, i) => i * storeyHeight), climbableBy: p.climbableBy.length ? p.climbableBy : [...CLIMBERS] };
  });
}

/* ---- placing by measurement ------------------------------------------------------------------ */

/**
 * How far a piece sits from each board edge, measured to its nearest side on that axis.
 *
 * This is the form published layouts are written in — "17 inches from the left edge, 8 from the
 * bottom" — because it is how terrain is placed with a tape measure. Nobody measures to a centre.
 *
 * Note there is no "which corner" to choose: a distance from the left edge is a distance to the
 * piece's left side, and from the right edge to its right side. Conflating the two is how a
 * transcription silently ends up a piece-width out.
 */
export interface EdgeOffsets {
  /** Board's left edge (x = 0) to the piece's left side. */
  readonly fromLeft?: number;
  /** Board's right edge (x = width) to the piece's right side. */
  readonly fromRight?: number;
  /** Board's bottom edge (y = 0) to the piece's bottom side. */
  readonly fromBottom?: number;
  /** Board's top edge (y = depth) to the piece's top side. */
  readonly fromTop?: number;
}

/**
 * Where a piece currently sits, from every edge.
 *
 * The read-back matters as much as the write: with both, transcribing a published layout is typing
 * two numbers off the diagram and then checking the other two against it. A layout entered correctly
 * says so in the same units the diagram used.
 */
export function edgeOffsetsOf(layout: TerrainLayout, piece: TerrainPiece): Required<EdgeOffsets> {
  const box = bounds(piece.polygon);
  return { fromLeft: box.minX, fromRight: layout.size.width - box.maxX, fromBottom: box.minY, fromTop: layout.size.depth - box.maxY };
}

/**
 * Place a piece by the measurements a published layout gives.
 *
 * Whichever edge is named wins; the opposite one is ignored rather than fought with, so passing both
 * is not an error the user has to resolve. An axis with no measurement at all is left where it is,
 * which is what lets one axis be set at a time.
 */
export function placeByEdges(layout: TerrainLayout, id: string, offsets: EdgeOffsets): TerrainLayout {
  const piece = layout.pieces.find((p) => p.id === id);
  if (!piece) return layout;
  const box = bounds(piece.polygon);

  const dx = offsets.fromLeft !== undefined ? offsets.fromLeft - box.minX : offsets.fromRight !== undefined ? layout.size.width - offsets.fromRight - box.maxX : 0;
  const dy = offsets.fromBottom !== undefined ? offsets.fromBottom - box.minY : offsets.fromTop !== undefined ? layout.size.depth - offsets.fromTop - box.maxY : 0;

  return movePiece(layout, id, { x: dx, y: dy });
}

/* ---- objectives ---------------------------------------------------------------------------- */

export function addObjective(layout: TerrainLayout, at: Vec2): TerrainLayout {
  const taken = new Set(layout.objectives.map((o) => o.id));
  let n = layout.objectives.length + 1;
  while (taken.has(`obj${n}`)) n++;
  return { ...layout, objectives: [...layout.objectives, { id: `obj${n}`, at }] };
}

export const removeObjective = (layout: TerrainLayout, id: string): TerrainLayout => ({ ...layout, objectives: layout.objectives.filter((o) => o.id !== id) });

export function moveObjective(layout: TerrainLayout, id: string, at: Vec2): TerrainLayout {
  const objective = layout.objectives.find((o) => o.id === id);
  if (!objective || (Math.abs(objective.at.x - at.x) < 1e-9 && Math.abs(objective.at.y - at.y) < 1e-9)) return layout;
  return { ...layout, objectives: layout.objectives.map((o) => (o.id === id ? { ...o, at } : o)) };
}

/* ---- the whole board ------------------------------------------------------------------------ */

export const rename = (layout: TerrainLayout, name: string): TerrainLayout => ({ ...layout, name });

/** Change the table size, keeping everything where it is relative to the centre. */
export function setSize(layout: TerrainLayout, size: BoardSize): TerrainLayout {
  const dx = (size.width - layout.size.width) / 2;
  const dy = (size.depth - layout.size.depth) / 2;
  return {
    ...layout,
    size,
    pieces: layout.pieces.map((p) => terrain({ ...p, polygon: p.polygon.map((q) => ({ x: q.x + dx, y: q.y + dy })) })),
    objectives: layout.objectives.map((o) => ({ ...o, at: { x: o.at.x + dx, y: o.at.y + dy } })),
  };
}

/**
 * Make the layout fair: keep the half a player can see from their own edge, and give the opponent
 * the same thing rotated 180° about the centre.
 *
 * A layout that is not symmetric hands one player better ground, which is why every tournament pack
 * builds them this way. Pieces straddling the centre line are kept once, unmirrored — they already
 * belong to both sides.
 */
export function mirror(layout: TerrainLayout, keep: "near" | "far" = "near"): TerrainLayout {
  const mid = layout.size.depth / 2;
  const onMyHalf = (p: TerrainPiece) => {
    const c = centre(p);
    return keep === "near" ? c.y < mid : c.y > mid;
  };
  const straddles = (p: TerrainPiece) => {
    const box = bounds(p.polygon);
    return box.minY < mid && box.maxY > mid && Math.abs((box.minY + box.maxY) / 2 - mid) < 0.5;
  };

  const pieces: TerrainPiece[] = [];
  for (const piece of layout.pieces) {
    if (straddles(piece)) {
      pieces.push(piece);
      continue;
    }
    if (!onMyHalf(piece)) continue;
    pieces.push(piece);
    pieces.push(terrain({ ...piece, id: `${piece.id}'`, polygon: piece.polygon.map((q) => opposite(q, layout.size)) }));
  }

  const objectives: Objective[] = [];
  const seen = new Set<string>();
  const key = (p: Vec2) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`;
  for (const objective of layout.objectives) {
    const mine = keep === "near" ? objective.at.y <= mid + 0.01 : objective.at.y >= mid - 0.01;
    if (!mine) continue;
    for (const at of [objective.at, opposite(objective.at, layout.size)]) {
      if (seen.has(key(at))) continue;
      seen.add(key(at));
      objectives.push({ ...objective, id: `obj${objectives.length + 1}`, at });
    }
  }

  return { ...layout, pieces: dedupeIds(pieces), objectives };
}

/** Two pieces may end up sharing an id after a mirror; the second gets a suffix rather than vanishing. */
function dedupeIds(pieces: readonly TerrainPiece[]): TerrainPiece[] {
  const seen = new Set<string>();
  return pieces.map((p) => {
    let id = p.id;
    for (let i = 2; seen.has(id); i++) id = `${p.id}-${i}`;
    seen.add(id);
    return id === p.id ? p : { ...p, id };
  });
}

/** A fresh, empty table to build on. */
export function emptyLayout(id: string, name: string, size: BoardSize): TerrainLayout {
  return { id, name, size, pieces: [], objectives: [], note: undefined };
}

/* ---- shipped versus yours ------------------------------------------------------------------ */

/** Shipped layouts come with the app and are never edited in place. */
export const isBuiltIn = (id: string): boolean => LAYOUTS.some((l) => l.id === id);

/**
 * A copy under a new id, so editing a shipped layout — or forking one of your own — never destroys
 * what it came from.
 */
export function copyLayout(layout: TerrainLayout, name = `${layout.name} copy`): TerrainLayout {
  return { ...layout, id: newId("layout"), name };
}

export { isSymmetric, layoutIssues };
