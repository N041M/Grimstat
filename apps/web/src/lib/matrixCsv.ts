import type { EfficiencyRow, MatrixResult, ReverseResult } from "@grimstat/game-40k-11e";

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
