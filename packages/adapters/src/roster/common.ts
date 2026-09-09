import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { createContext, type RosterContext } from "@grimstat/resolver";

export const SIZE_LABEL: Record<Roster["battleSize"], string> = {
  "combat-patrol": "Combat Patrol",
  incursion: "Incursion",
  "strike-force": "Strike Force",
  onslaught: "Onslaught",
  custom: "Custom",
};

export type Section = "CHARACTERS" | "BATTLELINE" | "DEDICATED TRANSPORTS" | "OTHER DATASHEETS" | "ALLIED UNITS";

export function sectionOf(ds: Datasheet | undefined, roster: Roster): Section {
  if (!ds) return "OTHER DATASHEETS";
  if (ds.factionId !== roster.factionId) return "ALLIED UNITS";
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
  const sections = SECTION_ORDER.map((section) => ({ section, units: [...byId.values()].filter((v) => sectionOf(v.ds, roster) === section) })).filter((s) => s.units.length);
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
