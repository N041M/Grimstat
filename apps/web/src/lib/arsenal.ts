import type { ScenarioUnit, ScenarioWeapon } from "@grimstat/schema";
import { diceMean } from "@grimstat/engine";
import { woundTarget } from "@grimstat/game-40k-11e";

/**
 * What an army can put out, read straight off its weapon profiles.
 *
 * These are counts and averages rather than a simulation. Attacks come from the printed Attacks
 * characteristic (dice expressions averaged), so conditional bonuses that depend on the board —
 * Rapid Fire at half range, Blast against a big unit, Sustained Hits on a critical — are not
 * included. `conditional` reports how many attacks carry such a keyword so the gap is visible
 * rather than silent.
 */

export type Phase = "shooting" | "melee";

export interface Bucket {
  /** The characteristic value this bucket counts (Strength, AP magnitude, or Damage as a label). */
  key: string;
  /** Sort order within the axis. */
  order: number;
  attacks: number;
}

export interface KeywordCount {
  name: string;
  attacks: number;
  /** Weapons carrying it, for the tooltip. */
  weapons: string[];
}

export interface PhaseArsenal {
  phase: Phase;
  /** Expected attacks per round from every enabled weapon of that kind. */
  attacks: number;
  /** Weapon profiles contributing (counting a squad's ten rifles as ten). */
  weapons: number;
  /** Attacks split by Strength, ascending. */
  byStrength: Bucket[];
  /** Attacks split by AP magnitude (0, 1, 2 …), ascending. */
  byAp: Bucket[];
  /** Attacks split by the Damage characteristic as printed ("1", "D3", "D6+1"), by average value. */
  byDamage: Bucket[];
  /** Attacks whose outcome depends on something this page cannot know. */
  conditional: KeywordCount[];
  /** Average Strength and AP over attacks, and the mean damage of one unsaved wound. */
  meanStrength: number;
  meanAp: number;
  meanDamage: number;
}

export interface RangeBucket {
  /** Inclusive upper bound in inches; Infinity for anything longer. */
  upTo: number;
  label: string;
  attacks: number;
}

export interface ArsenalSummary {
  shooting: PhaseArsenal;
  melee: PhaseArsenal;
  /** Models in the army, for the per-model averages. */
  models: number;
  points: number | undefined;
  /** Shooting attacks available at each range band, cumulative from the shortest. */
  ranges: RangeBucket[];
}

const RANGE_BANDS: Array<{ upTo: number; label: string }> = [
  { upTo: 12, label: '12"' },
  { upTo: 24, label: '24"' },
  { upTo: 36, label: '36"' },
  { upTo: 48, label: '48"' },
  { upTo: Number.POSITIVE_INFINITY, label: '48"+' },
];

/** Keywords whose effect depends on range, target size or a roll, so a printed profile understates them. */
const CONDITIONAL = new Set(["RAPID FIRE", "BLAST", "CLEAVE", "SUSTAINED HITS", "LETHAL HITS", "DEVASTATING WOUNDS", "ANTI", "MELTA", "LANCE", "HEAVY", "TORRENT", "TWIN-LINKED", "PRECISION", "HAZARDOUS", "INDIRECT FIRE", "IGNORES COVER", "PSYCHIC", "CONVERSION"]);

export function weaponAttacks(w: ScenarioWeapon): number {
  return Math.max(0, w.count) * Math.max(0, diceMean(w.A));
}

function add(map: Map<string, Bucket>, key: string, order: number, attacks: number): void {
  const cur = map.get(key);
  if (cur) cur.attacks += attacks;
  else map.set(key, { key, order, attacks });
}

function sorted(map: Map<string, Bucket>): Bucket[] {
  return [...map.values()].sort((a, b) => a.order - b.order);
}

function phaseArsenal(weapons: ScenarioWeapon[], phase: Phase): PhaseArsenal {
  const kind = phase === "melee" ? "melee" : "ranged";
  const list = weapons.filter((w) => w.enabled && w.kind === kind && w.count > 0);
  const byStrength = new Map<string, Bucket>();
  const byAp = new Map<string, Bucket>();
  const byDamage = new Map<string, Bucket>();
  const keywords = new Map<string, KeywordCount>();
  let attacks = 0;
  let sWeighted = 0;
  let apWeighted = 0;
  let dWeighted = 0;
  for (const w of list) {
    const n = weaponAttacks(w);
    if (n <= 0) continue;
    attacks += n;
    sWeighted += n * w.S;
    apWeighted += n * w.AP;
    const dMean = diceMean(w.D);
    dWeighted += n * dMean;
    add(byStrength, `S${w.S}`, w.S, n);
    add(byAp, w.AP === 0 ? "AP0" : `AP-${w.AP}`, w.AP, n);
    add(byDamage, `D${String(w.D).trim()}`.replace(/^DD/i, "D"), dMean, n);
    for (const k of w.keywords) {
      const name = k.name.toUpperCase();
      if (!CONDITIONAL.has(name)) continue;
      const label = k.keyword ? `${name}-${k.keyword}` : name;
      const cur = keywords.get(label);
      if (cur) {
        cur.attacks += n;
        if (!cur.weapons.includes(w.name)) cur.weapons.push(w.name);
      } else keywords.set(label, { name: label, attacks: n, weapons: [w.name] });
    }
  }
  return {
    phase,
    attacks,
    weapons: list.reduce((s, w) => s + w.count, 0),
    byStrength: sorted(byStrength),
    byAp: sorted(byAp),
    byDamage: sorted(byDamage),
    conditional: [...keywords.values()].sort((a, b) => b.attacks - a.attacks || a.name.localeCompare(b.name)),
    meanStrength: attacks ? sWeighted / attacks : 0,
    meanAp: attacks ? apWeighted / attacks : 0,
    meanDamage: attacks ? dWeighted / attacks : 0,
  };
}

/** Shooting attacks that can reach each band, counted cumulatively from the shortest range. */
function rangeBands(weapons: ScenarioWeapon[]): RangeBucket[] {
  const ranged = weapons.filter((w) => w.enabled && w.kind === "ranged" && w.count > 0);
  return RANGE_BANDS.map((b) => ({
    upTo: b.upTo,
    label: b.label,
    attacks: ranged.filter((w) => (w.range ?? 0) >= (b.upTo === Number.POSITIVE_INFINITY ? 49 : b.upTo)).reduce((s, w) => s + weaponAttacks(w), 0),
  }));
}

export function arsenalFor(units: ScenarioUnit[]): ArsenalSummary {
  const weapons = units.flatMap((u) => u.weapons);
  const models = units.reduce((s, u) => s + u.models.reduce((m, g) => m + g.count, 0), 0);
  const pts = units.reduce((s, u) => s + (u.points ?? 0), 0);
  return {
    shooting: phaseArsenal(weapons, "shooting"),
    melee: phaseArsenal(weapons, "melee"),
    models,
    points: units.some((u) => u.points !== undefined) ? pts : undefined,
    ranges: rangeBands(weapons),
  };
}

/** Per-model averages: attacks and raw damage output if every attack were an unsaved wound. */
export function perModel(a: ArsenalSummary): { shootingAttacks: number; meleeAttacks: number; shootingDamage: number; meleeDamage: number } {
  const n = a.models || 1;
  return {
    shootingAttacks: a.shooting.attacks / n,
    meleeAttacks: a.melee.attacks / n,
    shootingDamage: (a.shooting.attacks * a.shooting.meanDamage) / n,
    meleeDamage: (a.melee.attacks * a.melee.meanDamage) / n,
  };
}


/* ---------- What the army can hurt, and what it forces the defender to do ---------- */

export interface WoundRow {
  toughness: number;
  /** Attacks by the roll they need to wound: 2, 3, 4, 5, 6. Nothing wounds worse than a 6. */
  byRoll: Record<2 | 3 | 4 | 5 | 6, number>;
  /** Attacks that wound on 4+ or better, the usual shorthand for "hurts this". */
  comfortable: number;
  attacks: number;
}

/**
 * For each Toughness a player meets, how many of the army's attacks wound on what. This is the
 * strength census in the form the game actually uses, rather than leaving the S-versus-T comparison
 * to the reader.
 */
export function woundTable(units: ScenarioUnit[], phase: Phase | "both" = "both", toughness: number[] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]): WoundRow[] {
  const kinds = phase === "both" ? ["ranged", "melee"] : [phase === "melee" ? "melee" : "ranged"];
  const weapons = units.flatMap((u) => u.weapons).filter((w) => w.enabled && w.count > 0 && kinds.includes(w.kind));
  return toughness.map((t) => {
    const byRoll: WoundRow["byRoll"] = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    let attacks = 0;
    for (const w of weapons) {
      const n = weaponAttacks(w);
      if (n <= 0) continue;
      attacks += n;
      const roll = Math.min(6, Math.max(2, woundTarget(w.S, t))) as 2 | 3 | 4 | 5 | 6;
      byRoll[roll] += n;
    }
    return { toughness: t, byRoll, comfortable: byRoll[2] + byRoll[3] + byRoll[4], attacks };
  });
}

export interface SkillRow {
  /** Target number, or null for attacks that hit automatically. */
  skill: number | null;
  attacks: number;
}

/** Attacks by the roll they need to hit, so a hit penalty's reach across the list is visible. */
export function bySkill(units: ScenarioUnit[], phase: Phase | "both" = "both"): SkillRow[] {
  const kinds = phase === "both" ? ["ranged", "melee"] : [phase === "melee" ? "melee" : "ranged"];
  const map = new Map<number | null, number>();
  for (const w of units.flatMap((u) => u.weapons)) {
    if (!w.enabled || w.count <= 0 || !kinds.includes(w.kind)) continue;
    const auto = w.skill === null || w.keywords.some((k) => k.name.toUpperCase() === "TORRENT");
    const key = auto ? null : w.skill;
    map.set(key, (map.get(key) ?? 0) + weaponAttacks(w));
  }
  return [...map.entries()]
    .map(([skill, attacks]) => ({ skill, attacks }))
    .sort((a, b) => (a.skill === null ? -1 : b.skill === null ? 1 : a.skill - b.skill));
}

export interface SaveRow {
  /** The armour save the defender starts with. */
  save: number;
  /** Attacks by the save left after AP: 2..6, and 7 meaning no armour save at all. */
  byModified: Record<number, number>;
  /** Attacks that leave no armour save. */
  noSave: number;
  attacks: number;
}

/** After AP, what save each attack leaves against the common armour values. */
export function saveForced(units: ScenarioUnit[], phase: Phase | "both" = "both", saves: number[] = [2, 3, 4, 5, 6]): SaveRow[] {
  const kinds = phase === "both" ? ["ranged", "melee"] : [phase === "melee" ? "melee" : "ranged"];
  const weapons = units.flatMap((u) => u.weapons).filter((w) => w.enabled && w.count > 0 && kinds.includes(w.kind));
  return saves.map((save) => {
    const byModified: Record<number, number> = {};
    let attacks = 0;
    let noSave = 0;
    for (const w of weapons) {
      const n = weaponAttacks(w);
      if (n <= 0) continue;
      attacks += n;
      const modified = Math.min(7, save + w.AP);
      byModified[modified] = (byModified[modified] ?? 0) + n;
      if (modified >= 7) noSave += n;
    }
    return { save, byModified, noSave, attacks };
  });
}

export interface DamageTier {
  key: "1" | "2" | "3+" | "dice";
  label: string;
  attacks: number;
  /** Mean damage of one unsaved wound in this tier. */
  meanDamage: number;
}

/**
 * Attacks grouped coarsely by damage. Chunky damage is wasted on one-wound models, so this is the
 * quickest read on where a list will overkill.
 */
export function damageTiers(units: ScenarioUnit[], phase: Phase | "both" = "both"): DamageTier[] {
  const kinds = phase === "both" ? ["ranged", "melee"] : [phase === "melee" ? "melee" : "ranged"];
  const order: DamageTier["key"][] = ["1", "2", "3+", "dice"];
  const acc = new Map<DamageTier["key"], { attacks: number; weighted: number }>();
  for (const w of units.flatMap((u) => u.weapons)) {
    if (!w.enabled || w.count <= 0 || !kinds.includes(w.kind)) continue;
    const n = weaponAttacks(w);
    if (n <= 0) continue;
    const printed = String(w.D).trim();
    const mean = diceMean(w.D);
    const key: DamageTier["key"] = /[dD]/.test(printed) ? "dice" : mean <= 1 ? "1" : mean === 2 ? "2" : "3+";
    const cur = acc.get(key) ?? { attacks: 0, weighted: 0 };
    cur.attacks += n;
    cur.weighted += n * mean;
    acc.set(key, cur);
  }
  const label: Record<DamageTier["key"], string> = { "1": "1", "2": "2", "3+": "3+", dice: "random" };
  return order.flatMap((key) => {
    const v = acc.get(key);
    return v ? [{ key, label: label[key], attacks: v.attacks, meanDamage: v.attacks ? v.weighted / v.attacks : 0 }] : [];
  });
}

export interface DefenceRow {
  toughness: number;
  save: number;
  invuln: number | null;
  models: number;
  wounds: number;
  /** Units contributing, for the tooltip. */
  units: string[];
}

/** The arsenal's mirror: what the army is made of, so you can see whether it is one brittle block. */
export function defensiveProfile(units: ScenarioUnit[]): DefenceRow[] {
  const map = new Map<string, DefenceRow>();
  for (const u of units) {
    for (const m of u.models) {
      if (m.count <= 0) continue;
      const key = `${m.T}|${m.Sv}|${m.InvSv ?? "-"}`;
      const cur = map.get(key);
      if (cur) {
        cur.models += m.count;
        cur.wounds += m.count * m.W;
        if (!cur.units.includes(u.name)) cur.units.push(u.name);
      } else map.set(key, { toughness: m.T, save: m.Sv, invuln: m.InvSv ?? null, models: m.count, wounds: m.count * m.W, units: [u.name] });
    }
  }
  return [...map.values()].sort((a, b) => b.wounds - a.wounds || a.toughness - b.toughness);
}
