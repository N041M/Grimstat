import type { ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "./schema";
import { combineSampling, phaseFor } from "./analyses";
import type { AnalysisCore, AnalysisHost, RunSampling } from "./host";

/**
 * The exchange: what two units do to each other, in order.
 *
 * Every other analysis here fires one way. A player deciding whether to commit a unit is asking
 * something else — what is left of the enemy afterwards, and what those survivors do back — and the
 * answer to that is not the first number minus the second, because a unit that loses half its models
 * shoots back with half its guns.
 *
 * So the return fire is weighted over the whole distribution of casualties the first attack causes.
 * For each number of models the first attack removes, the survivors are put back on the table and
 * fired the other way, and the results are added up weighted by how likely that number was. A unit
 * wiped out shoots back with nothing, which the same sum accounts for.
 *
 * Nothing here reads a characteristic. Casualties come off the models that are not characters first,
 * largest group first, and a unit's weapons are reduced along with the models carrying them — which
 * is an assumption about who dies, and the screen that shows this says so.
 */

/** One side's half of the exchange. */
export interface ExchangeSide {
  name: string;
  points?: number | undefined;
  /** Expected damage dealt to the other side. */
  expectedDamage: number;
  /** Expected models of the other side removed. */
  expectedSlain: number;
  /** Chance of removing the other side outright. */
  pKill: number;
  /** Expected points of the other side removed, when it carries a points value. */
  pointsSlain?: number | undefined;
  /** Points removed per 100 points spent, when both sides carry a value. */
  pointsPer100?: number | undefined;
  sampling: RunSampling;
}

/** The prefix of the warning that says how much of the casualty spread was left out. */
export const TAIL_WARNING = "exchange.tail:";

export interface ExchangeResult {
  /** The unit that shoots first, and what it does. */
  first: ExchangeSide;
  /** What is left of the other unit, and what those survivors do back. */
  back: ExchangeSide;
  /**
   * Points each side removes, as a ratio of the first attacker's to the return. Above 1 the first
   * attacker comes out ahead. Absent when either unit carries no points value.
   */
  ratio?: number;
  /** How many runs the answer took: one forward and one per outcome of it. */
  runs: number;
  warnings: string[];
}

export interface ExchangeInput {
  first: ScenarioUnit;
  second: ScenarioUnit;
  context?: Partial<ScenarioContext>;
  enabledToggles?: string[];
  snapshot?: Snapshot;
  gameSystemId?: string;
}

/** Every model of a unit, characters included. */
const modelsIn = (unit: ScenarioUnit): number => unit.models.reduce((n, m) => n + m.count, 0);

/**
 * The unit with `casualties` models taken off it.
 *
 * The ordinary models go first and the largest group of them before the smaller ones, which is what
 * a player does: the sergeant and the character stand while the squad falls around them. Once they
 * are all gone the characters go too, because a count of casualties that reaches the whole unit has
 * reached the whole unit.
 *
 * A unit's weapons are not tied to its model groups in a scenario, so they are reduced in
 * proportion to the models still standing, never below one while any model is. That last part is
 * what keeps a lone surviving character firing: measured against its squad it rounds to nothing.
 */
export function withCasualties(unit: ScenarioUnit, casualties: number): ScenarioUnit {
  const before = modelsIn(unit);
  const taken = Math.max(0, Math.min(before, Math.floor(casualties)));
  if (taken === 0) return unit;

  let left = taken;
  const order = unit.models.map((m, i) => ({ m, i })).sort((a, b) => Number(!!a.m.isCharacter) - Number(!!b.m.isCharacter) || b.m.count - a.m.count || a.i - b.i);
  const counts = new Map<number, number>();
  for (const { m, i } of order) {
    if (left <= 0) break;
    const off = Math.min(left, m.count);
    counts.set(i, m.count - off);
    left -= off;
  }
  const models = unit.models.map((m, i) => (counts.has(i) ? { ...m, count: counts.get(i)! } : m)).filter((m) => m.count > 0);

  const share = models.length === 0 ? 0 : (before - taken) / before;
  const weapons = unit.weapons.map((w) => {
    const count = share <= 0 ? 0 : Math.max(1, Math.round(w.count * share));
    return count === w.count ? w : { ...w, count: Math.min(w.count, count) };
  });

  return { ...unit, models, weapons };
}

export function createExchange(host: AnalysisHost<object>, core: AnalysisCore) {
  /**
   * One unit's attack on another, scored under the phase the attacker can actually act in.
   *
   * A unit resolved in the fight phase is taken to have charged, which is the convention the
   * efficiency ranking already scores melee units under: without it a melee unit's output is
   * measured with its charge bonuses switched off. A context that says either way is honoured.
   */
  function shoot(attacker: ScenarioUnit, defender: ScenarioUnit, input: ExchangeInput, edition: string): SimResult {
    const given = { ...(input.context ?? {}) };
    const ctx = phaseFor(attacker, given);
    const fighting = (ctx.phase ?? "shooting") === "fight";
    const full = { ...ctx, charged: given.charged ?? fighting };
    return host.runScenario(core.makeScenario(attacker, defender, full, input.enabledToggles ?? [], edition), { ...(input.snapshot ? { snapshot: input.snapshot } : {}) });
  }

  /** One run read into the shape both halves of an exchange are reported in, scaled by its weight. */
  function sideOf(r: SimResult, attacker: ScenarioUnit, defender: ScenarioUnit, weight: number): ExchangeSide {
    return {
      name: attacker.name,
      points: attacker.points,
      expectedDamage: r.expectedDamage * weight,
      expectedSlain: r.expectedSlain * weight,
      pKill: r.pKill * weight,
      ...(defender.points !== undefined ? { pointsSlain: (r.pointsSlain ?? 0) * weight } : {}),
      sampling: { backend: r.backend, ...(r.ciHalfWidth !== undefined ? { ciHalfWidth: r.ciHalfWidth * weight } : {}) },
    };
  }

  /**
   * Fire one unit at another, then fire what is left of the second one back.
   *
   * The return fire is the expected outcome over every number of casualties the first attack could
   * cause, weighted by how likely each is. Outcomes too unlikely to change the answer are dropped so
   * that a twenty-model squad does not cost twenty-one runs to answer. What is dropped is reported
   * as the weight the answer is missing.
   */
  function exchange(input: ExchangeInput): ExchangeResult {
    const edition = core.editionOf({ ...(input.snapshot ? { snapshot: input.snapshot } : {}), ...(input.gameSystemId ? { gameSystemId: input.gameSystemId } : {}) });
    const warnings: string[] = [];
    const forward = shoot(input.first, input.second, input, edition);
    const first = sideOf(forward, input.first, input.second, 1);

    // A profile with no weapons at all — the target archetypes are defensive profiles — has nothing
    // to answer with, and that is worth saying rather than reporting as a return of zero.
    if (input.second.weapons.every((w) => !w.enabled || w.count <= 0)) warnings.push("exchange.noReturn");

    // How many models of the second unit the first attack removes, and how likely each count is.
    const slain = forward.slainPMF ?? [];
    const back: ExchangeSide = { name: input.second.name, points: input.second.points, expectedDamage: 0, expectedSlain: 0, pKill: 0, sampling: { backend: forward.backend }, ...(input.first.points !== undefined ? { pointsSlain: 0 } : {}) };
    const samplings: RunSampling[] = [];
    let runs = 1;
    let accounted = 0;

    for (let k = 0; k < slain.length; k++) {
      const p = slain[k] ?? 0;
      // A tail this thin moves the answer by less than the rounding on screen.
      if (p < 0.0005) continue;
      accounted += p;
      const survivors = withCasualties(input.second, k);
      // Nothing left to shoot back with.
      if (!survivors.models.length || survivors.weapons.every((w) => !w.enabled || w.count <= 0)) continue;
      runs += 1;
      const part = sideOf(shoot(survivors, input.first, input, edition), survivors, input.first, p);
      back.expectedDamage += part.expectedDamage;
      back.expectedSlain += part.expectedSlain;
      back.pKill += part.pKill;
      if (back.pointsSlain !== undefined) back.pointsSlain += part.pointsSlain ?? 0;
      samplings.push(part.sampling);
    }

    if (accounted < 0.995) warnings.push(`${TAIL_WARNING}${(1 - accounted).toFixed(3)}`);
    if (samplings.length) back.sampling = combineSampling(samplings);
    for (const side of [first, back]) {
      const spent = side.points;
      if (spent && side.pointsSlain !== undefined) side.pointsPer100 = (side.pointsSlain / spent) * 100;
    }

    const result: ExchangeResult = { first, back, runs, warnings };
    if (first.pointsSlain !== undefined && back.pointsSlain !== undefined && back.pointsSlain > 0) result.ratio = first.pointsSlain / back.pointsSlain;
    return result;
  }

  return { exchange };
}
