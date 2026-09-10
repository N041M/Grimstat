import type { UnitSection } from "./roster";

/**
 * The Armies header points bar: one 8px `--fill` track segmented by role. Pure maths — the screen
 * turns the fractions into widths and the tones into tokens.
 *
 * The roles are the units list's own sections, ordered heaviest-first as the design shows
 * (Battleline, then the general "Other" bulk, transports, characters, allies) and toned
 * `--ink` → `--mid` → `--dim` so the bar reads as one descending ramp rather than a palette.
 */

export type SegmentTone = "ink" | "mid" | "dim";

/** Bar order and tone per section. The design's four roles are the first four entries. */
export const BAR_ORDER: Array<{ section: UnitSection; tone: SegmentTone }> = [
  { section: "battleline", tone: "ink" },
  { section: "other", tone: "mid" },
  { section: "transport", tone: "mid" },
  { section: "character", tone: "dim" },
  { section: "allied", tone: "dim" },
];

export interface PointsInput {
  section: UnitSection;
  points: number;
}

export interface PointsSegment {
  section: UnitSection;
  tone: SegmentTone;
  points: number;
  /** Share of the limit, 0..1. Segments never sum past 1 — an over-limit army fills the track. */
  fraction: number;
}

export interface PointsBarModel {
  segments: PointsSegment[];
  total: number;
  limit: number;
  /** Points still available; 0 once the limit is reached. */
  spare: number;
  /** Points past the limit; 0 while the army is legal. */
  over: number;
}

/**
 * Group unit points by section and turn them into track segments.
 *
 * Sections with no points are dropped so the bar carries no zero-width segments (which would still
 * take a `title` and confuse pointer targets). When the army is over its limit every segment is
 * scaled by `total` instead of `limit`, so the track fills exactly and the proportions still read.
 */
export function pointsBarModel(units: PointsInput[], limit: number): PointsBarModel {
  const bySection = new Map<UnitSection, number>();
  let total = 0;
  for (const u of units) {
    const p = Number.isFinite(u.points) ? Math.max(0, u.points) : 0;
    bySection.set(u.section, (bySection.get(u.section) ?? 0) + p);
    total += p;
  }
  const safeLimit = Number.isFinite(limit) && limit > 0 ? limit : 0;
  const scale = total > safeLimit ? total : safeLimit;
  const segments: PointsSegment[] = [];
  for (const { section, tone } of BAR_ORDER) {
    const points = bySection.get(section) ?? 0;
    if (points <= 0) continue;
    segments.push({ section, tone, points, fraction: scale > 0 ? points / scale : 0 });
  }
  return { segments, total, limit: safeLimit, spare: Math.max(0, safeLimit - total), over: Math.max(0, total - safeLimit) };
}
