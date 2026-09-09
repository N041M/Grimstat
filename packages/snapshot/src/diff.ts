import type { Datasheet, PriceRule, Snapshot, SnapshotData } from "@grimstat/schema";
import { canonicalJson } from "./checksum";

export type DiffEntity = "faction" | "publication" | "datasheet" | "ability" | "detachment" | "enhancement" | "stratagem" | "wargearPrice";

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}
export interface EntityRef {
  entity: DiffEntity;
  id: string;
  name: string;
}
export interface EntityChange extends EntityRef {
  changes: FieldChange[];
}
export interface PointsChange {
  datasheetId: string;
  name: string;
  /** Points of the first copy at the smallest unit size, before/after (undefined = no price). */
  before?: number;
  after?: number;
  delta?: number;
  /** Full price rules before/after when they differ. */
  rulesBefore: PriceRule[];
  rulesAfter: PriceRule[];
}

export interface SnapshotDiff {
  from: { id: string; checksum: string };
  to: { id: string; checksum: string };
  added: EntityRef[];
  removed: EntityRef[];
  changed: EntityChange[];
  points: PointsChange[];
  summary: { added: number; removed: number; changed: number; pointsChanged: number };
}

const COLLECTIONS: { entity: DiffEntity; key: keyof SnapshotData }[] = [
  { entity: "faction", key: "factions" },
  { entity: "publication", key: "publications" },
  { entity: "datasheet", key: "datasheets" },
  { entity: "ability", key: "abilities" },
  { entity: "detachment", key: "detachments" },
  { entity: "enhancement", key: "enhancements" },
  { entity: "stratagem", key: "stratagems" },
];

function same(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}

/** Field-level differences between two records; arrays of named objects (models, weapons) are compared per name. */
export function fieldChanges(before: Record<string, unknown>, after: Record<string, unknown>, ignore: string[] = []): FieldChange[] {
  const out: FieldChange[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of [...keys].sort()) {
    if (ignore.includes(key)) continue;
    const a = before[key];
    const b = after[key];
    if (same(a, b)) continue;
    if (Array.isArray(a) && Array.isArray(b) && a.every(isNamed) && b.every(isNamed)) {
      const byName = (list: { name: string }[]): Map<string, unknown> => new Map(list.map((x) => [x.name, x]));
      const ma = byName(a as { name: string }[]);
      const mb = byName(b as { name: string }[]);
      for (const n of new Set([...ma.keys(), ...mb.keys()])) {
        const va = ma.get(n);
        const vb = mb.get(n);
        if (va === undefined) out.push({ field: `${key}[${n}]`, before: undefined, after: vb });
        else if (vb === undefined) out.push({ field: `${key}[${n}]`, before: va, after: undefined });
        else if (!same(va, vb)) for (const c of fieldChanges(va as Record<string, unknown>, vb as Record<string, unknown>, ["id"])) out.push({ field: `${key}[${n}].${c.field}`, before: c.before, after: c.after });
      }
      continue;
    }
    out.push({ field: key, before: a, after: b });
  }
  return out;
}

function isNamed(x: unknown): x is { name: string } {
  return !!x && typeof x === "object" && typeof (x as { name?: unknown }).name === "string";
}

function firstCopyPoints(rules: PriceRule[]): number | undefined {
  const first = rules.filter((r) => r.copyRange.min <= 1).sort((a, b) => a.copyRange.min - b.copyRange.min)[0] ?? rules[0];
  if (!first) return undefined;
  const tier = [...first.tiers].sort((a, b) => a.models - b.models)[0];
  return tier?.points;
}

/** Compare two snapshots entity by entity. Points changes are summarised per datasheet. */
export function diffSnapshots(a: Snapshot, b: Snapshot): SnapshotDiff {
  const added: EntityRef[] = [];
  const removed: EntityRef[] = [];
  const changed: EntityChange[] = [];
  for (const { entity, key } of COLLECTIONS) {
    const la = a.data[key] as { id: string; name: string }[];
    const lb = b.data[key] as { id: string; name: string }[];
    const ma = new Map(la.map((x) => [x.id, x]));
    const mb = new Map(lb.map((x) => [x.id, x]));
    for (const [id, x] of ma) if (!mb.has(id)) removed.push({ entity, id, name: x.name });
    for (const [id, y] of mb) {
      const x = ma.get(id);
      if (!x) {
        added.push({ entity, id, name: y.name });
        continue;
      }
      const ignore = entity === "datasheet" ? ["fallbackPoints"] : [];
      const changes = fieldChanges(x as unknown as Record<string, unknown>, y as unknown as Record<string, unknown>, ignore);
      if (changes.length) changed.push({ entity, id, name: y.name, changes });
    }
  }
  // wargear prices keyed by datasheet + item
  const wa = new Map(a.data.wargearPrices.map((w) => [`${w.datasheetId}|${w.item}`, w]));
  const wb = new Map(b.data.wargearPrices.map((w) => [`${w.datasheetId}|${w.item}`, w]));
  for (const [k, w] of wa) if (!wb.has(k)) removed.push({ entity: "wargearPrice", id: k, name: w.item });
  for (const [k, w] of wb) {
    const x = wa.get(k);
    if (!x) added.push({ entity: "wargearPrice", id: k, name: w.item });
    else if (x.points !== w.points) changed.push({ entity: "wargearPrice", id: k, name: w.item, changes: [{ field: "points", before: x.points, after: w.points }] });
  }

  // points per datasheet
  const rulesBy = (s: Snapshot): Map<string, PriceRule[]> => {
    const m = new Map<string, PriceRule[]>();
    for (const r of s.data.priceRules) m.set(r.datasheetId, [...(m.get(r.datasheetId) ?? []), r]);
    return m;
  };
  const ra = rulesBy(a);
  const rb = rulesBy(b);
  const dsName = new Map<string, string>();
  for (const d of [...a.data.datasheets, ...b.data.datasheets] as Datasheet[]) dsName.set(d.id, d.name);
  const points: PointsChange[] = [];
  for (const id of new Set([...ra.keys(), ...rb.keys()])) {
    const before = ra.get(id) ?? [];
    const after = rb.get(id) ?? [];
    if (same(before.map(stripLabel), after.map(stripLabel))) continue;
    const pb = firstCopyPoints(before);
    const pa = firstCopyPoints(after);
    const change: PointsChange = { datasheetId: id, name: dsName.get(id) ?? id, rulesBefore: before, rulesAfter: after };
    if (pb !== undefined) change.before = pb;
    if (pa !== undefined) change.after = pa;
    if (pb !== undefined && pa !== undefined) change.delta = pa - pb;
    points.push(change);
  }
  points.sort((x, y) => x.name.localeCompare(y.name));
  return {
    from: { id: a.id, checksum: a.checksum },
    to: { id: b.id, checksum: b.checksum },
    added,
    removed,
    changed,
    points,
    summary: { added: added.length, removed: removed.length, changed: changed.length, pointsChanged: points.length },
  };
}

function stripLabel(r: PriceRule): Omit<PriceRule, "label"> {
  const { label: _label, ...rest } = r;
  return rest;
}
