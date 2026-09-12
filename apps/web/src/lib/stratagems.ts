import type { Roster, Snapshot, Stratagem } from "@grimstat/schema";
import { unitDisplayName } from "./roster";

/**
 * Where a stratagem reaches the army from. A detachment stratagem comes with the detachment the
 * list took, a faction one is available to every list of that faction, and a core one is in the
 * rulebook and belongs to nobody.
 */
export type StratagemSource = "detachment" | "faction" | "core";

/** Fixed order the groups are shown in: the ones the list chose first, the rulebook last. */
export const STRATAGEM_SOURCES: readonly StratagemSource[] = ["detachment", "faction", "core"];

export interface RosterStratagem {
  stratagem: Stratagem;
  source: StratagemSource;
  /** Name of the detachment it came with, when it came with one. */
  detachmentName?: string;
  /** Units of this roster whose datasheet names this stratagem, in list order, without repeats. */
  units: string[];
}

/**
 * The stratagems this army can use: the ones its detachments bring, the ones its faction has, and
 * the core ones. This is the same reach the printable reference pack applies, with the source of
 * each one kept so the list can be grouped, and with the roster's own units resolved against
 * `datasheet.stratagemIds` so a stratagem can say which models it is for.
 *
 * A stratagem carrying a detachment this list did not take is left out even when its faction
 * matches, because it cannot be used.
 */
export function stratagemsForRoster(roster: Roster, snapshot: Snapshot): RosterStratagem[] {
  const detachments = new Map(roster.detachments.map((d) => [d.detachmentId, snapshot.data.detachments.find((x) => x.id === d.detachmentId)?.name] as const));
  const datasheets = new Map(snapshot.data.datasheets.map((d) => [d.id, d] as const));

  // stratagem id -> the units that name it, in list order. A datasheet used twice is named once.
  const byStratagem = new Map<string, string[]>();
  for (const unit of roster.units) {
    const ds = datasheets.get(unit.datasheetId);
    if (!ds) continue;
    const name = unitDisplayName(unit, ds);
    // Snapshots stored before datasheets carried this field are read back from the database
    // without it, so a missing list means "no links recorded" rather than a crash.
    for (const id of ds.stratagemIds ?? []) {
      const names = byStratagem.get(id);
      if (!names) byStratagem.set(id, [name]);
      else if (!names.includes(name)) names.push(name);
    }
  }

  const out: RosterStratagem[] = [];
  for (const s of snapshot.data.stratagems ?? []) {
    let source: StratagemSource;
    if (s.detachmentId) {
      if (!detachments.has(s.detachmentId)) continue;
      source = "detachment";
    } else if (s.factionId) {
      if (s.factionId !== roster.factionId) continue;
      source = "faction";
    } else {
      source = "core";
    }
    const detachmentName = s.detachmentId ? detachments.get(s.detachmentId) : undefined;
    out.push({ stratagem: s, source, ...(detachmentName ? { detachmentName } : {}), units: byStratagem.get(s.id) ?? [] });
  }
  return out;
}

/** Every phase named by these stratagems, lower-cased and de-duplicated, in first-seen order. */
export function stratagemPhases(list: readonly RosterStratagem[]): string[] {
  const out: string[] = [];
  for (const s of list) for (const p of s.stratagem.phases) {
    const phase = p.trim().toLowerCase();
    if (phase && !out.includes(phase)) out.push(phase);
  }
  return out;
}

export interface StratagemFilter {
  /** A phase from `stratagemPhases`, or undefined for every phase. */
  phase?: string | undefined;
  /** Free text matched against the name and the rule text. */
  query?: string | undefined;
  /** Only the ones a unit in this list names. */
  unitsOnly?: boolean;
}

/** The searchable text of a stratagem: its name and every part of its rule. */
function haystack(s: Stratagem): string {
  return [s.name, s.type, s.when, s.target, s.effect, s.restrictions, s.text].filter(Boolean).join(" ").toLowerCase();
}

export function filterStratagems(list: readonly RosterStratagem[], filter: StratagemFilter): RosterStratagem[] {
  const q = filter.query?.trim().toLowerCase() ?? "";
  const phase = filter.phase?.trim().toLowerCase();
  return list.filter((s) => {
    if (filter.unitsOnly && s.units.length === 0) return false;
    if (phase && !s.stratagem.phases.some((p) => p.trim().toLowerCase() === phase)) return false;
    return q === "" || haystack(s.stratagem).includes(q);
  });
}

export interface StratagemGroup {
  source: StratagemSource;
  /** Detachment groups carry the detachment's name; the others have none. */
  name?: string;
  items: RosterStratagem[];
}

/**
 * The list bucketed for display: one group per detachment (in the order the roster took them),
 * then faction, then core. Empty groups are dropped.
 */
export function groupStratagems(list: readonly RosterStratagem[]): StratagemGroup[] {
  const detachments: StratagemGroup[] = [];
  const faction: RosterStratagem[] = [];
  const core: RosterStratagem[] = [];
  for (const s of list) {
    if (s.source === "faction") faction.push(s);
    else if (s.source === "core") core.push(s);
    else {
      const key = s.detachmentName ?? s.stratagem.detachmentId ?? "";
      const group = detachments.find((g) => g.name === key);
      if (group) group.items.push(s);
      else detachments.push({ source: "detachment", name: key, items: [s] });
    }
  }
  const out = [...detachments];
  if (faction.length) out.push({ source: "faction", items: faction });
  if (core.length) out.push({ source: "core", items: core });
  return out;
}

/** The cheapest and dearest CP cost in a list, for the summary line. Undefined when it is empty. */
export function cpRange(list: readonly RosterStratagem[]): { min: number; max: number } | undefined {
  if (list.length === 0) return undefined;
  let min = Infinity;
  let max = -Infinity;
  for (const s of list) {
    min = Math.min(min, s.stratagem.cpCost);
    max = Math.max(max, s.stratagem.cpCost);
  }
  return { min, max };
}

export interface StratagemPart {
  key: "when" | "target" | "effect" | "restrictions";
  text: string;
}

/**
 * The decomposed rule, or an empty list when the source only gave one blob of text (which the UI
 * then prints as it stands).
 */
export function stratagemParts(s: Stratagem): StratagemPart[] {
  const out: StratagemPart[] = [];
  if (s.when) out.push({ key: "when", text: s.when });
  if (s.target) out.push({ key: "target", text: s.target });
  if (s.effect) out.push({ key: "effect", text: s.effect });
  if (s.restrictions) out.push({ key: "restrictions", text: s.restrictions });
  return out;
}
