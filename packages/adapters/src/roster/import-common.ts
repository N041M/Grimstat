import type { Datasheet, Detachment, Enhancement, Faction, ModelProfile, Roster, RosterDetachment, RosterUnit, Snapshot } from "@grimstat/schema";
import { normaliseName } from "@grimstat/snapshot";

/** Battle-size labels as written by the GW app, New Recruit and BattleScribe. */
export const SIZE_BY_LABEL: Record<string, Roster["battleSize"]> = { "combat patrol": "combat-patrol", incursion: "incursion", "strike force": "strike-force", onslaught: "onslaught" };
/** Default points limit of each battle size. */
export const POINTS_BY_SIZE: Record<Roster["battleSize"], number> = { "combat-patrol": 500, incursion: 1000, "strike-force": 2000, onslaught: 3000, custom: 2000 };

export type AttachRole = RosterUnit extends { attachedTo?: { role: infer R } } ? R : never;

/** A unit collected while parsing, before names are resolved into a RosterUnit. */
export interface PendingUnit {
  id: string;
  ds: Datasheet;
  name: string;
  customName?: string;
  groups: RosterUnit["models"];
  warlord: boolean;
  enhancementName?: string;
  /** Host unit looked up by datasheet name when the roster is built. */
  attach?: { hostName: string; role: AttachRole };
  /** Host already resolved to a pending-unit id; takes precedence over `attach`. */
  attachHost?: { unitId: string; role: AttachRole };
}

/** Strips list-export decorations that leak into names: "4x Warden", "Warden [10 pts]", "Warden (10 points)". */
export function cleanLabel(name: string): string {
  return name
    .replace(/^\s*\d+\s*[x×]\s+/i, "")
    .replace(/\s*\[[^\]]*\]\s*$/, "")
    .replace(/\s*\(\s*\d+\s*(?:pts?|points?)\s*\)\s*$/i, "")
    .trim();
}

/** Significant words of a name: case, punctuation and the joiners that dialects drop ("of", "the") are noise. */
function tokens(s: string): string[] {
  return normaliseName(s)
    .split(" ")
    .filter((t) => t && t !== "of" && t !== "the");
}

/** True when `key` (already normalised) names one of the datasheet's weapons, or a weapon group such as a "twin-linked" profile pair. */
export function isWeaponOf(ds: Datasheet, key: string): boolean {
  return ds.weapons.some((w) => normaliseName(w.name) === key || (w.groupName !== undefined && normaliseName(w.groupName) === key));
}

const tokenKey = (s: string): string => [...new Set(tokens(s))].sort().join(" ");

/** A snapshot's name lookups, built once and shared by every import against that snapshot. */
export interface NameIndex {
  readonly factionByKey: ReadonlyMap<string, Faction>;
  readonly dsByKey: ReadonlyMap<string, readonly Datasheet[]>;
  /** Every datasheet with its normalised name and token key, for the looser matches. */
  readonly names: readonly { ds: Datasheet; key: string; tokenKey: string }[];
}

const INDEXES = new WeakMap<Snapshot, NameIndex>();

/**
 * The index for a snapshot. Building it means normalising every datasheet name, which was most of
 * the cost of an import, so it is kept on the snapshot object and reused: a corpus of hundreds of
 * lists resolved against one snapshot pays for it once.
 */
export function nameIndexOf(snapshot: Snapshot): NameIndex {
  const cached = INDEXES.get(snapshot);
  if (cached) return cached;
  const factionByKey = new Map(snapshot.data.factions.map((f) => [normaliseName(f.name), f] as const));
  const dsByKey = new Map<string, Datasheet[]>();
  const names: { ds: Datasheet; key: string; tokenKey: string }[] = [];
  for (const ds of snapshot.data.datasheets) {
    const key = normaliseName(ds.name);
    dsByKey.set(key, [...(dsByKey.get(key) ?? []), ds]);
    names.push({ ds, key, tokenKey: tokenKey(ds.name) });
  }
  const index: NameIndex = { factionByKey, dsByKey, names };
  INDEXES.set(snapshot, index);
  return index;
}

/**
 * State and name lookups shared by the roster importers (plain-text lists and BattleScribe / New Recruit XML).
 * Names are matched with `normaliseName`; the first datasheet or detachment that resolves fixes the faction, which
 * then disambiguates later lookups. `build` turns the pending units into a Roster.
 */
export class RosterImportContext {
  readonly warnings: string[] = [];
  readonly units: PendingUnit[] = [];
  readonly detachments: RosterDetachment[] = [];
  factionId: string | undefined;
  private readonly index: NameIndex;

  constructor(readonly snapshot: Snapshot) {
    this.index = nameIndexOf(snapshot);
  }

  findFaction(label: string): Faction | undefined {
    return this.index.factionByKey.get(normaliseName(label));
  }

  /** Datasheet by exact name; when several factions share the name, the roster's faction wins. */
  findDatasheet(label: string): Datasheet | undefined {
    return this.pick(this.index.dsByKey.get(normaliseName(label)) ?? []);
  }

  /**
   * Datasheet by name, tolerating how the dialects rewrite it: exact, then token-set equality
   * ("Sisters of Battle Squad" ~ "Battle Sisters Squad"), then containment ("Wardens of Ashen Crusher").
   * Deliberately separate from `findDatasheet`: containment is right for a line that is known to name a unit,
   * but would turn arbitrary upgrade selections in a `.rosz` into units.
   */
  matchDatasheet(label: string): Datasheet | undefined {
    const exact = this.findDatasheet(label);
    if (exact) return exact;
    const key = normaliseName(label);
    const want = tokenKey(label);
    if (!want) return undefined;
    const tokenHits = this.index.names.filter((n) => n.tokenKey === want).map((n) => n.ds);
    if (tokenHits.length) return this.pick(tokenHits);
    // the longest datasheet name contained in the label, or the label contained in a datasheet name
    const contained = this.index.names.filter((n) => n.key.length >= 5 && (key.includes(n.key) || n.key.includes(key))).map((n) => n.ds);
    if (!contained.length) return undefined;
    const inFaction = contained.filter((d) => d.factionId === this.factionId);
    return (inFaction.length ? inFaction : contained).sort((a, b) => b.name.length - a.name.length)[0];
  }

  private pick(cands: readonly Datasheet[]): Datasheet | undefined {
    return cands.find((d) => d.factionId === this.factionId) ?? cands[0];
  }

  /** Detachment by name; prefers the roster's faction, falls back to any faction. */
  findDetachment(label: string): Detachment | undefined {
    const key = normaliseName(label);
    const dets = this.snapshot.data.detachments;
    return dets.find((d) => normaliseName(d.name) === key && (!this.factionId || d.factionId === this.factionId)) ?? dets.find((d) => normaliseName(d.name) === key);
  }

  /**
   * Adds a detachment by name. Unknown names produce a warning and return undefined; a name already in the
   * roster returns the existing entry, because lists repeat it (header block *and* a body line) far more
   * often than they field the same detachment twice.
   */
  addDetachment(label: string, disposition?: string): RosterDetachment | undefined {
    const det = this.findDetachment(label);
    if (!det) {
      this.warnings.push(`Unknown detachment "${label}".`);
      return undefined;
    }
    if (!this.factionId) this.factionId = det.factionId;
    const seen = this.detachments.find((d) => d.detachmentId === det.id);
    if (seen) {
      if (disposition) seen.forceDisposition = disposition;
      return seen;
    }
    const entry: RosterDetachment = { id: `d${this.detachments.length + 1}`, detachmentId: det.id };
    if (disposition) entry.forceDisposition = disposition;
    this.detachments.push(entry);
    return entry;
  }

  /** Registers a unit for `ds`; the first unit fixes the faction when nothing else has. */
  newUnit(ds: Datasheet): PendingUnit {
    if (!this.factionId) this.factionId = ds.factionId;
    const u: PendingUnit = { id: `u${this.units.length + 1}`, ds, name: ds.name, groups: [], warlord: false };
    this.units.push(u);
    return u;
  }

  /**
   * Model profile for a selection or list label: exact, singular/plural, the datasheet name on a single-profile
   * datasheet, a "Warden w/ …" prefix or a "… Sergeant" suffix, and finally token-set equality.
   */
  profileFor(ds: Datasheet, label: string): ModelProfile | undefined {
    const key = normaliseName(label);
    if (!key) return undefined;
    const exact = ds.models.find((m) => normaliseName(m.name) === key);
    if (exact) return exact;
    const loose = ds.models.find((m) => normaliseName(m.name).replace(/s$/, "") === key.replace(/s$/, ""));
    if (loose) return loose;
    // the datasheet's own name ("10x Warden Squad") names a profile only when there is a single one to name;
    // on a multi-profile datasheet it describes the whole unit, and the prefix rule below must not claim it
    if (normaliseName(ds.name) === key) return ds.models.length === 1 ? ds.models[0] : undefined;
    const scored = ds.models
      .map((m) => ({ m, k: normaliseName(m.name) }))
      .filter((x) => key.startsWith(`${x.k} `) || x.k.endsWith(` ${key}`))
      .sort((a, b) => b.k.length - a.k.length);
    if (scored[0]) return scored[0].m;
    const want = tokens(label).sort().join(" ");
    return ds.models.find((m) => tokens(m.name).sort().join(" ") === want);
  }

  /** Enhancement by name; prefers one that belongs to a detachment already in the roster. */
  findEnhancement(label: string): Enhancement | undefined {
    const key = normaliseName(label);
    const enhs = this.snapshot.data.enhancements;
    return enhs.find((e) => normaliseName(e.name) === key && this.detachments.some((d) => d.detachmentId === e.detachmentId)) ?? enhs.find((e) => normaliseName(e.name) === key);
  }

  /**
   * Pending unit whose datasheet (or custom name) is `name`. Prefers one that no leader has claimed yet, so that
   * two identical squads in a list take one character each instead of stacking both on the first.
   */
  findUnitByName(name: string, exclude: PendingUnit): PendingUnit | undefined {
    const key = normaliseName(cleanLabel(name));
    const cands = this.units.filter((h) => h !== exclude && (normaliseName(h.name) === key || (h.customName !== undefined && normaliseName(h.customName) === key)));
    return cands.find((h) => !this.units.some((o) => o.attachHost?.unitId === h.id)) ?? cands[0];
  }

  /** Converts the pending units into a Roster: default model groups, enhancement ids and leader attachments. */
  build(opts: { name: string; battleSize: Roster["battleSize"]; pointsLimit: number }): { roster: Roster; warnings: string[] } {
    const now = new Date().toISOString();
    const factionId = this.factionId ?? this.snapshot.data.factions[0]?.id ?? "unknown";
    // resolve name-based hosts first, in list order, so `findUnitByName` can see which hosts are already taken
    for (const u of this.units) {
      if (u.attachHost || !u.attach) continue;
      const host = this.findUnitByName(u.attach.hostName, u);
      if (host) u.attachHost = { unitId: host.id, role: u.attach.role };
      else this.warnings.push(`${u.name}: host unit "${u.attach.hostName}" not found.`);
    }
    const rosterUnits: RosterUnit[] = this.units.map((u) => {
      const groups = u.groups.length ? u.groups : defaultGroups(u.ds);
      const out: RosterUnit = { id: u.id, datasheetId: u.ds.id, models: groups, isWarlord: u.warlord };
      if (u.customName) out.customName = u.customName;
      if (u.enhancementName) {
        const enh = this.findEnhancement(u.enhancementName);
        if (enh) out.enhancementId = enh.id;
        else this.warnings.push(`${u.name}: unknown enhancement "${u.enhancementName}".`);
      }
      return out;
    });
    this.units.forEach((u, i) => {
      if (!u.attachHost) return;
      const host = this.units.find((h) => h !== u && h.id === u.attachHost!.unitId);
      if (host) rosterUnits[i]!.attachedTo = { unitId: host.id, role: u.attachHost.role };
      else this.warnings.push(`${u.name}: host unit not found.`);
    });
    const roster: Roster = {
      id: `roster_${Math.random().toString(36).slice(2, 10)}`,
      ownerId: "local",
      createdAt: now,
      updatedAt: now,
      revision: 0,
      name: opts.name,
      gameSystemId: this.snapshot.gameSystemId,
      snapshotId: this.snapshot.id,
      factionId,
      battleSize: opts.battleSize,
      pointsLimit: opts.pointsLimit,
      detachments: this.detachments,
      units: rosterUnits,
    };
    return { roster, warnings: this.warnings };
  }
}

/** Minimum-size model groups for a datasheet (one group per profile; the last profile absorbs the remainder). */
export function defaultGroups(ds: Datasheet): RosterUnit["models"] {
  const mins = ds.composition.map((c) => c.min).filter((m): m is number => typeof m === "number" && m > 0);
  const total = mins.length ? mins.reduce((s, m) => s + m, 0) : 1;
  return profileGroups(ds, Math.max(1, total));
}

/**
 * Spreads `total` models over a datasheet's profiles the way a unit is actually built: one of each leading
 * profile (the sergeant, the gunner) and every remaining model on the last. Used when a list names the unit
 * size but not the profiles ("5x Warden Squad"), where the alternative — every model on `models[0]` — gives a
 * squad of five sergeants.
 */
export function profileGroups(ds: Datasheet, total: number): RosterUnit["models"] {
  const out: RosterUnit["models"] = [];
  let remaining = Math.max(1, total);
  for (let i = 0; i < ds.models.length - 1 && remaining > 1; i++) {
    out.push({ modelProfileId: ds.models[i]!.id, count: 1, wargear: [] });
    remaining -= 1;
  }
  out.push({ modelProfileId: ds.models[Math.min(out.length, ds.models.length - 1)]!.id, count: remaining, wargear: [] });
  return out;
}

/** A wargear entry as a list dialect writes it: how many models carry it and how many copies each carrier has. */
export interface WargearItem {
  name: string;
  /** Number of models carrying the item; 0 = every model in the group. */
  n: number;
  /** Copies per carrying model ("2x Twin hail gun" on a single-model unit); defaults to 1. */
  copies?: number;
}

/**
 * Splits a model group by the items only some of its models carry (an item with `n` below the model count):
 * items carried by every model go to all sub-groups, partial items peel off their own sub-group.
 */
export function splitByWargear(count: number, items: WargearItem[]): { count: number; wargear: string[] }[] {
  const subs: { count: number; wargear: string[] }[] = [{ count, wargear: [] }];
  const add = (w: string[], name: string) => {
    if (!w.includes(name)) w.push(name);
  };
  for (const it of items) if (it.n === 0 || it.n >= count) add(subs[0]!.wargear, it.name);
  for (const it of items) {
    if (it.n === 0 || it.n >= count) continue;
    let remaining = it.n;
    for (const sub of [...subs]) {
      if (remaining <= 0) break;
      if (sub.wargear.includes(it.name)) continue;
      if (sub.count <= remaining) {
        add(sub.wargear, it.name);
        remaining -= sub.count;
      } else {
        sub.count -= remaining;
        subs.push({ count: remaining, wargear: [...sub.wargear, it.name] });
        remaining = 0;
      }
    }
  }
  return subs;
}

/**
 * `splitByWargear` for the text dialects: repeated copies survive (the resolver counts occurrences, so
 * "2x Twin hail gun" must appear twice) and the peeled-off sub-groups come first, because lists write the odd
 * models — sergeant, special weapons — first and that ordering is what pairs them with the leading profiles.
 */
export function wargearGroups(count: number, items: WargearItem[]): { count: number; wargear: string[] }[] {
  const size = Math.max(1, count);
  // one bucket per (name, n): entries that repeat inside a bucket are extra copies, while separate `N with`
  // segments describe disjoint models, so their counts add — "1 with Carbine, 9 with Carbine" is all ten models
  const buckets = new Map<string, { name: string; n: number; copies: number }>();
  const order: string[] = [];
  for (const it of items) {
    const key = `${it.name}|${it.n}`;
    const b = buckets.get(key);
    if (b) b.copies += Math.max(1, it.copies ?? 1);
    else {
      buckets.set(key, { name: it.name, n: it.n, copies: Math.max(1, it.copies ?? 1) });
      order.push(key);
    }
  }
  const copies = new Map<string, number>();
  const unique: WargearItem[] = [];
  for (const key of order) {
    const b = buckets.get(key)!;
    copies.set(b.name, Math.max(copies.get(b.name) ?? 0, b.copies));
    const seen = unique.find((u) => u.name === b.name);
    if (!seen) unique.push({ name: b.name, n: b.n });
    else if (seen.n === 0 || b.n === 0 || seen.n + b.n >= size) seen.n = 0;
    else seen.n += b.n;
  }
  const subs = splitByWargear(size, unique);
  const ordered = subs.length > 1 ? [...subs.slice(1), subs[0]!] : subs;
  return ordered.map((s) => ({ count: s.count, wargear: s.wargear.flatMap((w) => Array.from({ length: copies.get(w) ?? 1 }, () => w)) }));
}

/**
 * Overlays a unit's two partitions of the same models — by profile and by wargear — onto one another, so that
 * "5x Warden Squad: 1 with Flux carbine, 4 with Shock maul" becomes a sergeant with the carbine and four
 * wardens with mauls rather than five identical models.
 */
export function zipModelGroups(profiles: RosterUnit["models"], subs: { count: number; wargear: string[] }[]): RosterUnit["models"] {
  const out: RosterUnit["models"] = [];
  let si = 0;
  let left = subs[0]?.count ?? 0;
  for (const p of profiles) {
    let take = p.count;
    while (take > 0 && si < subs.length) {
      const n = Math.min(take, left);
      if (n > 0) out.push({ modelProfileId: p.modelProfileId, count: n, wargear: [...subs[si]!.wargear] });
      take -= n;
      left -= n;
      if (left <= 0) {
        si += 1;
        left = subs[si]?.count ?? 0;
      }
    }
    if (take > 0) out.push({ modelProfileId: p.modelProfileId, count: take, wargear: [] });
  }
  return out;
}

/** Appends a model group, folding it into an existing group with the same profile and the same wargear. */
export function mergeGroup(out: RosterUnit["models"], g: RosterUnit["models"][number]): void {
  const sameGear = (a: string[], b: string[]) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
  const existing = out.find((o) => o.modelProfileId === g.modelProfileId && sameGear(o.wargear, g.wargear));
  if (existing) existing.count += g.count;
  else out.push(g);
}
