import type { ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import { combineSampling, editionOf, makeScenario, phaseFor, type RunSampling } from "./analysis";
import { runScenario } from "./scenario";

/** "What kills X?" — rank single units and small combinations by points against a threshold on a metric. */
export interface ReverseCandidate {
  id: string;
  unit: ScenarioUnit;
}

export interface ReverseInput {
  target: ScenarioUnit;
  candidates: ReverseCandidate[];
  metric: "pKill" | "expectedDamage" | "expectedSlain";
  threshold: number;
  context?: Partial<ScenarioContext>;
  snapshot?: Snapshot;
  /** The edition to score under. Taken from the snapshot when one is given. See `editionOf`. */
  gameSystemId?: string;
  /** Largest combination size to try (1–3, default 2). */
  maxCombo?: number;
  enabledToggles?: string[];
}

export interface ReverseRow {
  candidateIds: string[];
  names: string[];
  /** Points of the combination, counting only the units that carry a value. See `priced`. */
  points: number;
  /** False when a unit in the combination has no points value, which makes `points` a partial sum. */
  priced: boolean;
  value: number;
  meets: boolean;
  expectedDamage: number;
  expectedSlain: number;
  pKill: number;
  /** Which backend produced the row. "mc" when any member of the combination was sampled. */
  backend: "exact" | "mc";
  /**
   * 95% half-width on `expectedDamage`. The members are fired in sequence and their damage is added,
   * so their half-widths are added too. `value` carries this interval only when the metric is
   * expected damage. The engine quotes no interval for a kill chance or a model count.
   */
  ciHalfWidth?: number;
}

export interface ReverseResult {
  rows: ReverseRow[];
  cheapest?: ReverseRow;
  evaluations: number;
  warnings: string[];
}

const MAX_COMBOS = 1500;

function* combinations<T>(items: T[], k: number, start = 0, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === k) {
    yield prefix;
    return;
  }
  for (let i = start; i < items.length; i++) yield* combinations(items, k, i + 1, [...prefix, items[i]!]);
}

export function reverseMathhammer(input: ReverseInput): ReverseResult {
  const warnings: string[] = [];
  const maxCombo = Math.max(1, Math.min(3, input.maxCombo ?? 2));
  const edition = editionOf(input);
  const cache = new Map<string, SimResult>();
  let evaluations = 0;
  const stateKey = (s: number[] | undefined) => {
    if (!s) return "-";
    let h = 0;
    for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + Math.round((s[i] ?? 0) * 1e6)) | 0;
    return `${s.length}:${h}`;
  };
  const run = (c: ReverseCandidate, initial: number[] | undefined): SimResult => {
    const k = `${c.id}|${stateKey(initial)}`;
    const hit = cache.get(k);
    if (hit) return hit;
    evaluations++;
    const scenario = makeScenario(c.unit, input.target, { ...phaseFor(c.unit, input.context ?? {}), backend: "exact" }, input.enabledToggles ?? [], edition);
    let r: SimResult;
    try {
      r = runScenario(scenario, { snapshot: input.snapshot, ...(initial ? { initialState: initial } : {}) });
    } catch {
      // The sampled backend carries a starting state too, and it has to be handed the same one. A run
      // without it fires into a fresh, undamaged target, so its damage was being added on top of what
      // the earlier members of the group had already done, and the group's kill chance came from a
      // unit shooting alone.
      r = runScenario(makeScenario(c.unit, input.target, { ...phaseFor(c.unit, input.context ?? {}), backend: "mc" }, input.enabledToggles ?? [], edition), { snapshot: input.snapshot, ...(initial ? { initialState: initial } : {}) });
      warnings.push(`${c.unit.name}: too many states to work out exactly, so this one is sampled.`);
    }
    cache.set(k, r);
    return r;
  };
  if (input.candidates.some((c) => c.unit.points === undefined)) warnings.push("Some candidates have no points value. They rank behind the ones that do.");
  const rows: ReverseRow[] = [];
  let combosTried = 0;
  let truncated = false;
  for (let k = 1; k <= maxCombo; k++) {
    for (const combo of combinations(input.candidates, k)) {
      if (combosTried >= MAX_COMBOS) {
        truncated = true;
        break;
      }
      combosTried++;
      let state: number[] | undefined;
      let dmg = 0;
      let slain = 0;
      let last: SimResult | null = null;
      const sampling: RunSampling[] = [];
      for (const c of combo) {
        const r = run(c, state);
        dmg += r.expectedDamage;
        slain += r.expectedSlain;
        state = r.finalState;
        last = r;
        sampling.push({ backend: r.backend, ...(r.ciHalfWidth !== undefined ? { ciHalfWidth: r.ciHalfWidth } : {}) });
      }
      // The combination's damage is a sum over its members, so the interval is their sum undivided.
      const combined = combineSampling(sampling);
      const pKill = last?.pKill ?? 0;
      const value = input.metric === "pKill" ? pKill : input.metric === "expectedSlain" ? slain : dmg;
      rows.push({
        candidateIds: combo.map((c) => c.id),
        names: combo.map((c) => c.unit.name),
        points: combo.reduce((s, c) => s + (c.unit.points ?? 0), 0),
        priced: combo.every((c) => c.unit.points !== undefined),
        value,
        meets: value >= input.threshold - 1e-9,
        expectedDamage: dmg,
        expectedSlain: slain,
        pKill,
        backend: combined.backend,
        ...(combined.ciHalfWidth !== undefined ? { ciHalfWidth: combined.ciHalfWidth } : {}),
      });
    }
    if (truncated) break;
  }
  if (truncated) warnings.push(`Stopped after ${MAX_COMBOS} combinations; narrow the candidate set or lower the combination size.`);
  // A combination whose cost is unknown ranks behind every fully priced one. Comparing the partial
  // sum instead sorted an unpriced unit in at zero points, ahead of the identical priced unit.
  const cheaper = (a: ReverseRow, b: ReverseRow) => (a.priced !== b.priced ? (a.priced ? -1 : 1) : a.points - b.points);
  rows.sort((a, b) => (a.meets !== b.meets ? (a.meets ? -1 : 1) : a.meets ? cheaper(a, b) || b.value - a.value : b.value - a.value || cheaper(a, b)));
  const cheapest = rows.find((r) => r.meets);
  return { rows, ...(cheapest ? { cheapest } : {}), evaluations, warnings: [...new Set(warnings)] };
}
