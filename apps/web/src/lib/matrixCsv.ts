import type { MatrixResult } from "@grimstat/game-40k-11e";

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
