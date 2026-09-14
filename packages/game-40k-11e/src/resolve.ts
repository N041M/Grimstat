import type { Ability, Archetype, AttachedCharacter, CoverageReport, Datasheet, EffectRecord, ManualToggle, PriceRule, PriceTier, Roster, RosterUnit, Scenario, ScenarioModel, ScenarioUnit, ScenarioWeapon, Snapshot, WeaponProfile } from "@grimstat/schema";
import { createContext } from "@grimstat/resolver";
import { abilityEffects, applyFnpToModels } from "./patterns";
import { CH } from "./channels";
import type { UnitFromDatasheetOptions } from "./api";

import { keywordRegistry as registry } from "./scenario";
import { omittedDefaults } from "./loadout";

export function upper(s: string): string {
  return s.trim().toUpperCase();
}

function abilitiesOf(ds: Datasheet, snapshot: Snapshot): Ability[] {
  const byId = new Map(snapshot.data.abilities.map((a) => [a.id, a] as const));
  return ds.abilityIds.map((id) => byId.get(id)).filter((a): a is Ability => !!a);
}

/**
 * The first-copy price rule of each datasheet the snapshot prices.
 *
 * Pricing one sheet used to walk every rule in the snapshot. A screen that prices a whole faction
 * — the codex list, the compare grid, the add-unit panel — did that once per sheet, so a full
 * snapshot cost about three million comparisons to draw one page. The answer depends only on the
 * snapshot, so it is built once and kept on it, the way the adapters keep their name indexes.
 */
const FIRST_COPY_RULES = new WeakMap<Snapshot, ReadonlyMap<string, PriceRule>>();
function firstCopyRules(snapshot: Snapshot): ReadonlyMap<string, PriceRule> {
  const cached = FIRST_COPY_RULES.get(snapshot);
  if (cached) return cached;
  const map = new Map<string, PriceRule>();
  // First rule wins, as `find` on the unindexed list did, so a sheet with several matching rules
  // is priced from the same one as before.
  for (const r of snapshot.data.priceRules) {
    if (r.copyRange.min > 1 || (r.copyRange.max !== undefined && r.copyRange.max < 1)) continue;
    if (!map.has(r.datasheetId)) map.set(r.datasheetId, r);
  }
  FIRST_COPY_RULES.set(snapshot, map);
  return map;
}

export function pointsFor(ds: Datasheet, snapshot: Snapshot, modelCount: number): number | undefined {
  const rule = firstCopyRules(snapshot).get(ds.id);
  if (!rule) return ds.fallbackPoints;
  // The largest tier the unit is big enough for. Tiers arrive in whatever order the source listed
  // them, so the search has to start empty; seeding it with the first tier lets a large tier listed
  // ahead of a small one stand even when the unit is well below it. A unit smaller than every tier
  // falls back on the smallest, which is what the resolver does with the same data.
  let best: PriceTier | undefined;
  for (const t of rule.tiers) if (t.models <= modelCount && (!best || t.models > best.models)) best = t;
  if (!best) for (const t of rule.tiers) if (!best || t.models < best.models) best = t;
  return best?.points ?? ds.fallbackPoints;
}

function defaultModelCount(ds: Datasheet): number {
  const mins = ds.composition.map((c) => c.min).filter((m): m is number => typeof m === "number" && m > 0);
  if (mins.length) return mins.reduce((s, m) => s + m, 0);
  return ds.models.length > 1 ? ds.models.length : 1;
}

function weaponToScenario(w: WeaponProfile, count: number, enabled: boolean): ScenarioWeapon {
  return {
    name: w.name,
    count,
    kind: w.kind,
    range: w.range ?? null,
    A: w.A,
    skill: w.skill,
    S: w.S,
    AP: w.AP,
    D: w.D,
    keywords: w.keywords,
    enabled,
  };
}

/** "Plasma pistol – standard" -> "Plasma pistol"; "Bolt rifle" -> "Bolt rifle". */
export function baseWeaponName(name: string): string {
  return name.split(/\s+[–—-]\s+/)[0]!.trim();
}

export interface ParsedLoadout {
  /** Weapon base names (lower-case) every model carries. */
  all: string[];
  /** Weapon base names carried only by a named model profile (key: lower-case profile name). */
  byProfile: Record<string, string[]>;
}

const strip = (s: string) => s.replace(/^(?:an?|one|\d+x?|the)\s+/i, "").trim();

/**
 * Parse default-loadout prose such as
 *   "Every model is equipped with: flux carbine; shock maul.\nThe Warden Sergeant is also equipped with a power fist."
 * into weapons for every model and weapons for a specific profile. Option/replacement text is ignored.
 */
export function parseLoadout(ds: Datasheet): ParsedLoadout {
  const out: ParsedLoadout = { all: [], byProfile: {} };
  const text = ds.loadout ?? "";
  if (!text) return out;
  const bases = [...new Set(ds.weapons.map((w) => baseWeaponName(w.name).toLowerCase()).filter(Boolean))];
  const matchItems = (itemsText: string): string[] => {
    const items = itemsText.split(/[;,]|\band\b/).map((i) => strip(i.replace(/\.$/, "")).toLowerCase()).filter(Boolean);
    const found: string[] = [];
    for (const item of items) for (const b of bases) if ((item.includes(b) || b.includes(item)) && !found.includes(b)) found.push(b);
    return found;
  };
  const profiles = ds.models.map((m) => m.name.toLowerCase());
  for (const raw of text.split(/(?<=\.)\s+|\n+/)) {
    const sentence = raw.trim();
    const m = /^(.*?)(?:\b(?:is|are)\s+)?(?:also\s+)?\bequipped\s+with\s*:?\s*(.+)$/i.exec(sentence);
    if (!m) continue;
    const subject = (m[1] ?? "").toLowerCase().replace(/^(?:the|each|every|all|this)\s+/, "").trim();
    const items = matchItems(m[2] ?? "");
    if (!items.length) continue;
    if (/^(model|models|this model)$/.test(subject) || subject === "") {
      for (const i of items) if (!out.all.includes(i)) out.all.push(i);
      continue;
    }
    const profile = profiles.find((p) => p === subject || p.includes(subject) || subject.includes(p));
    if (profile) out.byProfile[profile] = [...new Set([...(out.byProfile[profile] ?? []), ...items])];
    else for (const i of items) if (!out.all.includes(i)) out.all.push(i);
  }
  // no recognisable clause: fall back to a plain substring match over the whole text
  if (!out.all.length && !Object.keys(out.byProfile).length) {
    const lower = text.toLowerCase();
    for (const b of bases) if (lower.includes(b)) out.all.push(b);
  }
  return out;
}

/** Weapon base names mentioned in the datasheet's default loadout (lower-case), across all profiles. */
function defaultWeaponNames(ds: Datasheet): Set<string> {
  const p = parseLoadout(ds);
  return new Set([...p.all, ...Object.values(p.byProfile).flat()]);
}

/** How many models of the unit carry a weapon by default: every model, or just the named profile's models. */
function defaultWeaponCount(ds: Datasheet, base: string, modelCount: number, groups: ScenarioModel[]): number {
  const p = parseLoadout(ds);
  if (p.all.includes(base)) return modelCount;
  let n = 0;
  for (const [profile, items] of Object.entries(p.byProfile)) {
    if (!items.includes(base)) continue;
    const g = groups.find((m) => m.name.toLowerCase() === profile);
    n += g ? g.count : 1;
  }
  return n || modelCount;
}

function modelsFromDatasheet(ds: Datasheet, modelCount: number, isCharacter: boolean): ScenarioModel[] {
  const profiles = ds.models;
  const out: ScenarioModel[] = [];
  if (isCharacter || profiles.length === 1) {
    for (const p of profiles) {
      out.push({ name: p.name, count: isCharacter ? 1 : modelCount, T: p.T, Sv: p.Sv, InvSv: p.InvSv ?? null, W: p.W, fnp: null, isCharacter, keywords: [] });
    }
    return out;
  }
  // multiple profiles (e.g. a sergeant + troopers): one of each leading profile, remainder on the last
  let remaining = modelCount;
  profiles.forEach((p, i) => {
    const isLast = i === profiles.length - 1;
    const count = isLast ? Math.max(1, remaining) : 1;
    remaining -= count;
    out.push({ name: p.name, count, T: p.T, Sv: p.Sv, InvSv: p.InvSv ?? null, W: p.W, fnp: null, isCharacter: false, keywords: [] });
  });
  return out;
}

export function unitFromDatasheet(ds: Datasheet, snapshot: Snapshot, opts: UnitFromDatasheetOptions = {}): ScenarioUnit {
  const modelCount = Math.max(1, opts.modelCount ?? defaultModelCount(ds));
  const isCharacterSheet = ds.isCharacter && ds.models.length === 1 && !ds.keywords.some((k) => upper(k) === "VEHICLE" || upper(k) === "MONSTER");
  let models = modelsFromDatasheet(ds, modelCount, isCharacterSheet);
  const weapons: ScenarioWeapon[] = [];
  const defaults = defaultWeaponNames(ds);
  const seenGroup = new Set<string>();
  let anyRanged = false;
  let anyMelee = false;
  for (const w of ds.weapons) {
    if (opts.weaponNames && !opts.weaponNames.includes(w.name)) continue;
    const group = w.groupName ?? baseWeaponName(w.name);
    let enabled = defaults.has(baseWeaponName(w.name).toLowerCase());
    if (seenGroup.has(group)) enabled = false;
    seenGroup.add(group);
    if (enabled) {
      if (w.kind === "ranged") anyRanged = true;
      else anyMelee = true;
    }
    const base = baseWeaponName(w.name).toLowerCase();
    const count = isCharacterSheet ? 1 : enabled ? defaultWeaponCount(ds, base, modelCount, models) : modelCount;
    weapons.push(weaponToScenario(w, count, opts.weaponNames ? true : enabled));
  }
  // fall back to the first weapon of each kind when the loadout text named nothing usable
  for (const kind of ["ranged", "melee"] as const) {
    if (kind === "ranged" ? anyRanged : anyMelee) continue;
    const first = weapons.find((w) => w.kind === kind);
    if (first) first.enabled = true;
  }
  const effects: EffectRecord[] = [];
  let fnp: number | undefined;
  for (const a of abilitiesOf(ds, snapshot)) {
    const ae = abilityEffects(a);
    effects.push(...ae.effects);
    if (ae.fnp) fnp = Math.min(fnp ?? 7, ae.fnp);
  }
  models = applyFnpToModels(models, fnp);
  const keywords = [...ds.keywords, ...ds.factionKeywords].map(upper);
  let points = pointsFor(ds, snapshot, modelCount);

  // attached characters (Leader / Support)
  const attached: AttachedCharacter[] = [];
  for (const id of opts.attachedDatasheetIds ?? []) {
    const cds = snapshot.data.datasheets.find((d) => d.id === id);
    if (!cds) continue;
    // Which role it is comes from the character's own sheet: it names the units it can lead and the
    // ones it can support. A sheet that claims neither is recorded as a leader, the common case.
    attached.push({ name: cds.name, role: cds.supportTo.includes(ds.id) && !cds.leaderTo.includes(ds.id) ? "support" : "leader", datasheetId: cds.id });
    const cm = modelsFromDatasheet(cds, 1, true);
    let cfnp: number | undefined;
    for (const a of abilitiesOf(cds, snapshot)) {
      const ae = abilityEffects(a);
      effects.push(...ae.effects.map((e) => ({ ...e, source: `${cds.name}: ${e.source ?? ""}`.trim() })));
      if (ae.fnp) cfnp = Math.min(cfnp ?? 7, ae.fnp);
    }
    models.push(...applyFnpToModels(cm, cfnp).map((m) => ({ ...m, name: m.name.toLowerCase() === cds.name.toLowerCase() ? m.name : `${cds.name}: ${m.name}` })));
    let cr = true;
    let cmelee = true;
    for (const w of cds.weapons) {
      const enabled = w.kind === "ranged" ? cr : cmelee;
      if (w.kind === "ranged") cr = false;
      else cmelee = false;
      weapons.push({ ...weaponToScenario(w, 1, enabled), name: `${cds.name}: ${w.name}` });
    }
    for (const k of [...cds.keywords, ...cds.factionKeywords]) if (!keywords.includes(upper(k))) keywords.push(upper(k));
    const cp = pointsFor(cds, snapshot, 1);
    if (cp !== undefined) points = (points ?? 0) + cp;
  }

  return {
    // The unit's own name. Who is attached is `attached`, so a screen can lay the two out rather
    // than read a suffix — and the suffix this used to carry said only "(+1)".
    name: ds.name,
    ref: { snapshotId: snapshot.id, datasheetId: ds.id, attachedDatasheetIds: opts.attachedDatasheetIds ?? [] },
    keywords,
    models,
    weapons,
    attached,
    effects,
    ...(points !== undefined ? { points } : {}),
  };
}

/**
 * Apply a roster unit's wargear selection to the weapon list produced by unitFromDatasheet.
 *
 * `prefix` picks out whose weapons this pass is about. An attached character's weapons are named
 * "<Character>: <weapon>", so the host's pass — whose prefix is empty — would otherwise match them
 * too, and zero them, because the character's weapons are never named in the host's own wargear.
 * `others` lists every attached character's prefix so each pass only touches its own.
 *
 * A list that names no weapon this sheet carries is not a selection at all, and the datasheet's own
 * loadout stands. One that names some is read against `ds`, which puts back the default weapons the
 * list left out — see `omittedDefaults` for which of them come back.
 */
function applyWargearSelection(ds: Datasheet, weapons: ScenarioWeapon[], groups: RosterUnit["models"], prefix = "", others: readonly string[] = []): ScenarioWeapon[] {
  const selected = new Map<string, number>();
  for (const g of groups) for (const item of g.wargear) {
    const key = baseWeaponName(item).toLowerCase();
    selected.set(key, (selected.get(key) ?? 0) + g.count);
  }
  const mine = (w: ScenarioWeapon): boolean => w.name.startsWith(prefix) && !others.some((p) => p !== prefix && w.name.startsWith(p));
  const anyMatch = weapons.filter(mine).some((w) => selected.has(baseWeaponName(w.name.slice(prefix.length)).toLowerCase()));
  if (!anyMatch) return weapons;
  for (const [base, count] of omittedDefaults(ds, groups)) selected.set(base, (selected.get(base) ?? 0) + count);
  const enabledBase = new Set<string>();
  return weapons.map((w) => {
    if (!mine(w)) return w;
    const base = baseWeaponName(w.name.slice(prefix.length)).toLowerCase();
    const n = selected.get(base) ?? 0;
    const first = n > 0 && !enabledBase.has(base);
    if (first) enabledBase.add(base);
    return { ...w, count: n, enabled: first };
  });
}

/**
 * Build a ScenarioUnit from a roster entry: model count from the model groups, weapons from the
 * wargear selection, attached characters resolved, points from the resolver's tiered costing.
 */
export function unitFromRosterUnit(unit: RosterUnit, roster: Roster, snapshot: Snapshot): ScenarioUnit {
  const ds = snapshot.data.datasheets.find((d) => d.id === unit.datasheetId);
  if (!ds) throw new Error(`Unknown datasheet ${unit.datasheetId}`);
  const attached = roster.units.filter((u) => u.attachedTo?.unitId === unit.id);
  const modelCount = unit.models.reduce((s, m) => s + m.count, 0);
  const base = unitFromDatasheet(ds, snapshot, { modelCount, attachedDatasheetIds: attached.map((a) => a.datasheetId) });
  const attachedSheets = attached.map((a) => ({ entry: a, ds: snapshot.data.datasheets.find((d) => d.id === a.datasheetId) }));
  const prefixes = attachedSheets.flatMap((x) => (x.ds ? [`${x.ds.name}: `] : []));
  let weapons = applyWargearSelection(ds, base.weapons, unit.models, "", prefixes);
  for (const { entry, ds: cds } of attachedSheets) {
    if (cds) weapons = applyWargearSelection(cds, weapons, entry.models, `${cds.name}: `, prefixes);
  }
  const ctx = createContext(roster, snapshot);
  const points = ctx.unitCost(unit).total + attached.reduce((s, a) => s + ctx.unitCost(a).total, 0);
  const name = unit.customName ?? ds.name;
  // The roster states the role outright, which is better than inferring it from the sheet.
  const attachedTo: AttachedCharacter[] = attached.map((a) => {
    const cds = snapshot.data.datasheets.find((d) => d.id === a.datasheetId);
    return { name: a.customName ?? cds?.name ?? "?", role: a.attachedTo?.role === "support" ? "support" : "leader", ...(cds ? { datasheetId: cds.id } : {}) };
  });
  return { ...base, name, attached: attachedTo, weapons, points };
}

export function resolveScenarioUnit(unit: ScenarioUnit, snapshot: Snapshot | undefined): ScenarioUnit {
  if (!unit.ref || unit.models.length) return unit;
  if (!snapshot) return unit;
  const ds = snapshot.data.datasheets.find((d) => d.id === unit.ref!.datasheetId);
  if (!ds) return unit;
  return unitFromDatasheet(ds, snapshot, { attachedDatasheetIds: unit.ref.attachedDatasheetIds });
}

/** Coverage: abilities (via snapshot when referenced) and weapon keywords. */
export function coverageFor(unit: ScenarioUnit, snapshot?: Snapshot): CoverageReport {
  let tier1 = 0;
  let tier2 = 0;
  let tier3 = 0;
  const unmodelled: string[] = [];
  if (unit.ref && snapshot) {
    const ids = [unit.ref.datasheetId, ...unit.ref.attachedDatasheetIds];
    for (const id of ids) {
      const ds = snapshot.data.datasheets.find((d) => d.id === id);
      if (!ds) continue;
      for (const a of abilitiesOf(ds, snapshot)) {
        const t = abilityEffects(a).tier;
        if (t === "tier1") tier1++;
        else if (t === "tier2") tier2++;
        else {
          tier3++;
          unmodelled.push(a.name);
        }
      }
    }
  } else if (unit.effects.length) {
    tier2 += new Set(unit.effects.map((e) => e.source ?? "")).size;
  }
  for (const w of unit.weapons) {
    for (const k of w.keywords) {
      if (registry.has(k.name)) tier1++;
      else {
        tier3++;
        unmodelled.push(`${w.name}: ${k.raw ?? k.name}`);
      }
    }
  }
  return { tier1, tier2, tier3, unmodelled: [...new Set(unmodelled)] };
}

function provenanceOf(scope: Ability["scope"]): string {
  switch (scope) {
    case "datasheet":
      return "datasheet ability";
    case "detachment":
      return "detachment rule";
    case "enhancement":
      return "enhancement";
    case "faction":
      return "faction rule";
    case "stratagem":
      return "stratagem";
    case "core":
      return "core ability";
    default:
      return "ability";
  }
}

export const GENERIC_TOGGLES: ManualToggle[] = [
  {
    id: "cmd-reroll-hit",
    label: "Command Re-roll: one hit roll",
    description: "Re-roll a single failed hit roll (per weapon profile).",
    side: "attacker",
    effects: [{ when: { stage: "hit", side: "attacker" }, op: "reroll", target: CH.rerollHit, value: "one-die", source: "Command Re-roll" }],
    defaultOn: false,
  },
  {
    id: "cmd-reroll-wound",
    label: "Command Re-roll: one wound roll",
    description: "Re-roll a single failed wound roll (per weapon profile).",
    side: "attacker",
    effects: [{ when: { stage: "wound", side: "attacker" }, op: "reroll", target: CH.rerollWound, value: "one-die", source: "Command Re-roll" }],
    defaultOn: false,
  },
  {
    id: "reroll-hits-ones",
    label: "Re-roll hit rolls of 1",
    side: "attacker",
    effects: [{ when: { stage: "hit", side: "attacker" }, op: "reroll", target: CH.rerollHit, value: "ones", source: "Toggle" }],
    defaultOn: false,
  },
  {
    id: "reroll-hits",
    label: "Re-roll all failed hit rolls",
    side: "attacker",
    effects: [{ when: { stage: "hit", side: "attacker" }, op: "reroll", target: CH.rerollHit, value: "failed", source: "Toggle" }],
    defaultOn: false,
  },
  {
    id: "reroll-hits-fish",
    label: "Re-roll all non-critical hit rolls (fish for 6s)",
    side: "attacker",
    effects: [{ when: { stage: "hit", side: "attacker" }, op: "reroll", target: CH.rerollHit, value: "non-crit", source: "Toggle" }],
    defaultOn: false,
  },
  {
    id: "reroll-wounds-ones",
    label: "Re-roll wound rolls of 1",
    side: "attacker",
    effects: [{ when: { stage: "wound", side: "attacker" }, op: "reroll", target: CH.rerollWound, value: "ones", source: "Toggle" }],
    defaultOn: false,
  },
  {
    id: "reroll-wounds",
    label: "Re-roll all failed wound rolls",
    side: "attacker",
    effects: [{ when: { stage: "wound", side: "attacker" }, op: "reroll", target: CH.rerollWound, value: "failed", source: "Toggle" }],
    defaultOn: false,
  },
  {
    id: "miracle-hit-6",
    label: "Miracle/Fate dice: one hit roll set to 6",
    description: "One attack die per weapon profile is not rolled. It counts as an unmodified 6.",
    side: "attacker",
    effects: [{ when: { stage: "hit", side: "attacker" }, op: "substitute", target: CH.hitRoll, value: 6, source: "Miracle dice" }],
    defaultOn: false,
  },
  {
    id: "miracle-wound-6",
    label: "Miracle/Fate dice: one wound roll set to 6",
    description: "One wound roll per weapon profile is not rolled. It counts as an unmodified 6.",
    side: "attacker",
    effects: [{ when: { stage: "wound", side: "attacker" }, op: "substitute", target: CH.woundRoll, value: 6, source: "Miracle dice" }],
    defaultOn: false,
  },
  { id: "plus1-hit", label: "+1 to hit", side: "attacker", effects: [{ when: { stage: "hit", side: "attacker" }, op: "add", target: CH.hitRoll, value: 1, source: "Toggle" }], defaultOn: false },
  { id: "plus1-wound", label: "+1 to wound", side: "attacker", effects: [{ when: { stage: "wound", side: "attacker" }, op: "add", target: CH.woundRoll, value: 1, source: "Toggle" }], defaultOn: false },
  { id: "plus1-ap", label: "Improve AP by 1", side: "attacker", effects: [{ when: { stage: "save", side: "attacker" }, op: "add", target: CH.ap, value: 1, source: "Toggle" }], defaultOn: false },
  { id: "lethal-all", label: "Grant Lethal Hits", side: "attacker", effects: [{ when: { stage: "hit", side: "attacker" }, op: "flag", target: CH.lethal, value: true, source: "Toggle" }], defaultOn: false },
  { id: "sustained-all", label: "Grant Sustained Hits 1", side: "attacker", effects: [{ when: { stage: "hit", side: "attacker" }, op: "set", target: CH.sustained, value: 1, source: "Toggle" }], defaultOn: false },
  { id: "dev-all", label: "Grant Devastating Wounds", side: "attacker", effects: [{ when: { stage: "wound", side: "attacker" }, op: "flag", target: CH.devastating, value: true, source: "Toggle" }], defaultOn: false },
  { id: "crit5", label: "Critical hits on 5+", side: "attacker", effects: [{ when: { stage: "hit", side: "attacker" }, op: "cap", target: CH.critHit, value: 5, source: "Toggle" }], defaultOn: false },
  { id: "minus1-hit", label: "-1 to be hit", side: "defender", effects: [{ when: { stage: "hit", side: "defender" }, op: "add", target: CH.hitRoll, value: -1, source: "Toggle" }], defaultOn: false },
  { id: "minus1-wound", label: "-1 to be wounded", side: "defender", effects: [{ when: { stage: "wound", side: "defender" }, op: "add", target: CH.woundRoll, value: -1, source: "Toggle" }], defaultOn: false },
  { id: "minus1-dmg", label: "-1 Damage (min 1)", side: "defender", effects: [{ when: { stage: "damage", side: "defender" }, op: "add", target: CH.damage, value: -1, source: "Toggle" }], defaultOn: false },
  { id: "half-dmg", label: "Halve Damage (rounding up)", side: "defender", effects: [{ when: { stage: "damage", side: "defender" }, op: "mul", target: CH.damage, value: 0.5, source: "Toggle" }], defaultOn: false },
  { id: "ap-worse", label: "Worsen AP by 1 (Armour of Contempt-like)", side: "defender", effects: [{ when: { stage: "save", side: "defender" }, op: "add", target: CH.ap, value: -1, source: "Toggle" }], defaultOn: false },
  { id: "fnp5", label: "Feel No Pain 5+", side: "defender", effects: [{ when: { stage: "fnp", side: "defender" }, op: "set", target: CH.fnp, value: 5, source: "Toggle" }], defaultOn: false },
  { id: "fnp6", label: "Feel No Pain 6+", side: "defender", effects: [{ when: { stage: "fnp", side: "defender" }, op: "set", target: CH.fnp, value: 6, source: "Toggle" }], defaultOn: false },
  { id: "inv4", label: "4+ invulnerable save", side: "defender", effects: [{ when: { stage: "save", side: "defender" }, op: "cap", target: CH.invuln, value: 4, source: "Toggle" }], defaultOn: false },
  { id: "inv5", label: "5+ invulnerable save", side: "defender", effects: [{ when: { stage: "save", side: "defender" }, op: "cap", target: CH.invuln, value: 5, source: "Toggle" }], defaultOn: false },
  // Stealth is its own -1 to be hit, so this toggle is the Benefit of Cover alone. The id is what
  // saved scenarios carry, so it stays as it is.
  { id: "stealth", label: "Benefit of cover", side: "defender", effects: [{ when: { stage: "hit", side: "defender" }, op: "flag", target: CH.stealth, value: true, source: "Toggle" }], defaultOn: false },
  { id: "defender-indirect", label: "Target not visible", side: "defender", effects: [], defaultOn: false },
];

/** Toggles for the abilities carried by a unit (Tier-2 ones are on by default and can be switched off). */
export function abilityToggles(unit: ScenarioUnit, side: "attacker" | "defender", snapshot?: Snapshot): ManualToggle[] {
  const out: ManualToggle[] = [];
  const seen = new Set<string>();
  if (unit.ref && snapshot) {
    for (const id of [unit.ref.datasheetId, ...unit.ref.attachedDatasheetIds]) {
      const ds = snapshot.data.datasheets.find((d) => d.id === id);
      if (!ds) continue;
      for (const a of abilitiesOf(ds, snapshot)) {
        const ae = abilityEffects(a);
        const relevant = ae.effects.filter((e) => (e.when.side ?? "attacker") === side);
        if (!relevant.length) continue;
        const tid = `ability:${side}:${a.id}`;
        if (seen.has(tid)) continue;
        seen.add(tid);
        out.push({ id: tid, label: a.name, description: a.text.slice(0, 300), side, effects: relevant, defaultOn: true, provenance: provenanceOf(a.scope) });
      }
    }
  } else {
    const groups = new Map<string, EffectRecord[]>();
    for (const e of unit.effects) {
      if ((e.when.side ?? "attacker") !== side) continue;
      const k = e.source ?? "effect";
      groups.set(k, [...(groups.get(k) ?? []), e]);
    }
    for (const [name, effects] of groups) out.push({ id: `ability:${side}:${name}`, label: name, side, effects, defaultOn: true, provenance: "unit ability" });
  }
  return out;
}

export function listToggles(scenario: Scenario, snapshot?: Snapshot): ManualToggle[] {
  return [...abilityToggles(scenario.attacker, "attacker", snapshot), ...abilityToggles(scenario.defender, "defender", snapshot), ...GENERIC_TOGGLES.map((t) => ({ ...t, provenance: t.id.startsWith("cmd-") || t.id.startsWith("miracle") ? "stratagem" : "manual" }))];
}

/** Effects active for the scenario after applying enabledToggles ("-id" disables a default-on toggle). */
export function activeToggleEffects(scenario: Scenario, toggles: ManualToggle[]): { effects: EffectRecord[]; manual: EffectRecord[]; flags: string[] } {
  const on = new Set(scenario.enabledToggles.filter((t) => !t.startsWith("-")));
  const off = new Set(scenario.enabledToggles.filter((t) => t.startsWith("-")).map((t) => t.slice(1)));
  const effects: EffectRecord[] = [];
  // The toggles a player adds to the scenario, as against the ones standing for an ability a unit
  // already carries. Only these are new: an ability toggle repeats what the unit's own effects say.
  const manual: EffectRecord[] = [];
  const flags: string[] = [];
  for (const t of toggles) {
    const enabled = on.has(t.id) || (t.defaultOn && !off.has(t.id));
    if (!enabled) continue;
    const sided = t.effects.map((e) => ({ ...e, when: { ...e.when, side: e.when.side ?? t.side } }));
    effects.push(...sided);
    if (!t.id.startsWith("ability:")) manual.push(...sided);
    if (t.id === "defender-indirect") flags.push("target-not-visible");
  }
  return { effects, manual, flags };
}

export type { Archetype };
