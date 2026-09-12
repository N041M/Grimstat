import type { SimResult } from "@grimstat/schema";
import { csvLine } from "./matrixCsv";

/**
 * The Calculator's result as CSV: the weapon breakdown first, a blank line, then the damage
 * distribution with both readings of the cumulative (at most / at least this much damage).
 * One file with two blocks, because a spreadsheet opens it as one sheet with both tables in view.
 */
export const WEAPON_CSV_HEADER = ["weapon", "count", "expected_attacks", "expected_hits", "expected_wounds", "expected_unsaved", "expected_damage"] as const;
export const DISTRIBUTION_CSV_HEADER = ["damage", "probability", "cumulative", "at_least"] as const;

export function resultToCsv(result: SimResult): string {
  const lines: string[] = [csvLine([...WEAPON_CSV_HEADER])];
  for (const w of result.weapons) lines.push(csvLine([w.name, w.count, round(w.expectedAttacks), round(w.expectedHits), round(w.expectedWounds), round(w.expectedUnsaved), round(w.expectedDamage)]));
  lines.push("");
  lines.push(csvLine([...DISTRIBUTION_CSV_HEADER]));
  const total = result.damagePMF.reduce((s, p) => s + p, 0);
  let below = 0;
  result.damagePMF.forEach((p, value) => {
    const atLeast = Math.max(0, total - below);
    below += p;
    lines.push(csvLine([value, round(p, 6), round(Math.min(1, below), 6), round(Math.min(1, atLeast), 6)]));
  });
  return `${lines.join("\r\n")}\r\n`;
}

/** "Bolters into marines" becomes "bolters-into-marines.csv"; an empty name falls back to "scenario". */
export function csvFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "");
  return `${slug || "scenario"}.csv`;
}

function round(n: number, digits = 3): number {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
