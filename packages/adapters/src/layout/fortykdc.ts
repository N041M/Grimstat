/**
 * The published 11th-edition layouts, from the 40kdc-data project.
 *
 * Games Workshop prints the tournament terrain layouts in its Event Companion; the community 40kdc
 * project (Alpaca Software and contributors) publishes their geometry as data under CC BY 4.0, with
 * every piece placed by centroid on a 60 × 44 board and the on-top scenery composed from a template
 * catalogue. This module fetches that dataset from its repository — the same way the app fetches
 * BSData — and turns it into Grimstat layouts. Nothing of it ships in this repository: it lands on
 * the user's machine, credited.
 *
 * Two things to know about the translation. The data is a y-down frame with clockwise rotations,
 * and Grimstat measures y up from the near edge, so every resolved vertex is flipped once at the end.
 * And the data records footprints without heights, so where a template says nothing the height here
 * is an assumption chosen to be honest rather than pretty, and the layout's note says so.
 */

import { z } from "zod";
import type { Objective, TerrainPiece, TerrainTrait, Vec2, Zone } from "@grimstat/board";
import { BREACHERS, CLIMBERS, terrain } from "@grimstat/board";
import type { ImportedLayout } from "./import";
import type { FetchLike } from "../sources";

export const FORTYKDC = {
  id: "40kdc-data",
  name: "40kdc-data",
  repo: "https://github.com/wn-mitch/40kdc-data",
  rawBase: "https://raw.githubusercontent.com/wn-mitch/40kdc-data/main/data/core/",
  refUrl: "https://api.github.com/repos/wn-mitch/40kdc-data/commits/main",
  files: ["terrain-layouts.json", "terrain-templates.json", "deployment-patterns.json", "mission-matchups.json", "missions.json"] as const,
  licence: "CC BY 4.0",
  licenceUrl: "https://creativecommons.org/licenses/by/4.0/",
  attribution: "40kdc-data — Alpaca Software and the 40kdc community contributors, CC BY 4.0; layout geometry via Battlemaster",
  /** Every layout stored from this source carries this prefix, which is how the app tells them apart. */
  idPrefix: "40kdc-",
} as const;

/* ---- the dataset's shape, read tolerantly ---------------------------------------------------- */

const Point = z.object({ x: z.number().finite(), y: z.number().finite() });
const Footprint = z.union([z.object({ type: z.literal("rectangle"), width: z.number().finite(), height: z.number().finite() }), z.object({ type: z.literal("polygon"), points: z.array(Point) })]);
const Mirror = z.enum(["horizontal", "vertical"]).optional();

const ComposedFeature = z.object({
  id: z.string().optional(),
  template: z.string(),
  position: Point,
  rotation_degrees: z.number().finite().optional(),
  mirror: Mirror,
});

const Template = z.object({
  id: z.string(),
  name: z.string().optional(),
  kind: z.enum(["area", "feature"]),
  footprint: Footprint,
  default_height_inches: z.number().finite().optional(),
  default_blocking: z.boolean().optional(),
  ground_accessible: z.boolean().optional(),
  has_roof: z.boolean().optional(),
  upper_floor: z.object({ floor: z.number().optional() }).optional(),
  terrain_category: z.enum(["dense", "light", "exposed"]).optional(),
  features: z.array(ComposedFeature).optional(),
});
type Template = z.infer<typeof Template>;

const Piece = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  piece_type: z.enum(["area", "feature"]).optional(),
  template: z.string().optional(),
  footprint: Footprint.optional(),
  position: Point,
  rotation_degrees: z.number().finite().optional(),
  mirror: Mirror,
  parent_area_id: z.string().optional(),
  terrain: z.boolean().optional(),
  height_inches: z.number().finite().optional(),
  link_group: z.string().optional(),
  objective_role: z.string().optional(),
  is_objective: z.boolean().optional(),
  objective: z.object({ position: Point.optional() }).optional(),
});
type Piece = z.infer<typeof Piece>;

const Layout = z.object({
  id: z.string(),
  name: z.string(),
  source: z.string().optional(),
  description: z.string().optional(),
  mission_matchup_id: z.string().optional(),
  variant: z.number().optional(),
  deployment_pattern_id: z.string().optional(),
  board: z.object({ width: z.number().positive(), height: z.number().positive() }).optional(),
  pieces: z.array(Piece).default([]),
});

const Region = z.object({ player: z.string(), shape: Footprint, position: Point });
const Pattern = z.object({ id: z.string(), name: z.string().optional(), zones: z.array(Region).default([]), objectives: z.array(Point).default([]) });
const Matchup = z.object({ id: z.string(), disposition: z.string().optional(), opponent_disposition: z.string().optional() });

export interface FortykdcFiles {
  readonly "terrain-layouts.json": string;
  readonly "terrain-templates.json": string;
  readonly "deployment-patterns.json"?: string;
  readonly "mission-matchups.json"?: string;
  readonly "missions.json"?: string;
}

export interface FortykdcConvertOptions {
  /** Where the files were fetched from, recorded as provenance. */
  readonly importedFrom?: string;
  /** The upstream commit, when known. */
  readonly ref?: string;
  /** Vertices closer than this to the line between their neighbours are dropped. */
  readonly simplify?: number;
}

export interface FortykdcResult {
  readonly layouts: ImportedLayout[];
  readonly warnings: string[];
}

/* ---- geometry ---------------------------------------------------------------------------------- */

const footprintPoints = (fp: z.infer<typeof Footprint>): Vec2[] => (fp.type === "rectangle" ? [{ x: 0, y: 0 }, { x: fp.width, y: 0 }, { x: fp.width, y: fp.height }, { x: 0, y: fp.height }] : fp.points.map((p) => ({ x: p.x, y: p.y })));

/** Polygon area centroid — what the data anchors every placement on. A degenerate ring gets its mean. */
export function areaCentroid(poly: readonly Vec2[]): Vec2 {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]!;
    const q = poly[(i + 1) % poly.length]!;
    const cross = p.x * q.y - q.x * p.y;
    a += cross;
    cx += (p.x + q.x) * cross;
    cy += (p.y + q.y) * cross;
  }
  if (Math.abs(a) < 1e-9) {
    const n = poly.length || 1;
    return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n };
  }
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

const centred = (poly: readonly Vec2[]): Vec2[] => {
  const c = areaCentroid(poly);
  return poly.map((p) => ({ x: p.x - c.x, y: p.y - c.y }));
};

/**
 * Mirror, then rotate clockwise (in the y-down frame the data uses), then translate: the order the
 * schema prescribes, applied to points already centred on their centroid.
 */
export function place(local: readonly Vec2[], mirror: "horizontal" | "vertical" | undefined, degrees: number | undefined, at: Vec2): Vec2[] {
  const rad = ((degrees ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return local.map((p) => {
    const x = mirror === "horizontal" ? -p.x : p.x;
    const y = mirror === "vertical" ? -p.y : p.y;
    return { x: at.x + x * cos - y * sin, y: at.y + x * sin + y * cos };
  });
}

/** Andrew's monotone chain: the convex hull, counter-clockwise, independent of the ring's vertex order. */
export function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec2[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 1e-12) lower.pop();
    lower.push(p);
  }
  const upper: Vec2[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 1e-12) upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

const ringArea = (ring: readonly Vec2[]): number => Math.abs(ring.reduce((s, p, i) => s + (p.x * ring[(i + 1) % ring.length]!.y - ring[(i + 1) % ring.length]!.x * p.y), 0) / 2);

/**
 * The smallest rectangle that holds the hull, aligned with one of its edges — the plate a die-cut
 * outline was cut from. Rotation-covariant: a piece and its 180° twin get twin rectangles, which is
 * what keeps a symmetric card symmetric after simplification.
 */
export function minimumRectangle(hull: readonly Vec2[]): Vec2[] {
  let best: { area: number; corners: Vec2[] } | undefined;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 1e-9) continue;
    const ux = (b.x - a.x) / len;
    const uy = (b.y - a.y) / len;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = -p.x * uy + p.y * ux;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (best && area >= best.area - 1e-9) continue;
    const at = (u: number, v: number): Vec2 => ({ x: u * ux - v * uy, y: u * uy + v * ux });
    best = { area, corners: [at(minU, minV), at(maxU, minV), at(maxU, maxV), at(minU, maxV)] };
  }
  return best?.corners ?? [...hull];
}

/**
 * A base plate reduced to the shape it was cut from.
 *
 * The composite footprints in the data trace every die-cut nub and rounded corner — a few hundred
 * vertices per plate — and the table would test every sight line and move against all of them. The
 * five Event Companion plates are convex: rectangles, and a trapezoid. So the plate is its convex
 * hull, and where that hull all but fills its bounding rectangle it *is* that rectangle, corners
 * squared. Anything else keeps the hull, with vertices that only round a corner dropped.
 */
export function simplifyPlate(ring: readonly Vec2[], tolerance: number): Vec2[] {
  if (ring.length <= 4) return [...ring];
  const hull = convexHull(ring);
  if (hull.length < 3) return [...ring];
  const rect = minimumRectangle(hull);
  if (ringArea(hull) >= 0.9 * ringArea(rect)) return rect;
  return dropRounding(hull, tolerance);
}

/** Remove hull vertices that sit within `tolerance` of the chord between their neighbours, until none do. */
function dropRounding(hull: readonly Vec2[], tolerance: number): Vec2[] {
  let ring = [...hull];
  for (;;) {
    let worst = -1;
    let least = Infinity;
    for (let i = 0; i < ring.length; i++) {
      const d = pointLineDistance(ring[i]!, ring[(i + ring.length - 1) % ring.length]!, ring[(i + 1) % ring.length]!);
      if (d < least) {
        least = d;
        worst = i;
      }
    }
    if (ring.length <= 3 || least > tolerance) return ring;
    ring = ring.filter((_, i) => i !== worst);
  }
}

/**
 * Drop the vertices that only trace the die-cut nubs of a piece of scenery. Concave shapes — an
 * L-shaped ruin — keep their concavity; only near-collinear runs go.
 */
export function simplifyRing(ring: readonly Vec2[], tolerance: number): Vec2[] {
  if (ring.length <= 4 || tolerance <= 0) return [...ring];
  // Split at the two vertices furthest apart so the open-path simplifier can work on each half.
  let a = 0;
  let b = 0;
  let far = -1;
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const d = Math.hypot(ring[i]!.x - ring[j]!.x, ring[i]!.y - ring[j]!.y);
      if (d > far) {
        far = d;
        a = i;
        b = j;
      }
    }
  }
  const first = ring.slice(a, b + 1);
  const second = [...ring.slice(b), ...ring.slice(0, a + 1)];
  const out = [...douglasPeucker(first, tolerance).slice(0, -1), ...douglasPeucker(second, tolerance).slice(0, -1)];
  return out.length >= 3 ? out : [...ring];
}

function douglasPeucker(path: readonly Vec2[], tolerance: number): Vec2[] {
  if (path.length <= 2) return [...path];
  const s = path[0]!;
  const e = path[path.length - 1]!;
  let worst = -1;
  let at = 0;
  for (let i = 1; i < path.length - 1; i++) {
    const d = pointLineDistance(path[i]!, s, e);
    if (d > worst) {
      worst = d;
      at = i;
    }
  }
  if (worst <= tolerance) return [s, e];
  return [...douglasPeucker(path.slice(0, at + 1), tolerance).slice(0, -1), ...douglasPeucker(path.slice(at), tolerance)];
}

function pointLineDistance(p: Vec2, a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-12) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs(dy * p.x - dx * p.y + b.x * a.y - b.y * a.x) / len;
}

/* ---- what a piece is ----------------------------------------------------------------------------- */

/**
 * Heights, where the template gives none. Dense scenery blocks sight to a standing model; a roof
 * implies a storey; light scenery is a barricade you shoot over. All assumptions, and said so.
 */
function featureHeight(t: Template, override?: number): number {
  if (override !== undefined) return override;
  if (t.default_height_inches !== undefined) return t.default_height_inches;
  if (t.has_roof || t.upper_floor) return 5;
  return t.terrain_category === "dense" ? 3 : 1.5;
}

/** The Grimstat traits and floors for a piece of on-top scenery, from what the template says it is. */
function featureShape(t: Template, height: number): { traits: TerrainTrait[]; floors: number[]; climbableBy: string[]; passableBy: string[] } {
  const dense = t.terrain_category === "dense";
  const blocks = t.default_blocking ?? dense;
  const cover: TerrainTrait[] = dense ? ["heavy-cover"] : ["light-cover"];
  const sight: TerrainTrait[] = blocks && height > 0 ? ["obscuring"] : [];

  // A ruin: walls you can enter, a floor you can stand on.
  if (t.has_roof && t.ground_accessible !== false) {
    const storey = Math.min(4, Math.max(2, height - 1));
    return { traits: [...sight, ...cover, "scalable", "breachable"], floors: [0, storey], climbableBy: [...CLIMBERS], passableBy: [...BREACHERS] };
  }
  // A platform: nothing underneath to stand in, a deck on top.
  if (t.upper_floor || t.ground_accessible === false) {
    return { traits: [...sight, ...cover, "impassable", "scalable"], floors: [height], climbableBy: [...CLIMBERS], passableBy: [] };
  }
  // A solid obstacle — generator, pipes, a wall stub: go round it.
  if (dense) return { traits: [...sight, ...cover, "impassable"], floors: [], climbableBy: [], passableBy: [] };
  // A barricade: low enough to step over, cover to shoot from behind.
  return { traits: [...sight, ...cover], floors: [], climbableBy: [], passableBy: [] };
}

/* ---- naming ------------------------------------------------------------------------------------- */

const SMALL_WORDS = new Set(["and", "the", "of", "vs"]);

/** `take-and-hold` → `Take and Hold`. */
export const titleOf = (id: string): string =>
  id
    .split("-")
    .map((w, i) => (i > 0 && SMALL_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");

/* ---- the conversion ----------------------------------------------------------------------------- */

/** Parse the dataset's files and convert every layout in them. */
export function convertFortykdc(files: FortykdcFiles, opts: FortykdcConvertOptions = {}): FortykdcResult {
  const warnings: string[] = [];
  const read = <S extends z.ZodTypeAny>(name: keyof FortykdcFiles, schema: S): z.output<S>[] => {
    const text = files[name];
    if (!text) return [];
    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch (e) {
      throw new Error(`${name}: not JSON (${e instanceof Error ? e.message : String(e)})`);
    }
    if (!Array.isArray(doc)) throw new Error(`${name}: expected an array`);
    const out: z.output<S>[] = [];
    doc.forEach((entry, i) => {
      const parsed = schema.safeParse(entry);
      if (parsed.success) out.push(parsed.data as z.output<S>);
      else warnings.push(`${name}[${i}]: skipped — ${parsed.error.issues[0]?.message ?? "invalid"}`);
    });
    return out;
  };

  const layouts = read("terrain-layouts.json", Layout);
  const templates = new Map(read("terrain-templates.json", Template).map((t) => [t.id, t]));
  const patterns = new Map(read("deployment-patterns.json", Pattern).map((p) => [p.id, p]));
  const matchups = new Map(read("mission-matchups.json", Matchup).map((m) => [m.id, m]));
  const simplify = opts.simplify ?? 0.2;

  const out: ImportedLayout[] = [];
  for (const layout of layouts) {
    try {
      out.push(convertLayout(layout, { templates, patterns, matchups, simplify, warnings, opts }));
    } catch (e) {
      warnings.push(`${layout.id}: skipped — ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { layouts: out, warnings };
}

interface Context {
  templates: ReadonlyMap<string, Template>;
  patterns: ReadonlyMap<string, z.infer<typeof Pattern>>;
  matchups: ReadonlyMap<string, z.infer<typeof Matchup>>;
  simplify: number;
  warnings: string[];
  opts: FortykdcConvertOptions;
}

function convertLayout(layout: z.infer<typeof Layout>, ctx: Context): ImportedLayout {
  const size = { width: layout.board?.width ?? 60, depth: layout.board?.height ?? 44 };
  const flip = (p: Vec2): Vec2 => ({ x: round(p.x), y: round(size.depth - p.y) });
  const pieces: TerrainPiece[] = [];
  const ids = new Set<string>();
  const uniqueId = (stem: string): string => {
    let id = stem;
    for (let i = 2; ids.has(id); i++) id = `${stem}-${i}`;
    ids.add(id);
    return id;
  };

  /** Where a piece's centroid-local points land on the board, parents included. */
  const placements = new Map<string, (local: readonly Vec2[]) => Vec2[]>();
  const transformFor = (piece: Piece): ((local: readonly Vec2[]) => Vec2[]) => {
    const own = (local: readonly Vec2[]) => place(local, piece.mirror, piece.rotation_degrees, piece.position);
    if (!piece.parent_area_id) return own;
    const parent = placements.get(piece.parent_area_id);
    if (!parent) throw new Error(`piece "${piece.id ?? "?"}" sits on unknown area "${piece.parent_area_id}"`);
    return (local) => parent(own(local));
  };

  const addFeature = (id: string, template: Template, toBoard: (local: readonly Vec2[]) => Vec2[], heightOverride?: number) => {
    const ring = simplifyRing(toBoard(centred(footprintPoints(template.footprint))), ctx.simplify).map(flip);
    if (ring.length < 3) return;
    const height = featureHeight(template, heightOverride);
    const shape = featureShape(template, height);
    pieces.push(terrain({ id: uniqueId(id), polygon: ring, height, traits: shape.traits, floors: shape.floors, climbableBy: shape.climbableBy, passableBy: shape.passableBy }));
  };

  const objectives: Objective[] = [];
  const groups = new Map<string, Vec2[]>();

  layout.pieces.forEach((piece, i) => {
    const pieceId = piece.id ?? `piece-${i + 1}`;
    const template = piece.template ? ctx.templates.get(piece.template) : undefined;
    if (piece.template && !template) ctx.warnings.push(`${layout.id}: piece "${pieceId}" uses unknown template "${piece.template}"; skipped.`);
    const footprint = piece.footprint ?? template?.footprint;
    if (!footprint) return;
    const toBoard = transformFor(piece);
    placements.set(pieceId, toBoard);
    const local = centred(footprintPoints(footprint));
    const kind = piece.piece_type ?? template?.kind ?? "area";

    if (kind === "feature") {
      if (template) addFeature(pieceId, template, toBoard, piece.height_inches);
      return;
    }

    // An area is ground that grants cover, drawn flat: the scenery on it is what blocks and climbs.
    if (piece.terrain !== false) {
      const ring = simplifyPlate(toBoard(local), ctx.simplify).map(flip);
      if (ring.length >= 3) pieces.push(terrain({ id: uniqueId(pieceId), polygon: ring, height: 0, traits: ["light-cover"], floors: [0] }));
    }
    for (const feature of template?.features ?? []) {
      const ft = ctx.templates.get(feature.template);
      if (!ft) {
        ctx.warnings.push(`${layout.id}: area "${pieceId}" composes unknown template "${feature.template}"; skipped.`);
        continue;
      }
      const own = (l: readonly Vec2[]) => place(l, feature.mirror, feature.rotation_degrees, feature.position);
      addFeature(`${pieceId}/${feature.id ?? feature.template}`, ft, (l) => toBoard(own(l)));
    }

    if (piece.is_objective || piece.objective_role) {
      const at = piece.objective?.position ?? piece.position;
      const key = piece.link_group ? `g:${piece.link_group}` : `p:${pieceId}`;
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(at);
    }
  });

  for (const anchors of groups.values()) {
    const mean = { x: anchors.reduce((s, p) => s + p.x, 0) / anchors.length, y: anchors.reduce((s, p) => s + p.y, 0) / anchors.length };
    objectives.push({ id: `obj${objectives.length + 1}`, at: flip(mean) });
  }

  const pattern = layout.deployment_pattern_id ? ctx.patterns.get(layout.deployment_pattern_id) : undefined;
  if (!objectives.length && pattern) for (const p of pattern.objectives) objectives.push({ id: `obj${objectives.length + 1}`, at: flip(p) });

  const zones: Zone[] = [];
  for (const zone of pattern?.zones ?? []) {
    const owner = zone.player === "attacker" || zone.player === "defender" ? zone.player : undefined;
    if (!owner) continue;
    const polygon = footprintPoints(zone.shape).map((p) => flip({ x: p.x + zone.position.x, y: p.y + zone.position.y }));
    zones.push({ id: `${owner}-zone`, owner, polygon });
  }

  const matchup = layout.mission_matchup_id ? ctx.matchups.get(layout.mission_matchup_id) : undefined;
  const versus = matchup?.disposition && matchup.opponent_disposition ? `${titleOf(matchup.disposition)} vs ${titleOf(matchup.opponent_disposition)}` : layout.mission_matchup_id ? titleOf(layout.mission_matchup_id) : undefined;
  const name = versus ? `${versus} · ${layout.variant ?? 1}` : layout.name;
  const noteParts = [
    versus ? `Event Companion layout ${layout.variant ?? 1} for ${versus}.` : layout.description,
    pattern?.name ? `Deployment: ${pattern.name}.` : undefined,
    `Geometry from ${FORTYKDC.name} (${FORTYKDC.licence})${layout.source ? `, source "${layout.source}"` : ""}; heights are assumed where the data gives none.`,
  ].filter((s): s is string => Boolean(s));

  return {
    id: `${FORTYKDC.idPrefix}${layout.id}`,
    name,
    size,
    pieces,
    objectives,
    ...(zones.length === 2 ? { zones } : {}),
    note: noteParts.join(" "),
    provenance: {
      source: FORTYKDC.attribution,
      licence: FORTYKDC.licence,
      ...(ctx.opts.importedFrom ? { importedFrom: ctx.opts.ref ? `${ctx.opts.importedFrom} @ ${ctx.opts.ref}` : ctx.opts.importedFrom } : {}),
    },
  };
}

const round = (v: number): number => Math.round(v * 1000) / 1000;

/* ---- fetching ------------------------------------------------------------------------------------ */

export interface FortykdcFetch {
  readonly files: FortykdcFiles;
  /** The upstream commit the files came from, when the API answered. */
  readonly ref?: string;
  readonly url: string;
}

/** The dataset's files from its repository. Works in a browser: the raw host allows any origin. */
export async function fetchFortykdc(fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<FortykdcFetch> {
  const files: Record<string, string> = {};
  for (const name of FORTYKDC.files) {
    const url = `${FORTYKDC.rawBase}${name}`;
    const res = await fetchImpl(url, { headers: { Accept: "application/json, text/plain, */*" } });
    if (!res.ok) throw new Error(`GET ${url} -> HTTP ${res.status}`);
    files[name] = await res.text();
  }
  let ref: string | undefined;
  try {
    const res = await fetchImpl(FORTYKDC.refUrl, { headers: { Accept: "application/vnd.github+json" } });
    if (res.ok) ref = (JSON.parse(await res.text()) as { sha?: string }).sha?.slice(0, 12);
  } catch {
    // The commit only records provenance, so a rate-limited API loses the note and keeps the layouts.
  }
  return { files: files as unknown as FortykdcFiles, ...(ref ? { ref } : {}), url: FORTYKDC.rawBase };
}
