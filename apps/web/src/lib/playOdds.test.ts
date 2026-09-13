import { describe, expect, it } from "vitest";
import type { Roster, Snapshot } from "@grimstat/schema";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { runScenario } from "@grimstat/game-40k-11e";
import { rosterHostEntries } from "./unitSet";
import { applyDamage, atStrength, NEW_UNIT_STATE, type UnitState } from "./game";
import { newScenario } from "./scenario";
import { idleReason } from "../hooks/useSimulation";

/**
 * The unit the odds panel actually solves with, built the way the Play page builds it: a roster
 * unit resolved against a snapshot, then scaled down to the models still alive.
 *
 * The hand-built units in game.test.ts cover the arithmetic. This covers the chain, because the
 * throw this guards against happened between the steps rather than inside one: `atStrength` emptied
 * a model group, and `newScenario` rejected the group while the panel was rendering.
 */

const snapshot: Snapshot = loadSyntheticSnapshot();
const now = "2026-09-13T10:00:00.000Z";

// A ten-model squad with a character attached, which is the case that resolved to three model
// groups and lost two of them on the way down.
const squad = {
  id: "u1",
  datasheetId: "ds:ashen-wardens:warden-squad",
  models: [
    { modelProfileId: "mp:ashen-wardens:warden-squad:warden-sergeant", count: 1, wargear: ["Flux carbine"] },
    { modelProfileId: "mp:ashen-wardens:warden-squad:warden", count: 9, wargear: ["Flux carbine"] },
  ],
  isWarlord: false,
};
const captain = {
  id: "u2",
  datasheetId: "ds:ashen-wardens:warden-captain",
  models: [{ modelProfileId: "mp:ashen-wardens:warden-captain:warden-captain", count: 1, wargear: [] }],
  attachedTo: { unitId: "u1", role: "leader" as const },
  isWarlord: true,
};

const roster: Roster = {
  id: "r",
  ownerId: "local",
  createdAt: now,
  updatedAt: now,
  revision: 0,
  name: "t",
  gameSystemId: snapshot.gameSystemId,
  snapshotId: snapshot.id,
  factionId: "faction:ashen-wardens",
  battleSize: "strike-force",
  pointsLimit: 2000,
  detachments: [],
  units: [squad, captain],
};

/** PlayPage's own reading of a resolved unit: wounds of the most numerous model, and the size. */
function bulk(unit: { models: { count: number; W: number }[] }): { profileWounds: number; models: number } {
  const models = unit.models.reduce((s, m) => s + m.count, 0);
  const lead = unit.models.reduce<{ count: number; W: number } | undefined>((best, m) => (!best || m.count > best.count ? m : best), undefined);
  return { profileWounds: lead?.W ?? 1, models: Math.max(1, models) };
}

const host = rosterHostEntries(roster, snapshot)[0]!;
const { profileWounds, models } = bulk(host.unit);
const current = (state: UnitState) => atStrength(host.unit, state, models);

describe("the unit the odds panel solves with", () => {
  it("resolves to a led squad of eleven across three model groups", () => {
    expect(models).toBe(11);
    expect(host.unit.models.map((m) => m.count)).toEqual([1, 9, 1]);
    expect(host.unit.models.filter((m) => m.isCharacter)).toHaveLength(1);
  });

  it("still solves when one model is left, with the character the survivor", () => {
    // Ten of the eleven gone.
    const hurt = applyDamage(NEW_UNIT_STATE, 10 * profileWounds, profileWounds, models);
    const unit = current(hurt);

    // Building the scenario is what used to throw, so it comes before the shape assertions.
    const scenario = newScenario({ attacker: unit, defender: host.unit });
    expect(idleReason(scenario)).toBeUndefined();
    expect(runScenario(scenario, { snapshot }).expectedDamage).toBeGreaterThan(0);

    expect(unit.models.map((m) => m.count)).toEqual([1]);
    expect(unit.models[0]?.isCharacter).toBe(true);
  });

  it("reads as nothing left once the unit is destroyed", () => {
    const dead = applyDamage(NEW_UNIT_STATE, 999, profileWounds, models);
    const unit = current(dead);

    // The panel picks a destroyed unit on either side, so both idle messages are reachable.
    expect(idleReason(newScenario({ defender: unit, attacker: host.unit }))).toBe("no-models");
    expect(idleReason(newScenario({ attacker: unit, defender: host.unit }))).toBe("no-weapons");

    expect(unit.models).toEqual([]);
  });
});
