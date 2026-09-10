import type { Ability, Archetype, CoverageReport, Datasheet, EffectRecord, ManualToggle, Roster, RosterUnit, Scenario, ScenarioModel, ScenarioUnit, ScenarioWeapon, Snapshot, WeaponProfile } from "@grimstat/schema";
import { createContext } from "@grimstat/resolver";
import { abilityEffects, applyFnpToModels } from "./patterns";
import { CH } from "./channels";
import type { UnitFromDatasheetOptions } from "./api";

import { keywordRegistry as registry } from "./scenario";

export function upper(s: string): string {
  return s.trim().toUpperCase();
}

function abilitiesOf(ds: Datasheet, snapshot: Snapshot): Ability[] {
  const byId = new Map(snapshot.data.abilities.map((a) => [a.id, a] as const));
  return ds.abilityIds.map((id) => byId.get(id)).filter((a): a is Ability => !!a);
}

export function pointsFor(ds: Datasheet, snapshot: Snapshot, modelCount: number): number | undefined {
  const rules = snapshot.data.priceRules.filter((r) => r.datasheetId === ds.id && r.copyRange.min <= 1 && (r.copyRange.max === undefined || r.copyRange.max >= 1));
  const rule = rules[0];
  if (!rule) return ds.fallbackPoints;
  let best = rule.tiers[0];
  for (const t of rule.tiers) if (t.models <= modelCount && (!best || t.models >= best.models)) best = t;
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
  for (const id of opts.attachedDatasheetIds ?? []) {
    const cds = snapshot.data.datasheets.find((d) => d.id === id);
    if (!cds) continue;
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
    name: opts.attachedDatasheetIds?.length ? `${ds.name} (+${opts.attachedDatasheetIds.length})` : ds.name,
    ref: { snapshotId: snapshot.id, datasheetId: ds.id, attachedDatasheetIds: opts.attachedDatasheetIds ?? [] },
    keywords,
    models,
    weapons,
    effects,
    ...(points !== undefined ? { points } : {}),
  };
}

/** Apply a roster unit's wargear selection to the weapon list produced by unitFromDatasheet. */
function applyWargearSelection(weapons: ScenarioWeapon[], groups: RosterUnit["models"], prefix = ""): ScenarioWeapon[] {
  const selected = new Map<string, number>();
  for (const g of groups) for (const item of g.wargear) {
    const key = baseWeaponName(item).toLowerCase();
    selected.set(key, (selected.get(key) ?? 0) + g.count);
  }
  const relevant = weapons.filter((w) => w.name.startsWith(prefix));
  const anyMatch = relevant.some((w) => selected.has(baseWeaponName(w.name.slice(prefix.length)).toLowerCase()));
  if (!anyMatch) return weapons;
  const enabledBase = new Set<string>();
  return weapons.map((w) => {
    if (!w.name.startsWith(prefix)) return w;
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
  let weapons = applyWargearSelection(base.weapons, unit.models);
  for (const a of attached) {
    const cds = snapshot.data.datasheets.find((d) => d.id === a.datasheetId);
    if (cds) weapons = applyWargearSelection(weapons, a.models, `${cds.name}: `);
  }
  const ctx = createContext(roster, snapshot);
  const points = ctx.unitCost(unit).total + attached.reduce((s, a) => s + ctx.unitCost(a).total, 0);
  const name = unit.customName ?? ds.name;
  return { ...base, name: attached.length ? `${name} (+${attached.map((a) => snapshot.data.datasheets.find((d) => d.id === a.datasheetId)?.name ?? "?").join(", ")})` : name, weapons, points };
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
    description: "One attack die per weapon profile is not rolled; it counts as an unmodified 6.",
    side: "attacker",
    effects: [{ when: { stage: "hit", side: "attacker" }, op: "substitute", target: CH.hitRoll, value: 6, source: "Miracle dice" }],
    defaultOn: false,
  },
  {
    id: "miracle-wound-6",
    label: "Miracle/Fate dice: one wound roll set to 6",
    description: "One wound roll per weapon profile is not rolled; it counts as an unmodified 6.",
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
  { id: "stealth", label: "Stealth / benefit of cover", side: "defender", effects: [{ when: { stage: "hit", side: "defender" }, op: "flag", target: CH.stealth, value: true, source: "Toggle" }], defaultOn: false },
  { id: "defender-indirect", label: "Target not visible (Indirect Fire → Snap Shooting)", side: "defender", effects: [], defaultOn: false },
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
export function activeToggleEffects(scenario: Scenario, toggles: ManualToggle[]): { effects: EffectRecord[]; flags: string[] } {
  const on = new Set(scenario.enabledToggles.filter((t) => !t.startsWith("-")));
  const off = new Set(scenario.enabledToggles.filter((t) => t.startsWith("-")).map((t) => t.slice(1)));
  const effects: EffectRecord[] = [];
  const flags: string[] = [];
  for (const t of toggles) {
    const enabled = on.has(t.id) || (t.defaultOn && !off.has(t.id));
    if (!enabled) continue;
    effects.push(...t.effects.map((e) => ({ ...e, when: { ...e.when, side: e.when.side ?? t.side } })));
    if (t.id === "defender-indirect") flags.push("target-not-visible");
  }
  return { effects, flags };
}

export type { Archetype };
