import type { Datasheet, Roster, Snapshot } from "@grimstat/schema";
import { unitFromRosterUnit } from "@grimstat/game-40k-11e";
import { weaponAttacks } from "./arsenal";

/**
 * Roster-level reads that need the datasheet behind a unit rather than just its scenario form:
 * movement (which scenario units do not carry) and the core abilities that decide where a unit
 * can start the game.
 */

/** Average of a 2D6 charge, used for the melee half of a threat range. */
const CHARGE = 7;

export interface ThreatRow {
  unit: string;
  points: number | undefined;
  move: number | null;
  /** Longest ranged threat: move plus the longest weapon range. */
  shooting: number | null;
  /** Melee threat: move plus an average charge. */
  melee: number | null;
  /** Attacks available at that reach, for weighting the histogram. */
  attacks: number;
}

export interface ThreatBand {
  /** Inclusive upper bound in inches; Infinity for the last band. */
  upTo: number;
  label: string;
  units: number;
  points: number;
}

const BANDS: Array<{ upTo: number; label: string }> = [
  { upTo: 12, label: '≤12"' },
  { upTo: 18, label: '≤18"' },
  { upTo: 24, label: '≤24"' },
  { upTo: 36, label: '≤36"' },
  { upTo: 48, label: '≤48"' },
  { upTo: Number.POSITIVE_INFINITY, label: '48"+' },
];

function datasheetOf(snapshot: Snapshot, id: string): Datasheet | undefined {
  return snapshot.data.datasheets.find((d) => d.id === id);
}

/** How far each unit can threaten on the turn it moves, by shooting and by charging. */
export function threatProfile(roster: Roster, snapshot: Snapshot): { rows: ThreatRow[]; bands: ThreatBand[] } {
  const hosts = roster.units.filter((u) => !u.attachedTo);
  const rows: ThreatRow[] = hosts.map((u) => {
    const ds = datasheetOf(snapshot, u.datasheetId);
    const move = ds?.models.reduce<number | null>((m, p) => (typeof p.M === "number" ? (m === null ? p.M : Math.min(m, p.M)) : m), null) ?? null;
    let unit;
    try {
      unit = unitFromRosterUnit(u, roster, snapshot);
    } catch {
      unit = undefined;
    }
    const weapons = (unit?.weapons ?? []).filter((w) => w.enabled && w.count > 0);
    const longest = weapons.filter((w) => w.kind === "ranged").reduce<number | null>((m, w) => (typeof w.range === "number" ? Math.max(m ?? 0, w.range) : m), null);
    const hasMelee = weapons.some((w) => w.kind === "melee");
    return {
      unit: unit?.name ?? ds?.name ?? u.datasheetId,
      points: unit?.points,
      move,
      shooting: longest === null ? null : (move ?? 0) + longest,
      melee: hasMelee ? (move ?? 0) + CHARGE : null,
      attacks: weapons.reduce((s, w) => s + weaponAttacks(w), 0),
    };
  });
  const reach = (r: ThreatRow) => Math.max(r.shooting ?? 0, r.melee ?? 0);
  const bands = BANDS.map((b, i) => {
    const lower = i === 0 ? 0 : (BANDS[i - 1]!.upTo as number);
    const inBand = rows.filter((r) => reach(r) > lower && reach(r) <= b.upTo);
    return { upTo: b.upTo, label: b.label, units: inBand.length, points: inBand.reduce((s, r) => s + (r.points ?? 0), 0) };
  });
  return { rows: rows.sort((a, b) => reach(b) - reach(a)), bands };
}

/** Core abilities that decide where a unit may start, as the plugin tags them. */
const DEPLOYMENT = ["DEEP STRIKE", "SCOUTS", "INFILTRATORS"] as const;
export type DeploymentKind = (typeof DEPLOYMENT)[number] | "STANDARD";

export interface DeploymentRow {
  kind: DeploymentKind;
  units: number;
  points: number;
  models: number;
  names: string[];
}

/**
 * How much of the list can start somewhere other than the deployment zone. Read from the abilities
 * the engine already tags as core, so it reports nothing rather than guessing when data is thin.
 */
export function deploymentCensus(roster: Roster, snapshot: Snapshot): DeploymentRow[] {
  const abilities = new Map(snapshot.data.abilities.map((a) => [a.id, a] as const));
  const acc = new Map<DeploymentKind, DeploymentRow>();
  for (const u of roster.units) {
    if (u.attachedTo) continue;
    const ds = datasheetOf(snapshot, u.datasheetId);
    if (!ds) continue;
    let unit;
    try {
      unit = unitFromRosterUnit(u, roster, snapshot);
    } catch {
      unit = undefined;
    }
    const kinds = new Set<DeploymentKind>();
    for (const id of ds.abilityIds) {
      const core = abilities.get(id)?.coreKeyword?.toUpperCase();
      if (core && (DEPLOYMENT as readonly string[]).includes(core)) kinds.add(core as DeploymentKind);
    }
    if (!kinds.size) kinds.add("STANDARD");
    const models = u.models.reduce((s, g) => s + g.count, 0);
    for (const kind of kinds) {
      const cur = acc.get(kind) ?? { kind, units: 0, points: 0, models: 0, names: [] };
      cur.units += 1;
      cur.points += unit?.points ?? 0;
      cur.models += models;
      cur.names.push(unit?.name ?? ds.name);
      acc.set(kind, cur);
    }
  }
  const order: DeploymentKind[] = ["DEEP STRIKE", "SCOUTS", "INFILTRATORS", "STANDARD"];
  return order.flatMap((k) => (acc.has(k) ? [acc.get(k)!] : []));
}
