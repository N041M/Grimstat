/**
 * The work counters the cost tests read. A cost test asserts that a count stays under a bound, and a
 * counter that stopped counting would pass every such test, so each counter is checked here to count
 * the work it names.
 */
import { describe, expect, it } from "vitest";
import { delta, dicePMF, engineWork, runExact, type EngineInput, type WeaponParams } from "./index";

/** Lethal Hits, Sustained Hits D3 and Devastating Wounds, so every per-hit table has two axes. */
const weapon = (count: number): WeaponParams => ({
  name: "w",
  count,
  attacks: dicePMF("D6"),
  hit: { pMiss: 0.33, pHit: 0.5, pCrit: 0.17 },
  autoHit: false,
  sustained: dicePMF("D3"),
  lethal: true,
  wound: { pFail: 0, pWound: 0.81, pCrit: 0.19 },
  devastating: true,
  singleRerollHit: false,
  singleRerollWound: false,
  precision: false,
  selfMortalsPerWeapon: 0,
  groups: [{ pUnsaved: 1 / 2, damage: delta(1), mortalDamage: delta(1) }],
});

const input = (count: number, models = 30): EngineInput => ({ weapons: [weapon(count)], groups: [{ id: "g", name: "g", models, wounds: 2, isCharacter: false }], allocation: "in-order", backend: "exact", mcIterations: 0, maxExactWork: 1e12 });

describe("the engine's work counters", () => {
  it("count the convolutions that build a two-axis table", () => {
    // The weapon rolls up to 246 attack dice. The compound stops once more dice are negligibly
    // likely, which here takes about 230 convolutions.
    const before = engineWork.convolutions;
    expect(runExact(input(41))).not.toBeNull();
    expect(engineWork.convolutions - before).toBeGreaterThan(100);
  });

  it("count a table build, a reachable-state build, an event and the states it reads", () => {
    const before = { ...engineWork };
    expect(runExact(input(43, 29))).not.toBeNull();
    expect(engineWork.tableBuilds - before.tableBuilds).toBeGreaterThan(0);
    expect(engineWork.reachBuilds - before.reachBuilds).toBeGreaterThan(0);
    expect(engineWork.events - before.events).toBeGreaterThan(0);
    expect(engineWork.stateVisits - before.stateVisits).toBeGreaterThanOrEqual(engineWork.events - before.events);
  });
});
