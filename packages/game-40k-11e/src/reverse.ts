import type { ScenarioContext, ScenarioUnit, SimResult, Snapshot } from "@grimstat/schema";
import { makeScenario, phaseFor } from "./analysis";
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
  /** Largest combination size to try (1–3, default 2). */
  maxCombo?: number;
  enabledToggles?: string[];
}

export interface ReverseRow {
  candidateIds: string[];
  names: string[];
  points: number;
  value: number;
  meets: boolean;
  expectedDamage: number;
  expectedSlain: number;
  pKill: number;
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
    const scenario = makeScenario(c.unit, input.target, { ...phaseFor(c.unit, input.context ?? {}), backend: "exact" }, input.enabledToggles ?? []);
    let r: SimResult;
    try {
      r = runScenario(scenario, { snapshot: input.snapshot, ...(initial ? { initialState: initial } : {}) });
    } catch {
      r = runScenario(makeScenario(c.unit, input.target, { ...phaseFor(c.unit, input.context ?? {}), backend: "mc" }, input.enabledToggles ?? []), { snapshot: input.snapshot });
      warnings.push(`${c.unit.name}: exact chaining unavailable; used Monte Carlo.`);
    }
    cache.set(k, r);
    return r;
  };
  if (input.candidates.some((c) => c.unit.points === undefined)) warnings.push("Some candidates have no points value; they rank as 0 points.");
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
      for (const c of combo) {
        const r = run(c, state);
        dmg += r.expectedDamage;
        slain += r.expectedSlain;
        state = r.finalState;
        last = r;
      }
      const pKill = last?.pKill ?? 0;
      const value = input.metric === "pKill" ? pKill : input.metric === "expectedSlain" ? slain : dmg;
      rows.push({
        candidateIds: combo.map((c) => c.id),
        names: combo.map((c) => c.unit.name),
        points: combo.reduce((s, c) => s + (c.unit.points ?? 0), 0),
        value,
        meets: value >= input.threshold - 1e-9,
        expectedDamage: dmg,
        expectedSlain: slain,
        pKill,
      });
    }
    if (truncated) break;
  }
  if (truncated) warnings.push(`Stopped after ${MAX_COMBOS} combinations; narrow the candidate set or lower the combination size.`);
  rows.sort((a, b) => (a.meets !== b.meets ? (a.meets ? -1 : 1) : a.meets ? a.points - b.points || b.value - a.value : b.value - a.value || a.points - b.points));
  const cheapest = rows.find((r) => r.meets);
  return { rows, ...(cheapest ? { cheapest } : {}), evaluations, warnings: [...new Set(warnings)] };
}
