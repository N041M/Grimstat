/**
 * Filtering and sorting for the Scenarios table. Pure so the table can be exercised without a DOM
 * or the worker: the row metrics (E[dmg], P(kill), /100 pts) are computed lazily and may be absent,
 * and rows without them always sort last regardless of direction.
 */

export type ScenarioSortKey = "name" | "attacker" | "defender" | "dmg" | "kill" | "per100" | "edited";
export type SortDir = "asc" | "desc";

export interface RowMetrics {
  expectedDamage: number;
  pKill: number;
  /** Expected damage per 100 attacker points; absent when the attacker has no points value. */
  per100?: number | undefined;
}

/** The shape the table needs from a stored scenario. */
export interface ScenarioRow {
  id: string;
  name: string;
  attacker: { name: string };
  defender: { name: string };
  updatedAt: string;
}

export interface Sort {
  key: ScenarioSortKey;
  dir: SortDir;
}

/** Case-insensitive substring match over the scenario, attacker and defender names. */
export function filterScenarios<T extends ScenarioRow>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((s) => `${s.name} ${s.attacker.name} ${s.defender.name}`.toLowerCase().includes(q));
}

function metricValue(m: RowMetrics | undefined, key: ScenarioSortKey): number | undefined {
  if (!m) return undefined;
  if (key === "dmg") return m.expectedDamage;
  if (key === "kill") return m.pKill;
  if (key === "per100") return m.per100;
  return undefined;
}

/**
 * Stable sort by one column. Text columns compare with `localeCompare`; numeric columns use the
 * lazily computed metrics and push "not computed yet" rows to the end.
 */
export function sortScenarios<T extends ScenarioRow>(items: readonly T[], sort: Sort, metricsOf: (s: T) => RowMetrics | undefined = () => undefined): T[] {
  const sign = sort.dir === "asc" ? 1 : -1;
  const decorated = items.map((s, i) => ({ s, i }));
  decorated.sort((a, b) => {
    let d = 0;
    switch (sort.key) {
      case "name":
        d = a.s.name.localeCompare(b.s.name);
        break;
      case "attacker":
        d = a.s.attacker.name.localeCompare(b.s.attacker.name);
        break;
      case "defender":
        d = a.s.defender.name.localeCompare(b.s.defender.name);
        break;
      case "edited":
        d = a.s.updatedAt < b.s.updatedAt ? -1 : a.s.updatedAt > b.s.updatedAt ? 1 : 0;
        break;
      default: {
        const av = metricValue(metricsOf(a.s), sort.key);
        const bv = metricValue(metricsOf(b.s), sort.key);
        // Rows still waiting for the worker sink to the bottom in both directions.
        if (av === undefined && bv === undefined) d = 0;
        else if (av === undefined) return 1;
        else if (bv === undefined) return -1;
        else d = av - bv;
      }
    }
    return d === 0 ? a.i - b.i : d * sign;
  });
  return decorated.map((x) => x.s);
}

/** Clicking a header cycles that column: first click sorts descending for metrics, ascending for text. */
export function nextSort(current: Sort, key: ScenarioSortKey): Sort {
  if (current.key === key) return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  const numeric = key === "dmg" || key === "kill" || key === "per100" || key === "edited";
  return { key, dir: numeric ? "desc" : "asc" };
}
