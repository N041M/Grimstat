import type { Scenario, ScenarioContext, ScenarioModel, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import { archetypes } from "./archetypes";
import { gameSystem } from "./manifest";
import { runScenario } from "./scenario";

const now = () => new Date().toISOString();

/** What an analysis scores under when nothing names an edition. */
export const DEFAULT_GAME_SYSTEM_ID = gameSystem.id;

/** Everything an analysis needs to pick an edition. Every entry point in this module accepts both. */
export interface EditionOpts {
  snapshot?: Snapshot;
  /** The edition to score under, for a caller with no snapshot to read it off. */
  gameSystemId?: string;
}

/**
 * Which edition an analysis scores under.
 *
 * A snapshot names its own game system, so an analysis run against one is scored under that
 * edition's rules and a 10th-edition army is no longer read as if it were an 11th-edition one.
 * `gameSystemId` overrides that for a caller holding no snapshot. Given neither, the analysis falls
 * back to 11th edition, which is the edition `makeScenario` stamps on an unnamed scenario.
 */
export function editionOf(opts: EditionOpts): string {
  return opts.gameSystemId ?? opts.snapshot?.gameSystemId ?? DEFAULT_GAME_SYSTEM_ID;
}

/** How a figure was worked out, and how wide its interval is. Every analysis row carries one. */
export interface RunSampling {
  /** "mc" when sampling produced the figure, so it carries sampling error. */
  backend: "exact" | "mc";
  /**
   * 95% confidence half-width on the figure, on the figure's own scale. Absent when no interval can
   * be quoted, which covers a figure solved exactly and a sampled one the engine declined to quote.
   */
  ciHalfWidth?: number;
}

/**
 * Combine the sampling of several runs into the sampling of one figure built from them.
 *
 * The half-widths are added and then divided by `divisor`. Pass the number of runs for a mean and 1
 * for a sum. Each half-width has to arrive on the combined figure's own scale, so a caller that
 * divides a run's damage by points scales that run's half-width the same way before handing it over.
 *
 * Adding the half-widths is deliberate. The root-sum-square is narrower, and it is only valid when
 * the runs' errors are independent. `scenario.ts` hardcodes one seed for every run in the app, which
 * is common random numbers and leaves the errors positively correlated. Measured, that shrinks the
 * spread of a paired difference by 41% to 92%. Under positive correlation the root-sum-square comes
 * out below the true spread, and an interval that reads narrower than the method can support is the
 * failure this field exists to prevent. The linear sum is an upper bound at any correlation.
 *
 * A run solved exactly adds nothing to the sum. A figure no contributing run quoted an interval for
 * gets none at all, so an exactly solved figure is never handed a half-width of zero, which would
 * read as "sampled, and certain". A sampled run whose samples all came out identical quotes no
 * interval either (see `ciHalfWidth` in the engine's Monte Carlo backend), and a figure built only
 * from runs like that is left without one for the same reason.
 */
export function combineSampling(parts: readonly RunSampling[], divisor = 1): RunSampling {
  let sum = 0;
  let quoted = false;
  let sampled = false;
  for (const p of parts) {
    if (p.backend === "mc") sampled = true;
    if (p.ciHalfWidth === undefined || !Number.isFinite(p.ciHalfWidth)) continue;
    sum += p.ciHalfWidth;
    quoted = true;
  }
  const backend = sampled ? ("mc" as const) : ("exact" as const);
  return quoted && divisor > 0 ? { backend, ciHalfWidth: sum / divisor } : { backend };
}

export function makeScenario(attacker: ScenarioUnit, defender: ScenarioUnit, context: Partial<ScenarioContext> = {}, enabledToggles: string[] = [], gameSystemId: string = DEFAULT_GAME_SYSTEM_ID): Scenario {
  return {
    id: "adhoc",
    ownerId: "local",
    createdAt: now(),
    updatedAt: now(),
    revision: 0,
    name: `${attacker.name} vs ${defender.name}`,
    gameSystemId,
    attacker,
    defender,
    context: {
      rangeBand: "full",
      charged: false,
      stationary: false,
      inCover: false,
      snapShooting: false,
      phase: "shooting",
      flags: [],
      allocationPolicy: "protect-character",
      lethalChoice: "auto",
      weaponOrder: "heuristic",
      mcIterations: 10000,
      backend: "auto",
      ...context,
    },
    enabledToggles,
    extraEffects: [],
  };
}

export interface MatrixCell {
  attacker: string;
  defender: string;
  result: SimResult;
  attackerPoints?: number | undefined;
  defenderPoints?: number | undefined;
  /** Expected damage per 100 attacker points, when known. */
  damagePer100?: number;
  /** Expected defender points destroyed per 100 attacker points. Absent when the defender has no points value. */
  pointsTradePer100?: number;
}

export interface MatrixResult {
  attackers: string[];
  defenders: string[];
  cells: MatrixCell[][]; // [attackerIndex][defenderIndex]
}

/**
 * Resolve an attacker in the phase where it can actually fight.
 *
 * A unit with no weapon for the requested phase would score a flat zero, which says nothing about
 * the unit; when it has weapons for the other phase, use that instead. An explicit phase is still
 * honoured whenever the unit can act in it.
 */
export function phaseFor(a: ScenarioUnit, context: Partial<ScenarioContext>): Partial<ScenarioContext> {
  const enabled = a.weapons.filter((w) => w.enabled && w.count > 0);
  if (!enabled.length) return context;
  const wanted = context.phase ?? "shooting";
  const kind = wanted === "fight" ? "melee" : "ranged";
  if (enabled.some((w) => w.kind === kind)) return context;
  return wanted === "fight" ? { ...context, phase: "shooting" } : { ...context, phase: "fight", charged: context.charged ?? true };
}

/** Many-vs-many: every attacker against every defender under one context. */
export function runMatrix(attackers: ScenarioUnit[], defenders: ScenarioUnit[], context: Partial<ScenarioContext> = {}, opts: EditionOpts & { enabledToggles?: string[] } = {}): MatrixResult {
  const edition = editionOf(opts);
  const cells = attackers.map((a) =>
    defenders.map((d) => {
      const result = runScenario(makeScenario(a, d, phaseFor(a, context), opts.enabledToggles ?? [], edition), { snapshot: opts.snapshot });
      delete result.finalState; // not needed for a matrix; keeps the payload small
      const cell: MatrixCell = { attacker: a.name, defender: d.name, result, attackerPoints: a.points, defenderPoints: d.points };
      if (a.points) {
        cell.damagePer100 = (result.expectedDamage / a.points) * 100;
        // The engine reports `pointsSlain` for every run and it is 0 for a defender that carries no
        // points value. The defender's own points are what tells a real zero from an unpriced target.
        if (d.points !== undefined) cell.pointsTradePer100 = ((result.pointsSlain ?? 0) / a.points) * 100;
      }
      return cell;
    }),
  );
  return { attackers: attackers.map((a) => a.name), defenders: defenders.map((d) => d.name), cells };
}

export interface DurabilityEntry {
  archetype: string;
  expectedDamage: number;
  pKill: number;
  /** Wounds the unit is expected to lose per 100 of its own points against this archetype (lower is tougher). */
  damageTakenPer100?: number;
  /** Which backend produced this entry. */
  backend: "exact" | "mc";
  /**
   * 95% half-width on `expectedDamage`. `damageTakenPer100` is that figure scaled by 100 / points,
   * and a caller that wants the interval on the per-100 column scales this by the same factor.
   */
  ciHalfWidth?: number;
}

const DEFAULT_ATTACKER_ARCHETYPES = ["bolter-squad", "lascannon-team", "melta-squad", "chainsword-mob"];

/** Durability profile: how a unit fares against a spread of attacker archetypes. */
export function durabilityProfile(defender: ScenarioUnit, opts: EditionOpts & { attackerIds?: string[]; context?: Partial<ScenarioContext> } = {}): DurabilityEntry[] {
  const ids = opts.attackerIds ?? DEFAULT_ATTACKER_ARCHETYPES;
  const edition = editionOf(opts);
  return ids.flatMap((id) => {
    const a = archetypes.find((x) => x.id === id);
    if (!a) return [];
    // `phaseFor` decides the phase from the weapons the archetype can actually fire. Testing the
    // weapon list for "every weapon is melee" put an archetype with no weapons at all into the
    // fight phase after a charge.
    const ctx = phaseFor(a.unit, { ...(opts.context ?? {}), phase: "shooting", rangeBand: "half" });
    const r = runScenario(makeScenario(a.unit, defender, ctx, [], edition), { snapshot: opts.snapshot });
    const e: DurabilityEntry = { archetype: a.name, expectedDamage: r.expectedDamage, pKill: r.pKill, backend: r.backend, ...(r.ciHalfWidth !== undefined ? { ciHalfWidth: r.ciHalfWidth } : {}) };
    if (defender.points) e.damageTakenPer100 = (r.expectedDamage / defender.points) * 100;
    return [e];
  });
}

export interface EfficiencyRow {
  unit: string;
  points?: number;
  /**
   * Mean expected damage across the target set, per 100 attacker points when every unit in the
   * ranking carries a points value and raw expected damage otherwise. `perPoints` says which.
   */
  damagePer100: number;
  /** True when `damagePer100` is denominated in points, so a screen can label the column. */
  perPoints: boolean;
  /** Per-target expected damage. */
  byTarget: Record<string, number>;
  /** Per-target expected *points* of the target destroyed. A target with no points value has no entry. */
  pointsByTarget: Record<string, number>;
  /** Which backend produced the row. "mc" when any of the target runs behind it was sampled. */
  backend: "exact" | "mc";
  /** 95% half-width on `damagePer100`, on that figure's own scale. See `combineSampling`. */
  ciHalfWidth?: number;
}

const DEFAULT_TARGETS = ["guardsman-like", "marine-like", "terminator-like", "light-vehicle", "heavy-tank"];

/** Rank attackers by damage per point across a set of target archetypes. */
export function efficiencyRanking(attackers: ScenarioUnit[], opts: EditionOpts & { targetIds?: string[]; context?: Partial<ScenarioContext>; perPoints?: boolean } = {}): EfficiencyRow[] {
  const targets = (opts.targetIds ?? DEFAULT_TARGETS).flatMap((id) => archetypes.find((a) => a.id === id)?.unit ?? []);
  const edition = editionOf(opts);
  // One scale for the whole ranking. A unit with no points value has no per-100-point figure, and
  // letting it contribute raw damage to the same column ranked it above the very same unit priced.
  //
  // A caller that ranks one set in two calls and merges the rows has to decide this across the whole
  // set, or the merged column mixes the two scales again. `perPoints` is how it says so.
  const perPoints = opts.perPoints ?? (attackers.length > 0 && attackers.every((a) => a.points !== undefined && a.points > 0));
  const rows = attackers.map((a) => {
    const byTarget: Record<string, number> = {};
    const pointsByTarget: Record<string, number> = {};
    const points = a.points;
    const sampling: RunSampling[] = [];
    let sum = 0;
    for (const t of targets) {
      const r = runScenario(makeScenario(a, t, phaseFor(a, opts.context ?? { rangeBand: "half" }), [], edition), { snapshot: opts.snapshot });
      byTarget[t.name] = r.expectedDamage;
      // The engine reports `pointsSlain` for every run and it is 0 for a target with no points
      // value. Read the target's own points instead, so a screen can dash the cell rather than
      // print a 0.00 that looks like an attack achieving nothing.
      if (t.points !== undefined) pointsByTarget[t.name] = r.pointsSlain ?? 0;
      sum += perPoints && points ? (r.expectedDamage / points) * 100 : r.expectedDamage;
      // The half-width goes onto the same scale as the figure it belongs to. A row denominated in
      // points has to carry an interval denominated in points, or the two cannot be printed together.
      const half = r.ciHalfWidth !== undefined ? (perPoints && points ? (r.ciHalfWidth / points) * 100 : r.ciHalfWidth) : undefined;
      sampling.push({ backend: r.backend, ...(half !== undefined ? { ciHalfWidth: half } : {}) });
    }
    // `damagePer100` is the mean over the targets, so its interval is the mean of theirs.
    const combined = combineSampling(sampling, targets.length || 1);
    const row: EfficiencyRow = { unit: a.name, damagePer100: targets.length ? sum / targets.length : 0, perPoints, byTarget, pointsByTarget, backend: combined.backend, ...(combined.ciHalfWidth !== undefined ? { ciHalfWidth: combined.ciHalfWidth } : {}) };
    if (a.points !== undefined) row.points = a.points;
    return row;
  });
  return rows.sort((x, y) => y.damagePer100 - x.damagePer100);
}

export interface DurabilityIndexRow {
  unit: string;
  points?: number;
  /** Expected attacker points needed to remove the unit, averaged over the attacker archetypes. */
  pointsToRemove: number;
  /** Per-archetype: expected attacker points needed to remove the unit. */
  byArchetype: Record<string, number>;
}

/** One attacker archetype's reading of a defender, per 100 of the *attacker's* points. */
export interface IncomingEntry {
  archetype: string;
  /** Points value of the attacking archetype (the denominator of the two rates). */
  attackerPoints: number;
  /** Wounds removed by one activation against the unit at full health. */
  expectedDamage: number;
  /** Models removed by one activation against the unit at full health. */
  expectedSlain: number;
  /** Expected activations to remove the unit; Infinity when the archetype cannot remove it. */
  activations: number;
  /**
   * False when the defender's state space was too large for the exact backend. `activations` is then
   * the one-activation extrapolation rather than the chained count.
   */
  exact: boolean;
  /** Wounds removed per 100 attacker points, over the whole engagement. */
  woundsPer100: number;
  /** Models removed per 100 attacker points, over the whole engagement. */
  slainPer100: number;
  /** Attacker points needed to remove the unit; Infinity when the archetype cannot remove it. */
  pointsToRemove: number;
  /** Which backend produced the first activation, which is where every figure here starts. */
  backend: "exact" | "mc";
  /** 95% half-width on `expectedDamage`, straight from that run. */
  ciHalfWidth?: number;
}

export interface IncomingFireRow extends DurabilityIndexRow {
  models: number;
  wounds: number;
  /**
   * Wounds removed per 100 attacker points, averaged over the archetypes. `pointsToRemove` is this
   * rate carried out to the unit's whole wound count, so the two readings always agree.
   */
  woundsPer100: number;
  /** Models removed per 100 attacker points, averaged over the archetypes. */
  slainPer100: number;
  /**
   * Raw wounds divided by the chance a single reference attack's damage sticks: the number of
   * reference attacks expected to remove the unit. Saves, invulnerable saves and Feel No Pain all
   * push it above the raw wound count. See `REFERENCE_ATTACK`.
   */
  effectiveWounds: number;
  entries: IncomingEntry[];
  /** Attacker archetypes left out of every figure here because they carry no points value. */
  unpriced: string[];
  /** Which backend produced the row. "mc" when any archetype's run was sampled. */
  backend: "exact" | "mc";
  /**
   * 95% half-width on `woundsPer100`, on that figure's own scale. `pointsToRemove` is the reciprocal
   * of the rate rather than a scaling of it, so this half-width does not carry over to it.
   */
  ciHalfWidth?: number;
}

/**
 * The attack profile "effective wounds" is measured against: a plain BS 3+, S4, AP 0, damage 1
 * shot with no keywords and no modifiers. It is deliberately generic. It is there to measure a unit
 * against a fixed yardstick, and it describes no weapon anyone fields.
 */
export const REFERENCE_ATTACK = { skill: 3, S: 4, AP: 0 } as const;
export type ReferenceAttack = { skill: number; S: number; AP: number };

/** A unit carrying one reference shot and nothing else. It exists to be fired at a defender. */
function referenceAttacker(ref: ReferenceAttack): ScenarioUnit {
  return {
    name: "Reference attack",
    keywords: [],
    models: [],
    weapons: [{ name: "Reference attack", count: 1, kind: "ranged", range: null, A: "1", skill: ref.skill, S: ref.S, AP: ref.AP, D: "1", keywords: [], enabled: true }],
    attached: [],
    effects: [],
  };
}

/**
 * Probability that one reference attack takes a wound off this model. 0 when nothing can get through.
 *
 * The shot is resolved by the engine against a single model of this profile, so the save it has to
 * beat is the save the engine would give it. An invulnerable save written into the profile and one
 * that arrives as ability text both count, and so does anything else on the unit that changes how an
 * incoming attack resolves. Pass the model's own unit as `host` for that. A model given on its own
 * is read from its profile alone.
 *
 * The reference shot does 1 damage to a model at full health, so no damage is ever wasted and the
 * damage the engine reports is the probability that the shot stuck.
 *
 * The edition changes the answer, because whether an unmodified 6 always saves is an edition rule.
 */
export function pReferenceSticks(m: ScenarioModel, ref: ReferenceAttack = REFERENCE_ATTACK, host?: ScenarioUnit, gameSystemId: string = DEFAULT_GAME_SYSTEM_ID): number {
  const bare: ScenarioUnit = { name: m.name, keywords: [], models: [], weapons: [], attached: [], effects: [] };
  const defender: ScenarioUnit = { ...(host ?? bare), models: [{ ...m, count: 1 }] };
  return runScenario(makeScenario(referenceAttacker(ref), defender, { phase: "shooting", rangeBand: "full", inCover: false, charged: false, backend: "exact" }, [], gameSystemId)).expectedDamage;
}

/**
 * Effective wounds of a unit: every model's wounds divided by the chance one reference attack
 * sticks, summed. A model nothing can get through contributes Infinity, so the unit's total is
 * Infinity too. The caller shows that as a dash.
 */
export function effectiveWounds(unit: ScenarioUnit, ref: ReferenceAttack = REFERENCE_ATTACK, gameSystemId: string = DEFAULT_GAME_SYSTEM_ID): number {
  let total = 0;
  for (const m of unit.models) {
    if (m.count <= 0) continue;
    const p = pReferenceSticks(m, ref, unit, gameSystemId);
    if (!(p > 0)) return Number.POSITIVE_INFINITY;
    total += (m.count * m.W) / p;
  }
  return total;
}

/** A chained run stops once the unit is this unlikely to still be standing. */
const ALIVE_TOLERANCE = 1e-6;
/**
 * Most activations one chain will run. A unit still standing at the cap contributes a geometric tail
 * estimated from the last two terms, so the cap bounds the work without cutting the answer short.
 */
const MAX_ACTIVATIONS = 250;

export interface RemovalChain {
  /** The first activation, fired at the unit at full health. */
  first: SimResult;
  /** Expected activations to remove the unit, or Infinity when the attacker cannot remove it. */
  activations: number;
  /** False when the defender's state space was too large for the exact backend to chain. */
  exact: boolean;
}

/**
 * Expected number of activations for one attacker to remove a unit, by firing it again at whatever
 * the activation before it left standing.
 *
 * The number of activations is a stopping time, so its expectation is the sum over k of the
 * probability that the unit is still standing after k activations. Each term comes from one exact
 * run started from the state distribution the run before it ended on. Scaling one activation's
 * damage up to the unit's wound count instead treats every point of damage as landing on a model
 * still standing, which ignores the overkill of the killing activation and understates the cost by
 * up to a third.
 *
 * Only the exact backend hands back a state to carry forward. When it cannot run, `exact` is false
 * and the caller falls back to the extrapolation.
 */
export function removalChain(scenario: Scenario, snapshot?: Snapshot): RemovalChain {
  const first = runScenario(scenario, { snapshot });
  if (!(first.expectedDamage > 1e-9)) return { first, activations: Number.POSITIVE_INFINITY, exact: true };
  let state = first.finalState;
  if (!state) return { first, activations: Number.POSITIVE_INFINITY, exact: false };
  // The unit always survives zero activations, so the first term of the sum is 1.
  let activations = 1;
  let alive = 1 - first.pKill;
  let previous = 1;
  for (let k = 1; k < MAX_ACTIVATIONS && alive > ALIVE_TOLERANCE; k++) {
    activations += alive;
    const r = runScenario(scenario, { snapshot, initialState: state });
    if (!r.finalState) return { first, activations: Number.POSITIVE_INFINITY, exact: false };
    state = r.finalState;
    previous = alive;
    alive = 1 - r.pKill;
  }
  if (alive > ALIVE_TOLERANCE) {
    // The survival probability settles into a geometric decay, so the remaining terms sum to
    // alive / (1 − ratio) at the ratio the last two terms show.
    const ratio = previous > 0 ? Math.min(alive / previous, 1 - 1e-9) : 0;
    activations += alive / (1 - ratio);
  }
  return { first, activations, exact: true };
}

/**
 * Incoming fire: what a spread of attacker archetypes does to each unit, as a rate (wounds and
 * models removed per 100 attacker points) and as an endpoint (`pointsToRemove`). `durabilityIndex`
 * is the endpoint-only view of the same runs.
 *
 * Each archetype is fired at the unit until the unit is gone, so its endpoint counts the points it
 * actually has to spend.
 */
export function incomingFire(defenders: ScenarioUnit[], opts: EditionOpts & { attackerIds?: string[]; context?: Partial<ScenarioContext>; reference?: ReferenceAttack } = {}): IncomingFireRow[] {
  const ids = opts.attackerIds ?? DEFAULT_ATTACKER_ARCHETYPES;
  const attackers = ids.flatMap((id) => archetypes.find((a) => a.id === id) ?? []);
  const edition = editionOf(opts);
  return defenders.map((d) => {
    const models = d.models.reduce((s, m) => s + m.count, 0);
    const totalWounds = d.models.reduce((s, m) => s + m.count * m.W, 0);
    const byArchetype: Record<string, number> = {};
    const entries: IncomingEntry[] = [];
    const rates: RunSampling[] = [];
    const unpriced: string[] = [];
    let woundRate = 0;
    let slainRate = 0;
    for (const a of attackers) {
      const pts = a.unit.points;
      // Standing an unpriced archetype in for a priced one denominates its rate and its endpoint in
      // an invented number. The archetype is left out and named in `unpriced` instead.
      if (pts === undefined || pts <= 0) {
        unpriced.push(a.name);
        continue;
      }
      // `phaseFor` decides the phase from the weapons the archetype can actually fire. Testing the
      // weapon list for "every weapon is melee" put an archetype with no weapons at all into the
      // fight phase after a charge.
      const ctx = phaseFor(a.unit, { ...(opts.context ?? {}), phase: "shooting", rangeBand: "half" });
      const chain = removalChain(makeScenario(a.unit, d, ctx, [], edition), opts.snapshot);
      const r = chain.first;
      const extrapolated = r.expectedDamage > 1e-9 ? totalWounds / r.expectedDamage : Number.POSITIVE_INFINITY;
      const activations = chain.exact ? chain.activations : extrapolated;
      const need = pts * activations;
      // The rates cover the whole engagement rather than the first activation. The unit loses every
      // wound it has over `need` attacker points, and its models come off at the share of that the
      // first activation measures. Reading them this way is what makes the casualty curve strip the
      // unit exactly where `pointsToRemove` says it does.
      const woundsPer100 = need > 0 && Number.isFinite(need) ? (totalWounds / need) * 100 : 0;
      const slainPer100 = r.expectedDamage > 1e-9 ? woundsPer100 * (r.expectedSlain / r.expectedDamage) : 0;
      byArchetype[a.name] = need;
      entries.push({ archetype: a.name, attackerPoints: pts, expectedDamage: r.expectedDamage, expectedSlain: r.expectedSlain, activations, exact: chain.exact, woundsPer100, slainPer100, pointsToRemove: need, backend: r.backend, ...(r.ciHalfWidth !== undefined ? { ciHalfWidth: r.ciHalfWidth } : {}) });
      // The rate's own interval, for the row to average. Where the chain could not run, `activations`
      // is the extrapolation and `woundsPer100` reduces to (expectedDamage / pts) × 100, so the run's
      // half-width carries onto the rate under that same factor. A chain that did run came off the
      // exact backend, which is the only one that hands back a state to carry forward, so it quotes
      // no interval to scale. The scaling is only applied on the path where it is exact.
      const rateHalf = !chain.exact && r.ciHalfWidth !== undefined ? (r.ciHalfWidth / pts) * 100 : undefined;
      rates.push({ backend: r.backend, ...(rateHalf !== undefined ? { ciHalfWidth: rateHalf } : {}) });
      woundRate += woundsPer100;
      slainRate += slainPer100;
    }
    const n = entries.length || 1;
    const woundsPer100 = woundRate / n;
    // The row's rate is the mean over the archetypes, so its interval is the mean of theirs.
    const combined = combineSampling(rates, n);
    const row: IncomingFireRow = {
      unit: d.name,
      // The archetypes are averaged as rates and the endpoint is read off that average. A plain mean
      // of "points needed" is dominated by the archetype that can barely hurt the unit. It put 70%
      // of a heavy tank's durability on the fact that bolters are bad against tanks, and an
      // archetype that cannot hurt the unit at all dropped out of it instead of counting as a rate
      // of zero. The casualty curve averages rates as well, so both readings now come out of the
      // same number. They used to disagree by as much as a factor of four on the same screen.
      pointsToRemove: woundsPer100 > 0 ? (totalWounds / woundsPer100) * 100 : Number.POSITIVE_INFINITY,
      byArchetype,
      models,
      wounds: totalWounds,
      woundsPer100,
      slainPer100: slainRate / n,
      effectiveWounds: effectiveWounds(d, opts.reference ?? REFERENCE_ATTACK, edition),
      entries,
      unpriced,
      backend: combined.backend,
      ...(combined.ciHalfWidth !== undefined ? { ciHalfWidth: combined.ciHalfWidth } : {}),
    };
    if (d.points !== undefined) row.points = d.points;
    return row;
  });
}

/**
 * Durability index: how many points of shooting (from the attacker archetypes) it takes, in
 * expectation, to remove the unit entirely. Higher is tougher.
 */
export function durabilityIndex(defenders: ScenarioUnit[], opts: EditionOpts & { attackerIds?: string[]; context?: Partial<ScenarioContext> } = {}): DurabilityIndexRow[] {
  return incomingFire(defenders, opts).map((r) => {
    const row: DurabilityIndexRow = { unit: r.unit, pointsToRemove: r.pointsToRemove, byArchetype: r.byArchetype };
    if (r.points !== undefined) row.points = r.points;
    return row;
  });
}
