import { ModifierSet, collectModifiers, type EvalContext, type KeywordContext } from "@grimstat/effects";
import { run, percentiles, delta, mean, type EngineInput, type TargetGroup, type WeaponParams, type GroupParams } from "@grimstat/engine";
import type { Scenario, ScenarioModel, ScenarioUnit, ScenarioWeapon, SimResult, Snapshot } from "@grimstat/schema";
import { CH, POLICY } from "./channels";
import { create11eKeywordRegistry } from "./keywords";
import { RULES, type RulesParams } from "./manifest";
import { attacksPMF, classifyHit, classifyWound, damagePMF, hitGate, pUnsaved, sustainedPMF, woundGate, woundTarget } from "./attack";
import { activeToggleEffects, coverageFor, listToggles, resolveScenarioUnit, upper } from "./resolve";

/** The live 11e keyword registry. Other plugins may extend it via `registerKeyword` without editing this package. */
export const keywordRegistry = create11eKeywordRegistry(RULES);

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
    const perModel = defender.points && defender.models.length ? undefined : undefined;
    const g: Group = {
      target: { id: `${groups.length}`, name: m.name, models: m.count, wounds: m.W, isCharacter: m.isCharacter, ...(perModel !== undefined ? { pointsPerModel: perModel } : {}) },
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

export function runScenario(scenario: Scenario, opts: { snapshot?: Snapshot; initialState?: number[] } = {}): SimResult {
  return runScenarioWith(RULES, keywordRegistry, scenario, opts);
}

/** Edition-parametrised core: the same pipeline under a different `RulesParams` and keyword registry. */
export function runScenarioWith(rules: RulesParams, registry: ReturnType<typeof create11eKeywordRegistry>, scenario: Scenario, opts: { snapshot?: Snapshot; initialState?: number[] } = {}): SimResult {
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
  const defenderAllVehicleMonster = defender.keywords.some((k) => ["VEHICLE", "MONSTER"].includes(upper(k)));
  void defenderAllVehicleMonster;
  const attackerAllVM = attacker.keywords.some((k) => ["VEHICLE", "MONSTER"].includes(upper(k)));
  const defenderModelCount = defender.models.reduce((s, m) => s + m.count, 0);
  const allEffects = [...attacker.effects, ...defender.effects, ...active.effects, ...scenario.extraEffects];
  // ability toggles that were switched off must remove the unit's own effects with that source
  const off = new Set(scenario.enabledToggles.filter((t) => t.startsWith("-")).map((t) => t.slice(1)));
  const offSources = new Set(toggles.filter((t) => off.has(t.id) && t.id.startsWith("ability:")).map((t) => t.label));

  const weapons: WeaponParams[] = [];
  const phaseKind = ctx.phase === "fight" ? "melee" : "ranged";
  for (const w of attacker.weapons) {
    if (!w.enabled || w.count <= 0) continue;
    if (w.kind !== phaseKind) continue;
    const ec = evalContext(attacker, defender, w, scenario, active.flags);
    const mods = new ModifierSet();
    const unitEffects = allEffects.filter((e) => !(e.source && offSources.has(e.source)));
    mods.addAll(collectModifiers(unitEffects.filter((e) => (e.when.side ?? "attacker") === "attacker"), "attacker", ec));
    mods.addAll(collectModifiers(unitEffects.filter((e) => e.when.side === "defender"), "defender", ec));
    const kctx: KeywordContext = { ...ec, mods, targetModelCount: defenderModelCount, warnings };
    const unknown = registry.apply(w.keywords, kctx);
    for (const u of unknown) warnings.push(`${w.name}: keyword "${u}" is not modelled.`);

    // --- hit ---
    const autoHit = mods.flag(CH.autoHit);
    const psychic = mods.flag(CH.psychic);
    const ignoresCover = mods.flag(CH.ignoresCover);
    const stealth = mods.flag(CH.stealth);
    const inCover = (ctx.inCover || stealth) && w.kind === "ranged" && !ignoresCover;
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
    const snap = ctx.snapShooting || (mods.flag(CH.indirect) && ec.flags.has("target-not-visible"));
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
      selfMortalsPerWeapon: hazardous ? rules.hazardousFailProb * (attackerAllVM ? rules.hazardousMortalsVehicleMonster : rules.hazardousMortals) : 0,
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
