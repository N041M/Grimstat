import { modelCountOf } from "@grimstat/resolver";
import type { ConstraintSet, RosterContext } from "@grimstat/resolver";
import type { BattleSize, Diagnostic, RosterUnit } from "@grimstat/schema";
import { hasKeywordPhrase, parseTransportCapacity, unitFitsKeywords } from "./transport";

/**
 * 11th-edition army construction rules. Battle-size figures for Incursion and Strike Force
 * come from the published rules; Onslaught values are extrapolated (marked) and easy to correct.
 */
export interface BattleSizeRules {
  points: number;
  detachmentPoints: number;
  enhancements: number;
  /** Max copies of one datasheet (doubled for Battleline). Epic Heroes are always 1. */
  duplicates: number;
  assumed?: boolean;
}

export const BATTLE_SIZES: Record<Exclude<BattleSize, "custom">, BattleSizeRules> = {
  "combat-patrol": { points: 500, detachmentPoints: 0, enhancements: 0, duplicates: 99 },
  incursion: { points: 1000, detachmentPoints: 2, enhancements: 2, duplicates: 2 },
  "strike-force": { points: 2000, detachmentPoints: 3, enhancements: 4, duplicates: 3 },
  onslaught: { points: 3000, detachmentPoints: 4, enhancements: 6, duplicates: 4, assumed: true },
};

/** Model-count bounds of a datasheet: per-line mins/maxs are summed ("1 Sergeant" + "4-9 Troopers" → 5..10). */
export function compositionBounds(ds: { composition: Array<{ min?: number | undefined; max?: number | undefined }> }): { min?: number; max?: number } {
  let min: number | undefined;
  let max: number | undefined;
  let maxKnown = true;
  for (const c of ds.composition) {
    if (typeof c.min === "number") min = (min ?? 0) + c.min;
    if (typeof c.max === "number") max = (max ?? 0) + c.max;
    else if (typeof c.min === "number") max = (max ?? 0) + c.min; // a fixed line ("1 Sergeant") contributes its min to the max
    else maxKnown = false;
  }
  const out: { min?: number; max?: number } = {};
  if (min !== undefined) out.min = min;
  if (max !== undefined && maxKnown && ds.composition.some((c) => typeof c.max === "number")) out.max = max;
  return out;
}

function sizeRules(ctx: RosterContext): BattleSizeRules {
  const bs = ctx.roster.battleSize;
  if (bs === "custom") return { points: ctx.roster.pointsLimit, detachmentPoints: 3, enhancements: 4, duplicates: 3, assumed: true };
  return BATTLE_SIZES[bs];
}

const unitName = (ctx: RosterContext, u: RosterUnit) => u.customName ?? ctx.datasheet(u.datasheetId)?.name ?? u.datasheetId;
const path = (ctx: RosterContext, u: RosterUnit) => `/units/${ctx.roster.units.indexOf(u)}`;
const unitById = (ctx: RosterContext) => new Map(ctx.roster.units.map((u) => [u.id, u] as const));
/** Datasheet keywords plus faction keywords, which is what transport prose refers to ("ADEPTUS ASTARTES INFANTRY"). */
const allKeywords = (ctx: RosterContext, u: RosterUnit): string[] => {
  const ds = ctx.datasheet(u.datasheetId);
  return ds ? [...ds.keywords, ...ds.factionKeywords] : [];
};
const transportCapacityOf = (ctx: RosterContext, u: RosterUnit) => parseTransportCapacity(ctx.datasheet(u.datasheetId)?.transportCapacity);

/**
 * Share of the points limit that may start the battle in Reserves. The 11th-edition figure has not
 * been verified against the published rules, so diagnostics label it "(assumed)".
 */
export const RESERVES_FRACTION = 0.25;
export const reservesLimit = (pointsLimit: number) => Math.floor(pointsLimit * RESERVES_FRACTION);

/**
 * A unit starts in Reserves when flagged itself, when embarked in a transport that does, or when
 * attached to a host that does (an attached character travels with its host).
 */
export function startsInReserves(ctx: RosterContext, unit: RosterUnit, byId = unitById(ctx)): boolean {
  const seen = new Set<string>();
  const visit = (u: RosterUnit): boolean => {
    if (seen.has(u.id)) return false;
    seen.add(u.id);
    if (u.inReserves) return true;
    const host = u.attachedTo ? byId.get(u.attachedTo.unitId) : undefined;
    if (host && visit(host)) return true;
    const transport = u.embarkedIn ? byId.get(u.embarkedIn) : undefined;
    return !!transport && visit(transport);
  };
  return visit(unit);
}

export const constraints11e: ConstraintSet = {
  id: "wh40k-11e",
  evaluators: [
    {
      code: "points.limit",
      run: (ctx) => {
        const total = ctx.totalPoints();
        const limit = ctx.roster.pointsLimit;
        return total > limit ? [{ severity: "error", code: "points.limit", message: `Army is ${total} points; limit is ${limit} (${total - limit} over).`, fix: "Remove or shrink a unit." }] : [{ severity: "info", code: "points.total", message: `${total} / ${limit} points.` }];
      },
    },
    {
      code: "points.unknown",
      run: (ctx) => ctx.roster.units.flatMap((u) => ctx.unitCost(u).notes.map((n) => ({ severity: "warn" as const, code: "points.unknown", message: `${unitName(ctx, u)}: ${n}`, path: path(ctx, u) }))),
    },
    {
      code: "detachments.dp",
      run: (ctx) => {
        const rules = sizeRules(ctx);
        const out: Diagnostic[] = [];
        if (!ctx.roster.detachments.length) out.push({ severity: "error", code: "detachments.none", message: "Army has no Detachment.", fix: "Add at least one Detachment." });
        const spent = ctx.roster.detachments.reduce((s, d) => s + (ctx.detachment(d.detachmentId)?.dp ?? 0), 0);
        if (spent > rules.detachmentPoints) out.push({ severity: "error", code: "detachments.dp", message: `Detachments cost ${spent} DP; ${ctx.roster.battleSize} allows ${rules.detachmentPoints}${rules.assumed ? " (assumed)" : ""}.` });
        else out.push({ severity: "info", code: "detachments.dp", message: `${spent} / ${rules.detachmentPoints} Detachment Points.` });
        const tags = new Map<string, string[]>();
        for (const d of ctx.roster.detachments) {
          const det = ctx.detachment(d.detachmentId);
          if (!det) {
            out.push({ severity: "error", code: "detachments.unknown", message: `Unknown detachment ${d.detachmentId}.` });
            continue;
          }
          if (det.uniqueTag) tags.set(det.uniqueTag, [...(tags.get(det.uniqueTag) ?? []), det.name]);
          if (det.factionId !== ctx.roster.factionId) out.push({ severity: "error", code: "detachments.faction", message: `${det.name} belongs to a different faction.` });
        }
        for (const [tag, names] of tags) if (names.length > 1) out.push({ severity: "error", code: "detachments.unique", message: `Detachments ${names.join(" and ")} share the unique tag "${tag}".`, fix: "Pick detachments with different unique tags." });
        const seen = new Set<string>();
        for (const d of ctx.roster.detachments) {
          if (seen.has(d.detachmentId)) out.push({ severity: "error", code: "detachments.duplicate", message: `Detachment ${ctx.detachment(d.detachmentId)?.name ?? d.detachmentId} is included twice.` });
          seen.add(d.detachmentId);
        }
        return out;
      },
    },
    {
      code: "units.duplicates",
      run: (ctx) => {
        const rules = sizeRules(ctx);
        const out: Diagnostic[] = [];
        const seen = new Set<string>();
        for (const u of ctx.roster.units) {
          if (seen.has(u.datasheetId)) continue;
          seen.add(u.datasheetId);
          const ds = ctx.datasheet(u.datasheetId);
          if (!ds) {
            out.push({ severity: "error", code: "units.unknown", message: `Unknown datasheet ${u.datasheetId}.`, path: path(ctx, u) });
            continue;
          }
          const n = ctx.copies(u.datasheetId).length;
          const cap = ds.isEpicHero ? 1 : ds.isBattleline ? rules.duplicates * 2 : rules.duplicates;
          if (n > cap) out.push({ severity: "error", code: "units.duplicates", message: `${ds.name} appears ${n} times; the limit is ${cap}${ds.isEpicHero ? " (Epic Hero)" : ds.isBattleline ? " (Battleline)" : ""}.`, path: path(ctx, u) });
          if (ds.factionId !== ctx.roster.factionId) out.push({ severity: "warn", code: "units.faction", message: `${ds.name} is from another faction (allies are not validated yet).`, path: path(ctx, u) });
          if (ds.isLegends) out.push({ severity: "warn", code: "units.legends", message: `${ds.name} is a Legends datasheet; check event rules.`, path: path(ctx, u) });
        }
        return out;
      },
    },
    {
      code: "units.size",
      run: (ctx) => {
        const out: Diagnostic[] = [];
        for (const u of ctx.roster.units) {
          const ds = ctx.datasheet(u.datasheetId);
          if (!ds) continue;
          const n = ctx.unitCost(u).modelCount;
          const { min, max } = compositionBounds(ds);
          if (min !== undefined && n < min) out.push({ severity: "error", code: "units.size", message: `${ds.name} has ${n} models; minimum is ${min}.`, path: path(ctx, u) });
          if (max !== undefined && n > max) out.push({ severity: "error", code: "units.size", message: `${ds.name} has ${n} models; maximum is ${max}.`, path: path(ctx, u) });
        }
        return out;
      },
    },
    {
      code: "characters.attach",
      run: (ctx) => {
        const out: Diagnostic[] = [];
        const leaders = new Map<string, RosterUnit[]>();
        const supports = new Map<string, RosterUnit[]>();
        for (const u of ctx.roster.units) {
          if (!u.attachedTo) continue;
          const ds = ctx.datasheet(u.datasheetId);
          const host = ctx.roster.units.find((h) => h.id === u.attachedTo!.unitId);
          if (!host) {
            out.push({ severity: "error", code: "characters.host", message: `${unitName(ctx, u)} is attached to a unit that is not in the army.`, path: path(ctx, u) });
            continue;
          }
          if (host.attachedTo) out.push({ severity: "error", code: "characters.chain", message: `${unitName(ctx, u)} is attached to ${unitName(ctx, host)}, which is itself attached to another unit.`, path: path(ctx, u) });
          const allowed = u.attachedTo.role === "leader" ? ds?.leaderTo ?? [] : ds?.supportTo ?? [];
          if (ds && !allowed.includes(host.datasheetId)) out.push({ severity: "error", code: "characters.legality", message: `${ds.name} cannot ${u.attachedTo.role === "leader" ? "lead" : "support"} ${unitName(ctx, host)}.`, path: path(ctx, u), fix: "Attach to a unit listed on the character's datasheet." });
          const map = u.attachedTo.role === "leader" ? leaders : supports;
          map.set(host.id, [...(map.get(host.id) ?? []), u]);
        }
        for (const [hostId, list] of leaders) if (list.length > 1) out.push({ severity: "error", code: "characters.leaders", message: `${unitName(ctx, ctx.roster.units.find((h) => h.id === hostId)!)} has ${list.length} Leaders; maximum is one.` });
        for (const [hostId, list] of supports) {
          const host = ctx.roster.units.find((h) => h.id === hostId)!;
          if (list.length > 1) out.push({ severity: "error", code: "characters.supports", message: `${unitName(ctx, host)} has ${list.length} Support characters; maximum is one.` });
          if (!leaders.has(hostId)) out.push({ severity: "error", code: "characters.support-needs-leader", message: `${unitName(ctx, host)} has a Support character but no Leader.`, fix: "Attach a Leader first." });
        }
        return out;
      },
    },
    {
      code: "enhancements",
      run: (ctx) => {
        const rules = sizeRules(ctx);
        const out: Diagnostic[] = [];
        const used = new Map<string, RosterUnit[]>();
        let count = 0;
        const detIds = new Set(ctx.roster.detachments.map((d) => d.detachmentId));
        for (const u of ctx.roster.units) {
          if (!u.enhancementId) continue;
          count++;
          const ds = ctx.datasheet(u.datasheetId);
          const e = ctx.enhancement(u.enhancementId);
          if (!e) {
            out.push({ severity: "error", code: "enhancements.unknown", message: `${unitName(ctx, u)} has an unknown enhancement.`, path: path(ctx, u) });
            continue;
          }
          used.set(e.id, [...(used.get(e.id) ?? []), u]);
          if (ds && !ds.isCharacter) out.push({ severity: "error", code: "enhancements.character", message: `${ds.name} is not a CHARACTER and cannot take ${e.name}.`, path: path(ctx, u) });
          if (ds?.isEpicHero) out.push({ severity: "error", code: "enhancements.epic", message: `${ds.name} is an Epic Hero and cannot take enhancements.`, path: path(ctx, u) });
          if (!detIds.has(e.detachmentId)) out.push({ severity: "error", code: "enhancements.detachment", message: `${e.name} belongs to a detachment that is not in this army.`, path: path(ctx, u) });
          if (e.supportOnly && u.attachedTo?.role !== "support") out.push({ severity: "error", code: "enhancements.support", message: `${e.name} can only be taken by a Support character.`, path: path(ctx, u) });
        }
        for (const [id, list] of used) if (list.length > 1) out.push({ severity: "error", code: "enhancements.unique", message: `${ctx.enhancement(id)?.name ?? id} is taken ${list.length} times; each enhancement is unique.` });
        if (count > rules.enhancements) out.push({ severity: "error", code: "enhancements.count", message: `${count} enhancements; ${ctx.roster.battleSize} allows ${rules.enhancements}${rules.assumed ? " (assumed)" : ""}.` });
        return out;
      },
    },
    {
      code: "warlord",
      run: (ctx) => {
        const n = ctx.roster.units.filter((u) => u.isWarlord).length;
        if (n === 0) return [{ severity: "warn", code: "warlord.none", message: "No Warlord selected.", fix: "Mark one CHARACTER as Warlord." }];
        if (n > 1) return [{ severity: "error", code: "warlord.many", message: `${n} Warlords selected; choose one.` }];
        const w = ctx.roster.units.find((u) => u.isWarlord)!;
        const ds = ctx.datasheet(w.datasheetId);
        return ds && !ds.isCharacter ? [{ severity: "error", code: "warlord.character", message: `${ds.name} is not a CHARACTER and cannot be the Warlord.` }] : [];
      },
    },
    {
      code: "transport.capacity",
      run: (ctx) => {
        const out: Diagnostic[] = [];
        const byId = unitById(ctx);
        // Embarked units grouped by transport, after the per-unit sanity checks.
        const loads = new Map<string, RosterUnit[]>();
        for (const u of ctx.roster.units) {
          if (!u.embarkedIn) continue;
          const t = byId.get(u.embarkedIn);
          if (!t) {
            out.push({ severity: "error", code: "transport.missing", message: `${unitName(ctx, u)} is embarked in a unit that is not in the army.`, path: path(ctx, u), fix: "Disembark the unit or pick a transport from the army." });
            continue;
          }
          if (u.attachedTo) {
            const host = byId.get(u.attachedTo.unitId);
            out.push({ severity: "warn", code: "transport.attached", message: `${unitName(ctx, u)} is attached to ${host ? unitName(ctx, host) : "another unit"} and travels with it; its own embarkation is ignored.`, path: path(ctx, u), fix: "Embark the host unit instead." });
            continue;
          }
          if (transportCapacityOf(ctx, u)) {
            out.push({ severity: "warn", code: "transport.nested", message: `${unitName(ctx, u)} is itself a transport and cannot embark in ${unitName(ctx, t)}; ignored.`, path: path(ctx, u) });
            continue;
          }
          if (!transportCapacityOf(ctx, t)) {
            out.push({ severity: "error", code: "transport.none", message: `${unitName(ctx, u)} is embarked in ${unitName(ctx, t)}, which is not a transport.`, path: path(ctx, u), fix: "Disembark the unit." });
            continue;
          }
          loads.set(t.id, [...(loads.get(t.id) ?? []), u]);
        }
        for (const [transportId, hosts] of loads) {
          const t = byId.get(transportId)!;
          const cap = transportCapacityOf(ctx, t)!;
          const tName = unitName(ctx, t);
          let occupancy = 0;
          for (const host of hosts) {
            // An attached character travels with its host and takes up space too.
            const party = [host, ...ctx.roster.units.filter((c) => c.attachedTo?.unitId === host.id)];
            for (const p of party) {
              const keywords = allKeywords(ctx, p);
              const pName = unitName(ctx, p);
              if (ctx.datasheet(p.datasheetId)) {
                if (!unitFitsKeywords(keywords, cap)) out.push({ severity: "error", code: "transport.keywords", message: `${tName} cannot transport ${pName} (only ${cap.keywords.join(" or ")} models).`, path: path(ctx, p), fix: "Disembark the unit." });
                const banned = cap.excluded.find((k) => hasKeywordPhrase(keywords, k));
                if (banned) out.push({ severity: "error", code: "transport.excluded", message: `${tName} cannot transport ${pName} (${banned} models).`, path: path(ctx, p), fix: "Disembark the unit." });
              }
              const size = cap.sizes.find((s) => hasKeywordPhrase(keywords, s.keyword));
              occupancy += modelCountOf(p) * (size?.takes ?? 1);
            }
          }
          if (occupancy > cap.capacity) out.push({ severity: "error", code: "transport.capacity", message: `${tName} carries ${occupancy} models; its transport capacity is ${cap.capacity}.`, path: path(ctx, t), fix: "Disembark a unit." });
          else out.push({ severity: "info", code: "transport.capacity", message: `${tName} carries ${occupancy} / ${cap.capacity}.`, path: path(ctx, t) });
        }
        return out;
      },
    },
    {
      code: "reserves.limit",
      run: (ctx) => {
        const byId = unitById(ctx);
        const points = ctx.roster.units.filter((u) => startsInReserves(ctx, u, byId)).reduce((s, u) => s + ctx.unitCost(u).total, 0);
        const limit = reservesLimit(ctx.roster.pointsLimit);
        if (points > limit) return [{ severity: "error", code: "reserves.limit", message: `${points} points start in Reserves; the limit is ${limit} (assumed).`, fix: "Deploy a unit on the battlefield instead." }];
        return points > 0 ? [{ severity: "info", code: "reserves.limit", message: `${points} / ${limit} points in Reserves (assumed).` }] : [];
      },
    },
  ],
};
