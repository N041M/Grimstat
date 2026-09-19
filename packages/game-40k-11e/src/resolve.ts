import type { Ability, Archetype, AttachedCharacter, CoverageReport, Datasheet, EffectRecord, ManualToggle, ModelProfile, PriceRule, PriceTier, Roster, RosterUnit, Scenario, ScenarioModel, ScenarioUnit, ScenarioWeapon, Snapshot, WeaponProfile } from "@grimstat/schema";
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
  /**
   * How many of a weapon one model carries, where the prose says more than one ("3 dark lances").
   * Absent for the weapons it names singly, which is most of them.
   */
  copies: Record<string, number>;
  /**
   * How many models carry a weapon, where the prose hands it to a kind of model the datasheet has no
   * profile for: "1 Gun Servitor is equipped with: heavy arc rifle", "Every Combat Servitor is
   * equipped with: phosphor blaster". The number is the one the sentence gives, or the one the unit
   * composition gives that kind.
   */
  carriers: Record<string, number>;
}

const strip = (s: string) => s.replace(/^(?:an?|one|\d+x?|the)\s+/i, "").trim();

/** The count a loadout item opens with: "3 dark lances", "2x twin pulse carbine". */
const ITEM_COUNT = /^(\d+)\s*x?\s+/i;

/** A name without its plural, so "Gun Servitors" and "Gun Servitor" are one kind. */
const singular = (s: string): string =>
  s
    .split(" ")
    .map((w) => (w.length > 3 ? w.replace(/[sz]$/, "") : w))
    .join(" ");

/**
 * How many models a loadout sentence is about, when its subject is a kind of model rather than one
 * of the datasheet's profiles.
 *
 * The sentence says so itself where it can — "1 Gun Servitor is equipped with…" — and otherwise the
 * unit composition does: "6 Combat Servitors". Nothing else counts them, so a subject neither names
 * is left to the caller.
 */
function subjectCount(ds: Datasheet, subject: string): number | undefined {
  const own = /^(\d+)\s+(.*)$/.exec(subject);
  if (own) return Number(own[1]);
  const want = singular(subject.trim());
  if (!want) return undefined;
  for (const line of ds.composition) {
    const m = /^\s*(\d+)\s+(.+?)\s*$/.exec(line.description);
    if (!m) continue;
    if (singular(m[2]!.toLowerCase().replace(/\bmodels?\b\s*$/, "").trim()) === want) return Number(m[1]);
  }
  return undefined;
}

/**
 * Parse default-loadout prose such as
 *   "Every model is equipped with: flux carbine; shock maul.\nThe Warden Sergeant is also equipped with a power fist."
 * into weapons for every model and weapons for a specific profile. Option/replacement text is ignored.
 */
/**
 * Read once per datasheet. The prose behind a loadout does not change while a snapshot is open, and
 * every unit built, costed or checked asks for it again: the army checks alone read it twice per
 * unit, and re-reading it was most of what they spent their time on. A datasheet rewritten by an
 * override is a new object, so it is parsed again.
 */
const PARSED = new WeakMap<Datasheet, ParsedLoadout>();

export function parseLoadout(ds: Datasheet): ParsedLoadout {
  const cached = PARSED.get(ds);
  if (cached) return cached;
  const parsed = readLoadout(ds);
  PARSED.set(ds, parsed);
  return parsed;
}

function readLoadout(ds: Datasheet): ParsedLoadout {
  const out: ParsedLoadout = { all: [], byProfile: {}, copies: {}, carriers: {} };
  const text = ds.loadout ?? "";
  if (!text) return out;
  const bases = [...new Set(ds.weapons.map((w) => baseWeaponName(w.name).toLowerCase()).filter(Boolean))];
  /**
   * The weapons one item of the prose names.
   *
   * An exact name settles it. Without one, an item that spells a weapon out with words to spare
   * ("twin-linked heavy bolter" against "heavy bolter") names it, and failing that an item that is
   * part of exactly one weapon's name names that weapon. The last of those has to be unambiguous:
   * "shoota" is part of a shoota, a big shoota and a kustom shoota, and a Boy carrying a shoota is
   * carrying one of them.
   */
  const matchBases = (item: string): string[] => {
    const exact = bases.filter((b) => b === item);
    if (exact.length) return exact;
    const spelled = bases.filter((b) => item.includes(b));
    if (spelled.length) return spelled;
    const partOf = bases.filter((b) => b.includes(item));
    return partOf.length === 1 ? partOf : [];
  };
  // The count in front of an item belongs to the weapon that item names, and is read before the
  // name is stripped of it.
  const matchItems = (itemsText: string): string[] => {
    const found: string[] = [];
    for (const raw of itemsText.split(/[;,]|\band\b/)) {
      const piece = raw.replace(/\.$/, "").trim();
      const item = strip(piece).toLowerCase();
      if (!item) continue;
      const n = Number(ITEM_COUNT.exec(piece)?.[1] ?? 1);
      for (const b of matchBases(item)) {
        if (found.includes(b)) continue;
        found.push(b);
        if (n > 1) out.copies[b] = Math.max(out.copies[b] ?? 1, n);
      }
    }
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
    // A profile that names two kinds of model at once — "Combat Servitors and Gun Servitors" — is not
    // named by a sentence about one of them. Those weapons belong to that kind, and how many models
    // it has is counted below rather than handed to the whole profile.
    const profile = profiles.find((p) => p === subject || subject.includes(p) || (p.includes(subject) && !/\s+and\s+/.test(p)));
    if (profile) {
      out.byProfile[profile] = [...new Set([...(out.byProfile[profile] ?? []), ...items])];
      continue;
    }
    // A subject the datasheet has no profile for is a kind of model inside the unit: "1 Gun Servitor",
    // "Every Combat Servitor". How many of them there are is written either in the sentence or in the
    // unit composition, and only when neither says do the weapons go to every model — which handed a
    // nine-model Servitor Battleclade nine heavy arc rifles for the one it has.
    const carriers = subjectCount(ds, subject);
    if (carriers === undefined) {
      for (const i of items) if (!out.all.includes(i)) out.all.push(i);
      continue;
    }
    for (const i of items) out.carriers[i] = (out.carriers[i] ?? 0) + carriers;
  }
  // no recognisable clause: fall back to a plain substring match over the whole text
  if (!out.all.length && !Object.keys(out.byProfile).length) {
    const lower = text.toLowerCase();
    for (const b of bases) if (lower.includes(b)) out.all.push(b);
  }
  return out;
}

/** Weapon base names the datasheet's default loadout mentions (lower-case), however it names them. */
function defaultWeaponNames(p: ParsedLoadout): Set<string> {
  return new Set([...p.all, ...Object.values(p.byProfile).flat(), ...Object.keys(p.carriers)]);
}

/**
 * How many of a weapon the unit fields by default: the models carrying it, times the number each of
 * them carries.
 *
 * The second half is what the datasheet writes as "3 dark lances" or "2 twin pulse carbines". Read
 * as one weapon per model, a Ravager fired a third of the shots it has and a Monolith a quarter.
 */
function defaultWeaponCount(p: ParsedLoadout, base: string, modelCount: number, groups: ScenarioModel[]): number {
  const copies = p.copies[base] ?? 1;
  if (p.all.includes(base)) return modelCount * copies;
  let n = 0;
  for (const [profile, items] of Object.entries(p.byProfile)) {
    if (!items.includes(base)) continue;
    const g = groups.find((m) => m.name.toLowerCase() === profile);
    n += g ? g.count : 1;
  }
  if (n) return n * copies;
  // A weapon the prose gives to a kind of model rather than to a profile: as many as there are of
  // that kind, whatever the unit's own size.
  const carriers = p.carriers[base];
  if (carriers) return Math.min(carriers, modelCount) * copies;
  return modelCount * copies;
}

const scenarioModel = (p: ModelProfile, count: number, isCharacter: boolean): ScenarioModel => ({ name: p.name, count, T: p.T, Sv: p.Sv, InvSv: p.InvSv ?? null, W: p.W, fnp: null, isCharacter, keywords: [] });

/**
 * The models a unit is made of, in profile order.
 *
 * A caller that knows which model is which says so. Without that the split is guessed — one of each
 * profile the datasheet prints first, the rest on the last — which is the shape of most units and
 * the wrong way round for the rest: a squad of Fire Dragons came out as one Dragon and nine
 * Exarchs, with the Exarch's wounds and save on nine models that do not have them.
 *
 * Groups of the same profile are added together, since two groups differ by what they carry and the
 * models themselves are the same.
 */
function modelsFromDatasheet(ds: Datasheet, modelCount: number, isCharacter: boolean, groups?: ReadonlyArray<{ modelProfileId: string; count: number }>): ScenarioModel[] {
  const profiles = ds.models;
  const out: ScenarioModel[] = [];
  if (isCharacter || profiles.length === 1) {
    for (const p of profiles) out.push(scenarioModel(p, isCharacter ? 1 : modelCount, isCharacter));
    return out;
  }

  const asked = new Map<string, number>();
  for (const g of groups ?? []) {
    if (!profiles.some((p) => p.id === g.modelProfileId) || g.count <= 0) continue;
    asked.set(g.modelProfileId, (asked.get(g.modelProfileId) ?? 0) + g.count);
  }
  if (asked.size) {
    for (const p of profiles) {
      const count = asked.get(p.id);
      if (count) out.push(scenarioModel(p, count, false));
    }
    return out;
  }

  let remaining = modelCount;
  profiles.forEach((p, i) => {
    const isLast = i === profiles.length - 1;
    const count = isLast ? Math.max(1, remaining) : 1;
    remaining -= count;
    out.push(scenarioModel(p, count, false));
  });
  return out;
}

export function unitFromDatasheet(ds: Datasheet, snapshot: Snapshot, opts: UnitFromDatasheetOptions = {}): ScenarioUnit {
  const modelCount = Math.max(1, opts.modelCount ?? defaultModelCount(ds));
  const isCharacterSheet = ds.isCharacter && ds.models.length === 1 && !ds.keywords.some((k) => upper(k) === "VEHICLE" || upper(k) === "MONSTER");
  let models = modelsFromDatasheet(ds, modelCount, isCharacterSheet, opts.modelGroups);
  const weapons: ScenarioWeapon[] = [];
  const parsed = parseLoadout(ds);
  const defaults = defaultWeaponNames(parsed);
  const seenGroup = new Set<string>();
  let anyRanged = false;
  let anyMelee = false;
  for (const w of ds.weapons) {
    if (opts.weaponNames && !opts.weaponNames.includes(w.name)) continue;
    // Only the first profile of a weapon is live, because the rest are the same weapon fired another
    // way. A weapon that both shoots and fights has one profile of each kind, though, and the model
    // uses them in different phases, so the two are kept apart here: a guardian spear that lost its
    // melee profile left a Custodian with nothing to fight with.
    const group = `${w.groupName ?? baseWeaponName(w.name)}\u0000${w.kind}`;
    let enabled = defaults.has(baseWeaponName(w.name).toLowerCase());
    if (seenGroup.has(group)) enabled = false;
    seenGroup.add(group);
    if (enabled) {
      if (w.kind === "ranged") anyRanged = true;
      else anyMelee = true;
    }
    const base = baseWeaponName(w.name).toLowerCase();
    // A character sheet is one model whatever the unit around it counts, but the pair of pistols in
    // its hands is still a pair.
    const count = isCharacterSheet ? (enabled ? parsed.copies[base] ?? 1 : 1) : enabled ? defaultWeaponCount(parsed, base, modelCount, models) : modelCount;
    weapons.push(weaponToScenario(w, count, opts.weaponNames ? true : enabled));
  }
  /*
   * A model with nothing of one kind takes the first weapon of that kind the options do not mention.
   *
   * The prose does not always name both halves of a weapon. Trajann Valoris is "equipped with:
   * Watcher's Axe", and the shooting half of that axe is printed under its own name, so reading the
   * sentence leaves him unable to shoot. What the options mention is the test: a weapon an option
   * line names is one the model would have to swap something for, and handing it over for free gave
   * a Maulerfiend the magma cutters it can only have in place of its tendrils.
   */
  const optionText = ds.wargearOptions.join("\n").toLowerCase();
  for (const kind of ["ranged", "melee"] as const) {
    if (kind === "ranged" ? anyRanged : anyMelee) continue;
    const first = weapons.find((w) => w.kind === kind && !optionText.includes(baseWeaponName(w.name).toLowerCase()));
    if (first) first.enabled = true;
  }
  const effects: EffectRecord[] = [];
  let fnp: number | undefined;
  for (const a of abilitiesOf(ds, snapshot)) {
    const ae = abilityEffects(a);
    // An ability that is spent once a battle, or that is one of several options, does not apply
    // until the player says so. Its toggle carries the effects instead.
    if (ae.defaultOn === false) continue;
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
      if (ae.defaultOn === false) continue;
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
  // Only the first profile of a weapon is live, and a weapon that both shoots and fights has one
  // profile of each kind. The two are counted apart, as `unitFromDatasheet` does, so that picking a
  // guardian spear off a wargear list does not leave the Custodian with nothing to fight with.
  const enabledBase = new Set<string>();
  return weapons.map((w) => {
    if (!mine(w)) return w;
    const base = baseWeaponName(w.name.slice(prefix.length)).toLowerCase();
    const group = `${base}\u0000${w.kind}`;
    const n = selected.get(base) ?? 0;
    const first = n > 0 && !enabledBase.has(group);
    if (first) enabledBase.add(group);
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
  const base = unitFromDatasheet(ds, snapshot, { modelCount, modelGroups: unit.models, attachedDatasheetIds: attached.map((a) => a.datasheetId) });
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

/**
 * Names of the abilities a unit's datasheets carry, upper-cased.
 *
 * A datasheet prints its own rules in the weapon's keyword slot as well — "[DEAD CHOPPY]",
 * "[C'TAN POWER]" — and the rule itself is written out in an ability of that name on the same
 * sheet. Neither the registry nor a player should read those as core keywords.
 */
export function abilityNamesOf(unit: ScenarioUnit, snapshot?: Snapshot): Map<string, Ability> {
  const out = new Map<string, Ability>();
  if (!unit.ref || !snapshot) return out;
  for (const id of [unit.ref.datasheetId, ...unit.ref.attachedDatasheetIds]) {
    const ds = snapshot.data.datasheets.find((d) => d.id === id);
    if (!ds) continue;
    for (const a of abilitiesOf(ds, snapshot)) out.set(a.name.toUpperCase(), a);
  }
  return out;
}

/** Coverage: abilities (via snapshot when referenced) and weapon keywords. */
export function coverageFor(unit: ScenarioUnit, snapshot?: Snapshot): CoverageReport {
  let tier1 = 0;
  let tier2 = 0;
  let tier3 = 0;
  const unmodelled: string[] = [];
  const own = abilityNamesOf(unit, snapshot);
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
      // The sheet's own rule, counted once on the ability row it is written on rather than a second
      // time here under a name no registry will ever hold.
      else if (own.has(k.name.toUpperCase())) continue;
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
        const provenance = provenanceOf(a.scope);
        const add = (tid: string, label: string, effects: EffectRecord[], defaultOn: boolean): void => {
          const relevant = effects.filter((e) => (e.when.side ?? "attacker") === side);
          if (!relevant.length || seen.has(tid)) return;
          seen.add(tid);
          out.push({ id: tid, label, description: a.text.slice(0, 300), side, effects: relevant, defaultOn, provenance });
        };
        add(`ability:${side}:${a.id}`, a.name, ae.effects, ae.defaultOn !== false);
        // A menu ability puts each printed option on its own switch, and starts with none of them
        // taken, since the datasheet lets the player have exactly one.
        for (const [i, o] of (ae.options ?? []).entries()) add(`ability:${side}:${a.id}#${i}`, `${a.name}: ${o.label}`, o.effects, false);
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
    if (!t.id.startsWith("ability:") || !t.defaultOn) manual.push(...sided);
    if (t.id === "defender-indirect") flags.push("target-not-visible");
  }
  return { effects, manual, flags };
}

export type { Archetype };
