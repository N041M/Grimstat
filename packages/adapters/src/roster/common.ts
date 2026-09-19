import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { companionHostOf, createContext, isHalf, isOwnFaction, mergeModelGroups, type RosterContext } from "@grimstat/resolver";

export const SIZE_LABEL: Record<Roster["battleSize"], string> = {
  "combat-patrol": "Combat Patrol",
  incursion: "Incursion",
  "strike-force": "Strike Force",
  onslaught: "Onslaught",
  custom: "Custom",
};

export type Section = "CHARACTERS" | "BATTLELINE" | "DEDICATED TRANSPORTS" | "OTHER DATASHEETS" | "ALLIED UNITS";

export function sectionOf(ds: Datasheet | undefined, roster: Roster, snapshot: Snapshot): Section {
  if (!ds) return "OTHER DATASHEETS";
  if (!isOwnFaction(ds, roster, snapshot)) return "ALLIED UNITS";
  if (ds.isCharacter) return "CHARACTERS";
  if (ds.isBattleline) return "BATTLELINE";
  const role = (ds.role ?? "").toLowerCase();
  if (role.includes("transport") || ds.keywords.some((k) => k.toUpperCase() === "DEDICATED TRANSPORT")) return "DEDICATED TRANSPORTS";
  return "OTHER DATASHEETS";
}

export const SECTION_ORDER: Section[] = ["CHARACTERS", "BATTLELINE", "DEDICATED TRANSPORTS", "OTHER DATASHEETS", "ALLIED UNITS"];

export interface RosterView {
  ctx: RosterContext;
  roster: Roster;
  snapshot: Snapshot;
  factionName: string;
  total: number;
  detachments: Array<{ id: string; name: string; dp: number; forceDisposition?: string }>;
  sections: Array<{ section: Section; units: UnitView[] }>;
  byId: Map<string, UnitView>;
}

export interface UnitView {
  unit: RosterUnit;
  ds: Datasheet | undefined;
  name: string;
  points: number;
  modelCount: number;
  host?: UnitView;
  attached: UnitView[];
  /**
   * The entry this unit is written inside, when it has none of its own: Sir Hekhtur's is Canis
   * Rex's, and the second half of a split unit's is the first half's.
   */
  partOf?: UnitView;
  /** Units whose models come with this one. They are written inside its entry. */
  companions: UnitView[];
  enhancement?: { name: string; cost: number };
  groups: Array<{ profileName: string; count: number; wargear: string[] }>;
}

export function rosterView(roster: Roster, snapshot: Snapshot): RosterView {
  const ctx = createContext(roster, snapshot);
  const byId = new Map<string, UnitView>();
  for (const u of roster.units) {
    const ds = ctx.datasheet(u.datasheetId);
    const cost = ctx.unitCost(u);
    const enh = u.enhancementId ? ctx.enhancement(u.enhancementId) : undefined;
    const v: UnitView = {
      unit: u,
      ds,
      name: u.customName ?? ds?.name ?? u.datasheetId,
      points: cost.total,
      modelCount: cost.modelCount,
      attached: [],
      companions: [],
      groups: u.models.map((g) => ({ profileName: ds?.models.find((m) => m.id === g.modelProfileId)?.name ?? ds?.name ?? "Model", count: g.count, wargear: g.wargear })),
    };
    if (enh) v.enhancement = { name: enh.name, cost: enh.cost };
    byId.set(u.id, v);
  }
  for (const v of byId.values()) {
    const hostId = v.unit.attachedTo?.unitId;
    if (hostId && byId.has(hostId)) {
      v.host = byId.get(hostId)!;
      v.host.attached.push(v);
    }
  }
  // A model that comes with another unit is written inside that unit's entry, the way the official
  // app writes Sir Hekhtur under Canis Rex. Each such model takes the first host with room.
  for (const v of byId.values()) {
    const hostSheet = v.ds && companionHostOf(snapshot, v.ds);
    if (!hostSheet) continue;
    const host = [...byId.values()].find((h) => h.unit.datasheetId === hostSheet.id && !h.companions.some((c) => c.unit.datasheetId === v.unit.datasheetId));
    if (!host) continue;
    v.partOf = host;
    host.companions.push(v);
  }
  // A unit split in two for deployment is one entry in a list, the way it was bought. The second
  // half's models go back into the first half's groups here, and the half itself is written nowhere.
  for (const v of byId.values()) {
    if (!isHalf(v.unit)) continue;
    const head = byId.get(v.unit.halfOf!);
    if (!head || head === v) continue;
    v.partOf = head;
    const merged = mergeModelGroups([...head.unit.models, ...v.unit.models]);
    head.groups = merged.map((g) => ({ profileName: head.ds?.models.find((m) => m.id === g.modelProfileId)?.name ?? head.ds?.name ?? "Model", count: g.count, wargear: g.wargear }));
    head.modelCount = merged.reduce((s, g) => s + g.count, 0);
  }
  const sections = SECTION_ORDER.map((section) => ({ section, units: [...byId.values()].filter((v) => !v.partOf && sectionOf(v.ds, roster, snapshot) === section) })).filter((s) => s.units.length);
  const faction = snapshot.data.factions.find((f) => f.id === roster.factionId);
  return {
    ctx,
    roster,
    snapshot,
    factionName: faction?.name ?? roster.factionId,
    total: ctx.totalPoints(),
    detachments: roster.detachments.map((d) => {
      const det = ctx.detachment(d.detachmentId);
      const out: RosterView["detachments"][number] = { id: d.detachmentId, name: det?.name ?? d.detachmentId, dp: det?.dp ?? 0 };
      if (d.forceDisposition) out.forceDisposition = d.forceDisposition;
      return out;
    }),
    sections,
    byId,
  };
}
