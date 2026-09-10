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
  private readonly factionByKey: Map<string, Faction>;
  private readonly dsByKey = new Map<string, Datasheet[]>();

  constructor(readonly snapshot: Snapshot) {
    this.factionByKey = new Map(snapshot.data.factions.map((f) => [normaliseName(f.name), f] as const));
    for (const d of snapshot.data.datasheets) {
      const k = normaliseName(d.name);
      this.dsByKey.set(k, [...(this.dsByKey.get(k) ?? []), d]);
    }
  }

  findFaction(label: string): Faction | undefined {
    return this.factionByKey.get(normaliseName(label));
  }

  /** Datasheet by name; when several factions share the name, the roster's faction wins. */
  findDatasheet(label: string): Datasheet | undefined {
    const cands = this.dsByKey.get(normaliseName(label)) ?? [];
    return cands.find((d) => d.factionId === this.factionId) ?? cands[0];
  }

  /** Detachment by name; prefers the roster's faction, falls back to any faction. */
  findDetachment(label: string): Detachment | undefined {
    const key = normaliseName(label);
    const dets = this.snapshot.data.detachments;
    return dets.find((d) => normaliseName(d.name) === key && (!this.factionId || d.factionId === this.factionId)) ?? dets.find((d) => normaliseName(d.name) === key);
  }

  /** Adds a detachment by name. Unknown names produce a warning and return undefined. */
  addDetachment(label: string, disposition?: string): RosterDetachment | undefined {
    const det = this.findDetachment(label);
    if (!det) {
      this.warnings.push(`Unknown detachment "${label}".`);
      return undefined;
    }
    if (!this.factionId) this.factionId = det.factionId;
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

  /** Model profile by name; a single-profile datasheet also answers to the datasheet name. */
  profileFor(ds: Datasheet, label: string): ModelProfile | undefined {
    const key = normaliseName(label);
    return ds.models.find((m) => normaliseName(m.name) === key) ?? (ds.models.length === 1 && normaliseName(ds.name) === key ? ds.models[0] : undefined);
  }

  /** Enhancement by name; prefers one that belongs to a detachment already in the roster. */
  findEnhancement(label: string): Enhancement | undefined {
    const key = normaliseName(label);
    const enhs = this.snapshot.data.enhancements;
    return enhs.find((e) => normaliseName(e.name) === key && this.detachments.some((d) => d.detachmentId === e.detachmentId)) ?? enhs.find((e) => normaliseName(e.name) === key);
  }

  /** Converts the pending units into a Roster: default model groups, enhancement ids and leader attachments. */
  build(opts: { name: string; battleSize: Roster["battleSize"]; pointsLimit: number }): { roster: Roster; warnings: string[] } {
    const now = new Date().toISOString();
    const factionId = this.factionId ?? this.snapshot.data.factions[0]?.id ?? "unknown";
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
      if (u.attachHost) {
        const host = this.units.find((h) => h !== u && h.id === u.attachHost!.unitId);
        if (host) rosterUnits[i]!.attachedTo = { unitId: host.id, role: u.attachHost.role };
        else this.warnings.push(`${u.name}: host unit not found.`);
        return;
      }
      if (!u.attach) return;
      const key = normaliseName(u.attach.hostName);
      const host = this.units.find((h) => h !== u && normaliseName(h.name) === key);
      if (host) rosterUnits[i]!.attachedTo = { unitId: host.id, role: u.attach.role };
      else this.warnings.push(`${u.name}: host unit "${u.attach.hostName}" not found.`);
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
  if (ds.models.length === 1) return [{ modelProfileId: ds.models[0]!.id, count: Math.max(1, total), wargear: [] }];
  let remaining = total;
  return ds.models.map((m, i) => {
    const last = i === ds.models.length - 1;
    const count = last ? Math.max(1, remaining) : 1;
    remaining -= count;
    return { modelProfileId: m.id, count, wargear: [] };
  });
}
