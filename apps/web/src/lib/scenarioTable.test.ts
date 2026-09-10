import { describe, expect, it } from "vitest";
import { filterScenarios, nextSort, sortScenarios, type RowMetrics, type ScenarioRow } from "./scenarioTable";

const row = (id: string, name: string, att: string, def: string, updatedAt: string): ScenarioRow => ({ id, name, attacker: { name: att }, defender: { name: def }, updatedAt });

const items: ScenarioRow[] = [
  row("a", "Walker screen clear", "Bolt rifle squad", "Armoured walker", "2026-08-01T10:00:00.000Z"),
  row("b", "Anti-tank efficiency", "Heavy weapon team", "Armoured walker", "2026-08-03T10:00:00.000Z"),
  row("c", "Horde trade check", "Swarm infantry", "Bolt rifle squad", "2026-08-02T10:00:00.000Z"),
];

describe("filterScenarios", () => {
  it("returns everything for an empty or whitespace query", () => {
    expect(filterScenarios(items, "")).toHaveLength(3);
    expect(filterScenarios(items, "   ")).toHaveLength(3);
  });

  it("matches the scenario name case-insensitively", () => {
    expect(filterScenarios(items, "HORDE").map((s) => s.id)).toEqual(["c"]);
  });

  it("also matches attacker and defender names", () => {
    expect(filterScenarios(items, "heavy weapon").map((s) => s.id)).toEqual(["b"]);
    expect(filterScenarios(items, "armoured").map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("returns nothing when nothing matches, without mutating the input", () => {
    expect(filterScenarios(items, "zzz")).toEqual([]);
    expect(items).toHaveLength(3);
  });
});

describe("sortScenarios", () => {
  const metrics: Record<string, RowMetrics> = {
    a: { expectedDamage: 14.7, pKill: 0.18, per100: 7.5 },
    b: { expectedDamage: 9.2, pKill: 0.62, per100: 10.2 },
  };
  const metricsOf = (s: ScenarioRow) => metrics[s.id];

  it("sorts by name in both directions", () => {
    expect(sortScenarios(items, { key: "name", dir: "asc" }).map((s) => s.id)).toEqual(["b", "c", "a"]);
    expect(sortScenarios(items, { key: "name", dir: "desc" }).map((s) => s.id)).toEqual(["a", "c", "b"]);
  });

  it("sorts by edited timestamp", () => {
    expect(sortScenarios(items, { key: "edited", dir: "desc" }).map((s) => s.id)).toEqual(["b", "c", "a"]);
  });

  it("sorts by a lazily computed metric and keeps un-computed rows last in both directions", () => {
    expect(sortScenarios(items, { key: "dmg", dir: "desc" }, metricsOf).map((s) => s.id)).toEqual(["a", "b", "c"]);
    expect(sortScenarios(items, { key: "dmg", dir: "asc" }, metricsOf).map((s) => s.id)).toEqual(["b", "a", "c"]);
    expect(sortScenarios(items, { key: "kill", dir: "desc" }, metricsOf).map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("treats a missing per-100-points value as not computed", () => {
    const partial = (s: ScenarioRow): RowMetrics | undefined => (s.id === "a" ? { expectedDamage: 1, pKill: 0, per100: undefined } : metrics[s.id]);
    expect(sortScenarios(items, { key: "per100", dir: "desc" }, partial).map((s) => s.id)).toEqual(["b", "a", "c"]);
  });

  it("is stable for equal keys", () => {
    const same = [row("x", "same", "a", "d", "2026-01-01T00:00:00.000Z"), row("y", "same", "a", "d", "2026-01-01T00:00:00.000Z")];
    expect(sortScenarios(same, { key: "name", dir: "desc" }).map((s) => s.id)).toEqual(["x", "y"]);
  });
});

describe("nextSort", () => {
  it("flips the direction of the active column and picks a sensible default for a new one", () => {
    expect(nextSort({ key: "name", dir: "asc" }, "name")).toEqual({ key: "name", dir: "desc" });
    expect(nextSort({ key: "name", dir: "asc" }, "dmg")).toEqual({ key: "dmg", dir: "desc" });
    expect(nextSort({ key: "dmg", dir: "desc" }, "attacker")).toEqual({ key: "attacker", dir: "asc" });
  });
});
