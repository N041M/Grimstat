import type { DurabilityEntry, EfficiencyRow, MatrixResult, ReverseResult, TurnPlanResult } from "@grimstat/game-40k-11e";

/** RFC 4180-style escaping: quote when the value contains a comma, quote, CR or LF. */
export function csvEscape(value: string | number | undefined): string {
  if (value === undefined) return "";
  const s = typeof value === "number" ? (Number.isFinite(value) ? String(value) : "") : value;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function csvLine(fields: Array<string | number | undefined>): string {
  return fields.map(csvEscape).join(",");
}

export const MATRIX_CSV_HEADER = ["attacker", "attacker_points", "defender", "defender_points", "expected_damage", "expected_slain", "p_kill", "damage_per_100pts", "points_traded_per_100pts", "expected_wasted", "backend"] as const;

/** Long-form CSV: one row per attacker × defender pair with every metric. */
export function matrixToCsv(matrix: MatrixResult): string {
  const lines = [csvLine([...MATRIX_CSV_HEADER])];
  matrix.cells.forEach((row, a) => {
    row.forEach((cell, d) => {
      const r = cell.result;
      lines.push(csvLine([matrix.attackers[a] ?? cell.attacker, r.attackerPoints, matrix.defenders[d] ?? cell.defender, r.defenderPoints, round(r.expectedDamage), round(r.expectedSlain), round(r.pKill, 4), round(cell.damagePer100), round(cell.pointsTradePer100), round(r.expectedWasted), r.backend]));
    });
  });
  return `${lines.join("\r\n")}\r\n`;
}

function round(n: number | undefined, digits = 3): number | undefined {
  if (n === undefined || !Number.isFinite(n)) return undefined;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export const EFFICIENCY_CSV_HEADER = ["rank", "unit", "points", "damage_per_100pts"] as const;

/** Target names in first-seen order; the ranking keys `byTarget` by target name. */
export function efficiencyTargets(rows: EfficiencyRow[]): string[] {
  const out: string[] = [];
  for (const r of rows) for (const k of Object.keys(r.byTarget)) if (!out.includes(k)) out.push(k);
  return out;
}

/** One row per ranked attacker; after the fixed columns, expected damage and target points destroyed per target. */
export function efficiencyToCsv(rows: EfficiencyRow[]): string {
  const targets = efficiencyTargets(rows);
  const lines = [csvLine([...EFFICIENCY_CSV_HEADER, ...targets.map((n) => `damage_vs_${n}`), ...targets.map((n) => `points_vs_${n}`)])];
  rows.forEach((r, i) => {
    lines.push(csvLine([i + 1, r.unit, r.points, round(r.damagePer100), ...targets.map((n) => round(r.byTarget[n])), ...targets.map((n) => round(r.pointsByTarget[n]))]));
  });
  return `${lines.join("\r\n")}\r\n`;
}

export const REVERSE_CSV_HEADER = ["rank", "units", "unit_count", "points", "meets_threshold", "cheapest", "p_kill", "expected_damage", "expected_slain"] as const;

/** One row per candidate combination in ranking order; `points` is blank when no unit in it has a cost. */
export function reverseToCsv(result: ReverseResult): string {
  const cheapest = result.cheapest?.candidateIds.join("|");
  const lines = [csvLine([...REVERSE_CSV_HEADER])];
  result.rows.forEach((r, i) => {
    lines.push(csvLine([i + 1, r.names.join(" + "), r.candidateIds.length, r.points || undefined, r.meets ? "yes" : "no", cheapest !== undefined && r.candidateIds.join("|") === cheapest ? "yes" : "no", round(r.pKill, 4), round(r.expectedDamage), round(r.expectedSlain)]));
  });
  return `${lines.join("\r\n")}\r\n`;
}

export const DURABILITY_CSV_HEADER = ["defender", "attacker", "expected_damage", "p_kill", "damage_taken_per_100pts"] as const;

/** One row per attacker archetype the defender was measured against, in the order it was run. */
export function durabilityToCsv(defender: string, entries: readonly DurabilityEntry[]): string {
  const lines = [csvLine([...DURABILITY_CSV_HEADER])];
  for (const e of entries) lines.push(csvLine([defender, e.archetype, round(e.expectedDamage), round(e.pKill, 4), round(e.damageTakenPer100)]));
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * What the turn CSV needs to turn the plan's ids back into the names the tab shows.
 *
 * Spelt out as the fields it reads rather than as the plugin's own types, so the tab can hand over
 * whatever it already has on screen and this stays a formatter with nothing to know about rules.
 */
export interface TurnCsvNames {
  attackers: ReadonlyArray<{ id: string; name: string; points?: number }>;
  targets: ReadonlyArray<{ id: string; name: string; points?: number }>;
  options: ReadonlyArray<{ id: string; label: string; cp: number }>;
}

export const TURN_PLAN_CSV_HEADER = ["order", "attacker", "attacker_points", "target", "target_points", "stratagem", "cp", "expected_damage", "expected_slain", "p_target_destroyed_after"] as const;
export const TURN_TARGET_CSV_HEADER = ["target", "target_points", "expected_damage", "expected_slain", "p_kill", "expected_points_slain", "expected_wasted"] as const;
export const TURN_TOTAL_CSV_HEADER = ["objective", "score", "cp_spent", "cp_budget", "expected_points_destroyed", "expected_models_slain", "expected_damage", "expected_wasted"] as const;

/**
 * A turn plan as three blocks in one file: what fires at what, how each target ends up, and the
 * totals the tab puts at the top. A spreadsheet opens the lot as one sheet, which is how the plan
 * is read — the assignment only means anything beside the target it was chosen for.
 */
export function turnPlanToCsv(result: TurnPlanResult, names: TurnCsvNames): string {
  const attacker = (id: string) => names.attackers.find((a) => a.id === id);
  const target = (id: string) => names.targets.find((t) => t.id === id);
  const option = (id: string | undefined) => (id ? names.options.find((o) => o.id === id) : undefined);

  const lines = [csvLine([...TURN_PLAN_CSV_HEADER])];
  for (const a of [...result.assignments].sort((x, y) => x.order - y.order)) {
    const o = option(a.optionId);
    lines.push(csvLine([a.order + 1, attacker(a.attackerId)?.name ?? a.attackerId, attacker(a.attackerId)?.points, target(a.targetId)?.name ?? a.targetId, target(a.targetId)?.points, o?.label, o?.cp, round(a.expectedDamage), round(a.expectedSlain), round(a.pKillAfter, 4)]));
  }

  lines.push("");
  lines.push(csvLine([...TURN_TARGET_CSV_HEADER]));
  for (const o of result.targets) {
    lines.push(csvLine([target(o.targetId)?.name ?? o.targetId, target(o.targetId)?.points, round(o.expectedDamage), round(o.expectedSlain), round(o.pKill, 4), round(o.expectedPointsSlain), round(o.expectedWasted)]));
  }

  lines.push("");
  lines.push(csvLine([...TURN_TOTAL_CSV_HEADER]));
  lines.push(csvLine([result.objective, round(result.score), result.cpSpent, result.cpBudget, round(result.totalExpectedPoints), round(result.totalExpectedSlain), round(result.totalExpectedDamage), round(result.totalExpectedWasted)]));

  return `${lines.join("\r\n")}\r\n`;
}
