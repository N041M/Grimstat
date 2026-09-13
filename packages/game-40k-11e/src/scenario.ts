import { ModifierSet, collectModifiers, type EvalContext, type KeywordContext, type KeywordHandler, type KeywordOptions, type KeywordRegistry } from "@grimstat/effects";
import { run, percentiles, delta, mean, type EngineInput, type TargetGroup, type WeaponParams, type GroupParams } from "@grimstat/engine";
import type { Scenario, ScenarioModel, ScenarioUnit, ScenarioWeapon, SimResult, Snapshot } from "@grimstat/schema";
import { CH, POLICY } from "./channels";
import { create11eKeywordRegistry } from "./keywords";
import { gameSystem, RULES, RULES_10E, type RulesParams } from "./manifest";
import { attacksPMF, classifyHit, classifyWound, damagePMF, hitGate, pUnsaved, sustainedPMF, woundGate, woundTarget } from "./attack";
import { activeToggleEffects, coverageFor, listToggles, resolveScenarioUnit, upper } from "./resolve";

/** The live 11e keyword registry. Other plugins may extend it via `registerKeyword` without editing this package. */
export const keywordRegistry = create11eKeywordRegistry(RULES);

/** Game-system id of the 10th-edition rules model, which this package can run without the 10e plugin loaded. */
const TENTH_ID = "wh40k-10e";

/** One edition's rule parameters and keyword registry, looked up by game-system id. */
interface Edition {
  rules: RulesParams;
  registry: KeywordRegistry;
}

const editions = new Map<string, Edition>([[gameSystem.id, { rules: RULES, registry: keywordRegistry }]]);

/**
 * Keywords added through `registerKeyword`, kept so an edition published later starts with them too.
 * One registration is meant to reach every edition, and replaying the list is what makes that hold
 * whichever order the packages happen to load in.
 */
const addedKeywords: Array<{ name: string; handler: KeywordHandler; opts: KeywordOptions }> = [];

/** Add a keyword to every edition, the ones already published and the ones published later. */
export function registerKeywordEverywhere(name: string, handler: KeywordHandler, opts: KeywordOptions = {}): void {
  addedKeywords.push({ name, handler, opts });
  for (const e of editions.values()) e.registry.register(name, handler, opts);
}

/**
 * Build and publish an edition, so `runScenario` dispatches a scenario carrying `gameSystemId` to
 * its rules and its registry. `createGameSystem` calls this for the plugin it builds.
 *
 * `customise` runs after the keywords added through `registerKeyword`, so an edition's own handler
 * for a keyword wins over a general one for that edition.
 */
export function publishEdition(gameSystemId: string, rules: RulesParams, customise?: (registry: KeywordRegistry) => void): KeywordRegistry {
  const registry = create11eKeywordRegistry(rules);
  for (const k of addedKeywords) registry.register(k.name, k.handler, k.opts);
  customise?.(registry);
  editions.set(gameSystemId, { rules, registry });
  return registry;
}

/**
 * The edition a scenario runs under. 10th edition is built here the first time it is asked for, so a
 * 10e scenario is scored under 10e rules whether or not the 10e plugin package was ever loaded, and
 * both paths pick up every keyword added through `registerKeyword`. Any other id runs under 11th.
 */
function editionFor(gameSystemId: string): Edition {
  const known = editions.get(gameSystemId);
  if (known) return known;
  if (gameSystemId !== TENTH_ID) return editions.get(gameSystem.id)!;
  publishEdition(TENTH_ID, RULES_10E);
  return editions.get(TENTH_ID)!;
}

interface Group {
  target: TargetGroup;
  model: ScenarioModel;
}

/** Group defender models by defensive profile; characters get their own group. */
function buildGroups(defender: ScenarioUnit): Group[] {
  const groups: Group[] = [];
  const key = (m: ScenarioModel) => [m.T, m.Sv, m.InvSv ?? "-", m.W, m.fnp ?? "-", m.isCharacter ? "C" : "n", m.isCharacter ? m.name : ""].join("|");
  const byKey = new Map<string, Group>();
  for (const m of defender.models) {
    if (m.count <= 0) continue;
    const k = key(m);
    const existing = byKey.get(k);
    if (existing) {
      existing.target.models += m.count;
      continue;
    }
    const g: Group = {
      target: { id: `${groups.length}`, name: m.name, models: m.count, wounds: m.W, isCharacter: m.isCharacter },
      model: m,
    };
    byKey.set(k, g);
    groups.push(g);
  }
  // points per model: spread unit points by wounds share
  if (defender.points) {
    const totalW = groups.reduce((s, g) => s + g.target.models * g.target.wounds, 0);
    if (totalW > 0) for (const g of groups) g.target.pointsPerModel = (defender.points * g.target.wounds) / totalW;
  }
  return groups;
}

/** Majority Toughness of the unit (ties → highest). */
function unitToughness(defender: ScenarioUnit): number {
  const counts = new Map<number, number>();
  for (const m of defender.models) counts.set(m.T, (counts.get(m.T) ?? 0) + m.count);
  let best = 0;
  let bestCount = -1;
  for (const [t, c] of counts) if (c > bestCount || (c === bestCount && t > best)) [best, bestCount] = [t, c];
  return best || 4;
}

function evalContext(attacker: ScenarioUnit, defender: ScenarioUnit, weapon: ScenarioWeapon, scenario: Scenario, extraFlags: string[]): EvalContext {
  const ctx = scenario.context;
  return {
    attackerKeywords: new Set(attacker.keywords.map(upper)),
    targetKeywords: new Set(defender.keywords.map(upper)),
    weaponKind: weapon.kind,
    weaponKeywords: new Set(weapon.keywords.map((k) => upper(k.name))),
    rangeBand: ctx.rangeBand,
    charged: ctx.charged,
    stationary: ctx.stationary,
    inCover: ctx.inCover,
    phase: ctx.phase,
    flags: new Set([...ctx.flags, ...extraFlags]),
  };
}

/** Runs under the edition named by `scenario.gameSystemId` ("wh40k-10e" → 10th-edition rules; anything else → 11th). */
export function runScenario(scenario: Scenario, opts: { snapshot?: Snapshot; initialState?: number[] } = {}): SimResult {
  const edition = editionFor(scenario.gameSystemId);
  return runScenarioWith(edition.rules, edition.registry, scenario, opts);
}

/** Edition-parametrised core: the same pipeline under a different `RulesParams` and keyword registry. */
export function runScenarioWith(rules: RulesParams, registry: KeywordRegistry, scenario: Scenario, opts: { snapshot?: Snapshot; initialState?: number[] } = {}): SimResult {
  const warnings: string[] = [];
  const snapshot = opts.snapshot;
  const attacker = resolveScenarioUnit(scenario.attacker, snapshot);
  const defender = resolveScenarioUnit(scenario.defender, snapshot);
  const toggles = listToggles({ ...scenario, attacker, defender }, snapshot);
  const active = activeToggleEffects(scenario, toggles);
  const groups = buildGroups(defender);
  if (!groups.length) warnings.push("Defender has no models.");
  const T = unitToughness(defender);
  const ctx = scenario.context;
  // Hazardous costs a big model more than it costs an infantry one. Which keywords count is an
  // edition rule. 10e names CHARACTER alongside MONSTER and VEHICLE, and 11e does not.
  const attackerBigModel = attacker.keywords.some((k) => rules.hazardousBigModelKeywords.includes(upper(k)));
  const defenderModelCount = defender.models.reduce((s, m) => s + m.count, 0);
  // An effect's `when.side` says which role its carrier has to be playing for it to apply: a "+1 to
  // hit" a unit gets while attacking is recorded as `attacker`, and a "-1 to be hit" it gets while
  // being shot at is recorded as `defender`. So each unit contributes only the effects matching the
  // role it holds in this scenario. Pooling both units and splitting on the field alone handed a
  // defender's offensive ability to the attacker.
  const carried = [
    ...attacker.effects.filter((e) => (e.when.side ?? "attacker") === "attacker"),
    ...defender.effects.filter((e) => (e.when.side ?? "attacker") === "defender"),
  ];
  // Only the manual toggles are added. An ability toggle was built from these same unit effects and
  // would otherwise apply them a second time. It acts through `offSources` below instead.
  const allEffects = [...carried, ...active.manual, ...scenario.extraEffects];
  // ability toggles that were switched off must remove the unit's own effects with that source
  const off = new Set(scenario.enabledToggles.filter((t) => t.startsWith("-")).map((t) => t.slice(1)));
  const offSources = new Set(toggles.filter((t) => off.has(t.id) && t.id.startsWith("ability:")).map((t) => t.label));
  /**
   * Does this effect come from an ability the player switched off? An attached character's effects
   * are re-sourced as "<Character>: <ability>" while the toggle is named after the ability alone,
   * so both spellings have to be recognised or the character's toggle does nothing.
   */
  const switchedOff = (source: string | undefined): boolean => {
    if (!source) return false;
    if (offSources.has(source)) return true;
    const colon = source.indexOf(": ");
    return colon > 0 && offSources.has(source.slice(colon + 2));
  };

  const weapons: WeaponParams[] = [];
  const phaseKind = ctx.phase === "fight" ? "melee" : "ranged";
  for (const w of attacker.weapons) {
    if (!w.enabled || w.count <= 0) continue;
    if (w.kind !== phaseKind) continue;
    const ec = evalContext(attacker, defender, w, scenario, active.flags);
    const mods = new ModifierSet();
    const unitEffects = allEffects.filter((e) => !switchedOff(e.source));
    mods.addAll(collectModifiers(unitEffects.filter((e) => (e.when.side ?? "attacker") === "attacker"), "attacker", ec));
    mods.addAll(collectModifiers(unitEffects.filter((e) => e.when.side === "defender"), "defender", ec));
    const kctx: KeywordContext = { ...ec, mods, targetModelCount: defenderModelCount, warnings };
    const unknown = registry.apply(w.keywords, kctx);
    for (const u of unknown) warnings.push(`${w.name}: keyword "${u}" is not modelled.`);

    // --- hit ---
    const autoHit = mods.flag(CH.autoHit);
    const psychic = mods.flag(CH.psychic);
    const ignoresCover = mods.flag(CH.ignoresCover);
    // Indirect Fire at a target the firing unit cannot see. 11e answers with Snap Shooting. 10e
    // answers with -1 to the Hit roll and the Benefit of Cover, which is roughly a third as harsh,
    // so the two editions cannot share one reading of it.
    const indirectUnseen = mods.flag(CH.indirect) && ec.flags.has("target-not-visible");
    const indirectPenalty = indirectUnseen && !rules.indirectNotVisibleSnap;
    if (indirectPenalty) mods.add({ channel: CH.hitRoll, op: "add", value: -1, source: "Indirect Fire" });
    const cover = mods.flag(CH.stealth) || indirectPenalty;
    const inCover = (ctx.inCover || cover) && w.kind === "ranged" && !ignoresCover;
    let skillPenalty = 0;
    if (inCover && rules.coverAsSkillPenalty) skillPenalty += 1;
    const skillAdds = mods.list(CH.skill).filter((m) => m.op === "add").map((m) => Number(m.value));
    for (const v of skillAdds) skillPenalty += v;
    let hitRollMod = 0;
    if (psychic) {
      // ignore penalties, keep buffs
      skillPenalty = Math.min(0, skillAdds.filter((v) => v < 0).reduce((s, v) => s + v, 0));
      const pos = mods.list(CH.hitRoll).filter((m) => m.op === "add" && Number(m.value) > 0).reduce((s, m) => s + Number(m.value), 0);
      hitRollMod = Math.min(rules.hitRollCap, pos);
    } else {
      hitRollMod = mods.num(CH.hitRoll, 0, POLICY[CH.hitRoll]);
    }
    const snap = ctx.snapShooting || (indirectUnseen && rules.indirectNotVisibleSnap);
    const target = w.skill === null ? null : Math.max(2, Math.min(7, w.skill + skillPenalty));
    const critHit = mods.num(CH.critHit, 6, POLICY[CH.critHit]);
    const hitOpts = { target: target === 7 ? null : target, rollMod: hitRollMod, critThreshold: critHit, snap, reroll: snap ? null : mods.reroll(CH.rerollHit) };
    const hit = autoHit ? { pMiss: 0, pHit: 1, pCrit: 0 } : hitGate(hitOpts);
    const subHit = mods.substitute(CH.hitRoll);
    const fixedHit = subHit !== null && !autoHit ? (["miss", "hit", "crit"] as const)[classifyHit(Math.max(1, Math.min(6, subHit)), hitOpts)] : undefined;
    if (!autoHit && target === 7 && !snap) warnings.push(`${w.name}: BS/WS worse than 6+ — only unmodified 6s hit.`);

    // --- wound ---
    const S = mods.num(CH.strength, w.S);
    const Tmod = mods.num(CH.toughness, T);
    const wt = woundTarget(S, Tmod);
    const woundMod = mods.num(CH.woundRoll, 0, POLICY[CH.woundRoll]);
    const critWound = mods.num(CH.critWound, 6, POLICY[CH.critWound]);
    const woundOpts = { target: wt, rollMod: woundMod, critThreshold: critWound, reroll: mods.reroll(CH.rerollWound) };
    const wound = woundGate(woundOpts);
    const subWound = mods.substitute(CH.woundRoll);
    const fixedWound = subWound !== null ? (["fail", "wound", "crit"] as const)[classifyWound(Math.max(1, Math.min(6, subWound)), woundOpts)] : undefined;
    const devastating = mods.flag(CH.devastating);
    const lethalAvailable = mods.flag(CH.lethal);
    const sustained = sustainedPMF(mods.has(CH.sustained) ? (mods.list(CH.sustained).at(-1)?.value ?? null) : null);

    // --- per group: save + damage ---
    const ap = mods.num(CH.ap, w.AP, POLICY[CH.ap]);
    const saveMod = mods.num(CH.saveRoll, 0, POLICY[CH.saveRoll]);
    const fnpChannel = mods.has(CH.fnp) ? mods.num(CH.fnp, 0, POLICY[CH.fnp]) : 0;
    const gparams: GroupParams[] = groups.map((g) => {
      const m = g.model;
      const coverBonus = inCover && rules.coverAsSaveBonus && !(m.Sv <= 3 && ap === 0) ? 1 : 0;
      const armourTarget = mods.num(CH.save, m.Sv) + ap - coverBonus;
      let inv: number | null = m.InvSv ?? null;
      if (mods.has(CH.invuln)) {
        const v = mods.num(CH.invuln, inv ?? 7, POLICY[CH.critWound]);
        inv = v >= 7 ? inv : inv === null ? v : Math.min(inv, v);
      }
      const pu = pUnsaved({ armourTarget, invulnTarget: inv, rollMod: saveMod, reroll: mods.reroll(CH.rerollSave), sixAlwaysSaves: rules.sixAlwaysSaves });
      const fnp = m.fnp ?? (fnpChannel >= 2 && fnpChannel <= 6 ? fnpChannel : null);
      const dmg = damagePMF(w.D, mods, fnp);
      const mortal = rules.damageModsApplyToDevastating ? dmg : damagePMF(w.D, new ModifierSet(), fnp);
      return { pUnsaved: pu, damage: dmg, mortalDamage: mortal };
    });

    // --- lethal hits choice ---
    let lethal = false;
    if (lethalAvailable) {
      if (!rules.lethalOptional || ctx.lethalChoice === "always") lethal = true;
      else if (ctx.lethalChoice === "never") lethal = false;
      else {
        const first = gparams[0] ?? { pUnsaved: 1, damage: delta(1), mortalDamage: delta(1) };
        const eDmg = mean(first.damage);
        const eMortal = mean(first.mortalDamage);
        const lethalValue = first.pUnsaved * eDmg;
        const rollValue = wound.pWound * first.pUnsaved * eDmg + wound.pCrit * (devastating ? eMortal : first.pUnsaved * eDmg);
        lethal = lethalValue >= rollValue;
      }
    }

    const attackBonus = mods.rawAdd(CH.attacks);
    const hazardous = mods.flag(CH.hazardous);
    weapons.push({
      name: w.name,
      count: w.count,
      attacks: attacksPMF(w.A, attackBonus),
      hit,
      autoHit,
      sustained,
      lethal,
      wound,
      devastating,
      singleRerollHit: !snap && mods.oneDieReroll(CH.rerollHit),
      singleRerollWound: mods.oneDieReroll(CH.rerollWound),
      groups: gparams,
      ...(fixedHit ? { fixedHit } : {}),
      ...(fixedWound ? { fixedWound } : {}),
      precision: mods.flag(CH.precision) && groups.some((g) => g.target.isCharacter),
      selfMortalsPerWeapon: hazardous ? rules.hazardousFailProb * (attackerBigModel ? rules.hazardousMortalsBigModel : rules.hazardousMortals) : 0,
    });
  }
  if (!weapons.length) warnings.push(`No enabled ${phaseKind} weapons for the ${ctx.phase} phase.`);

  // weapon order: heuristic = highest expected per-weapon damage first (rough: mean attacks × count × E[dmg] × hit × wound)
  if (ctx.weaponOrder === "heuristic") {
    const score = (w: WeaponParams) => w.count * mean(w.attacks) * (1 - w.hit.pMiss) * (1 - w.wound.pFail) * mean(w.groups[0]?.damage ?? delta(1));
    weapons.sort((a, b) => score(b) - score(a));
  }

  const input: EngineInput = {
    weapons,
    groups: groups.map((g) => g.target),
    allocation: ctx.allocationPolicy === "in-order" ? "in-order" : "protect-character",
    backend: ctx.backend,
    mcIterations: ctx.mcIterations,
    // Every sampled run in the app draws from this same stream, which is what makes two sampled runs
    // comparable. The What-if deltas, the matrix cells and the efficiency rows are all differences
    // between runs that differ in one input, and running them against the same dice cancels most of
    // the sampling noise out of the difference: measured over 600 seeds, the spread of a What-if
    // delta is 24% to 72% smaller than it would be with a fresh stream each time, and it helps most
    // on the small changes that are hardest to resolve. Giving each run its own seed would leave
    // every individual answer just as good and make the comparisons between them markedly worse.
    seed: 1234,
    ...(opts.initialState ? { initialState: opts.initialState } : {}),
  };
  const out = groups.length ? run(input) : null;
  const coverageA = coverageFor(attacker, snapshot);
  const coverageD = coverageFor(defender, snapshot);
  const coverage = {
    tier1: coverageA.tier1 + coverageD.tier1,
    tier2: coverageA.tier2 + coverageD.tier2,
    tier3: coverageA.tier3 + coverageD.tier3,
    unmodelled: [...coverageA.unmodelled, ...coverageD.unmodelled],
  };
  const empty = { damagePMF: [1], slainPMF: [1], pAtLeastSlain: [1], expectedDamage: 0, expectedSlain: 0, pKill: 0, expectedWasted: 0, expectedSelfMortals: 0, expectedPointsSlain: 0, weapons: [] as never[], warnings: [] as string[], backend: "exact" as const };
  const o = out ?? empty;
  const result: SimResult = {
    backend: o.backend,
    ...("iterations" in o && o.iterations !== undefined ? { iterations: o.iterations } : {}),
    ...("ciHalfWidth" in o && o.ciHalfWidth !== undefined ? { ciHalfWidth: o.ciHalfWidth } : {}),
    damagePMF: o.damagePMF,
    slainPMF: o.slainPMF,
    expectedDamage: o.expectedDamage,
    expectedSlain: o.expectedSlain,
    pKill: o.pKill,
    pAtLeastSlain: o.pAtLeastSlain,
    damagePercentiles: percentiles(o.damagePMF),
    slainPercentiles: percentiles(o.slainPMF),
    expectedWasted: o.expectedWasted,
    expectedSelfMortals: o.expectedSelfMortals,
    weapons: o.weapons.map((t) => ({ ...t, trace: [] })),
    ...(attacker.points !== undefined ? { attackerPoints: attacker.points } : {}),
    ...(defender.points !== undefined ? { defenderPoints: defender.points } : {}),
    ...(attacker.points ? { damagePerPoint: o.expectedDamage / attacker.points } : {}),
    pointsSlain: o.expectedPointsSlain,
    coverage,
    warnings: [...warnings, ...o.warnings],
    ...("finalState" in o && o.finalState ? { finalState: o.finalState } : {}),
  };
  return result;
}
