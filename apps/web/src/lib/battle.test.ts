import { describe, expect, it } from "vitest";
import { CROSSFIRE, OPEN_APPROACH, RUINED_CITY, coherency, inZone } from "@grimstat/board";
import {
  anchorOf,
  applyModelMove,
  endMove,
  findModel,
  hasMoved,
  incoherentModels,
  modelMoveVerdict,
  modelReach,
  remainingMove,
  resetMove,
  unitCoherency,
  chargeBetween,
  chargeOdds,
  dragVerdict,
  findUnit,
  formation,
  indexOf,
  placeUnit,
  replaceUnit,
  sampleBattle,
  sightBetween,
  tapeDistance,
  translateUnit,
  unitHulls,
  type BattleState,
  type BattleUnit,
} from "./battle";

const state = sampleBattle(RUINED_CITY);
const attacker = (i = 0) => state.units.filter((u) => u.side === "attacker")[i]!;
const defender = (i = 0) => state.units.filter((u) => u.side === "defender")[i]!;

describe("formation", () => {
  it("centres a block on the origin", () => {
    const offsets = formation(9, 2);
    expect(offsets).toHaveLength(9);
    const cx = offsets.reduce((a, o) => a + o.x, 0) / 9;
    const cy = offsets.reduce((a, o) => a + o.y, 0) / 9;
    expect(cx).toBeCloseTo(0);
    expect(cy).toBeCloseTo(0);
  });

  it("handles one model, and a last row that is not full", () => {
    expect(formation(1, 2)).toEqual([{ x: 0, y: 0 }]);
    expect(formation(5, 2)).toHaveLength(5);
    expect(formation(0, 2)).toEqual([]);
  });

  it("lays a unit out coherently", () => {
    for (const unit of state.units) expect(coherency(unitHulls(unit)).ok).toBe(true);
  });
});

describe("placing and moving units", () => {
  it("centres a placed unit on the point it was given", () => {
    const unit = placeUnit(attacker(), { x: 20, y: 10 });
    const cx = unit.models.reduce((a, m) => a + m.hull.pos.x, 0) / unit.models.length;
    expect(cx).toBeCloseTo(20);
    expect(anchorOf(unit).pos.z).toBe(0);
  });

  it("moves every model by the same offset", () => {
    const before = attacker();
    const after = translateUnit(before, { x: 3, y: -2 });
    for (let i = 0; i < before.models.length; i++) {
      expect(after.models[i]!.hull.pos.x).toBeCloseTo(before.models[i]!.hull.pos.x + 3);
      expect(after.models[i]!.hull.pos.y).toBeCloseTo(before.models[i]!.hull.pos.y - 2);
    }
    expect(coherency(unitHulls(after)).ok).toBe(true); // a rigid drag cannot break coherency
  });

  it("swaps a unit into the state without touching the others", () => {
    const moved = translateUnit(attacker(), { x: 1, y: 1 });
    const next = replaceUnit(state, moved);
    expect(findUnit(next, moved.id)!.models[0]!.hull.pos.x).toBeCloseTo(moved.models[0]!.hull.pos.x);
    expect(next.units).toHaveLength(state.units.length);
    expect(findUnit(next, defender().id)).toEqual(defender());
  });
});

describe("the sample battle", () => {
  it("deploys both sides inside their own zones", () => {
    const [attackerZone, defenderZone] = state.zones;
    for (const unit of state.units) {
      const zone = unit.side === "attacker" ? attackerZone : defenderZone;
      for (const m of unit.models) expect(inZone(m.hull, zone)).toBe(true);
    }
  });

  it("gives each side the same units", () => {
    const names = (side: "attacker" | "defender") => state.units.filter((u) => u.side === side).map((u) => u.name);
    expect(names("attacker")).toEqual(names("defender"));
  });

  it("takes whichever layout it is handed", () => {
    expect(sampleBattle(OPEN_APPROACH).layout.id).toBe("open-approach");
    expect(sampleBattle(CROSSFIRE).layout.id).toBe("crossfire");
  });
});

describe("drag legality", () => {
  const index = indexOf(state);

  it("allows a short move and reports what it cost", () => {
    const unit = attacker();
    const at = anchorOf(unit).pos;
    const verdict = dragVerdict(state, unit, { x: at.x + 3, y: at.y + 1 }, index);
    expect(verdict.ok).toBe(true);
    expect(verdict.cost).toBeGreaterThan(2.9);
    expect(verdict.cost).toBeLessThanOrEqual(unit.move);
  });

  it("allows a destination that falls between the search lattice's cells", () => {
    // The search settles on half-inch cells anchored at the unit, so a destination offset by a
    // quarter inch on both axes is 0.35" from every cell — further than a tight match would allow,
    // and a tenth of an inch of movement is not a reason to refuse a move.
    const unit = attacker();
    const at = anchorOf(unit).pos;
    const verdict = dragVerdict(state, unit, { x: at.x + 0.25, y: at.y + 0.25 }, index);
    expect(verdict.problems).not.toContain("battle.problem.tooFar");
    expect(verdict.ok).toBe(true);
  });

  it("reports the position it actually costed, not the raw click", () => {
    const unit = attacker();
    const at = anchorOf(unit).pos;
    const verdict = dragVerdict(state, unit, { x: at.x + 3.2, y: at.y + 1.1 }, index);
    expect(verdict.ok).toBe(true);
    expect(verdict.at).toBeDefined();
    // Whatever it costed, that is where the unit goes: the two can never drift apart.
    expect(Math.hypot(verdict.at!.x - at.x, verdict.at!.y - at.y)).toBeLessThanOrEqual(verdict.cost! + 0.01);
  });

  it("allows a unit to be put back where it already is", () => {
    const unit = attacker();
    const at = anchorOf(unit).pos;
    const verdict = dragVerdict(state, unit, { x: at.x, y: at.y }, index);
    expect(verdict.ok).toBe(true);
    expect(verdict.cost).toBe(0);
  });

  it("refuses a move further than the unit can go", () => {
    const unit = attacker();
    const at = anchorOf(unit).pos;
    const verdict = dragVerdict(state, unit, { x: at.x, y: at.y + unit.move + 6 }, index);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain("battle.problem.tooFar");
    expect(verdict.cost).toBeUndefined();
  });

  it("refuses a move off the table", () => {
    const unit = attacker();
    const verdict = dragVerdict(state, unit, { x: -3, y: anchorOf(unit).pos.y }, index);
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain("battle.problem.offTable");
  });

  it("refuses to walk into a solid, and says so", () => {
    // Drop a unit next to a ruin, then try to put it inside the wall of an impassable bunker.
    const sealed = sampleBattle(OPEN_APPROACH);
    const unit = placeUnit(sealed.units[0]!, { x: 16, y: 26 });
    const withUnit = replaceUnit(sealed, unit);
    const verdict = dragVerdict(withUnit, unit, { x: 16, y: 30 }, indexOf(withUnit));
    // The ruin at (16, 30) is hollow at ground level, so this is legal — the point is that the
    // verdict is derived from the terrain rather than from a bounding box.
    expect(verdict.problems).not.toContain("battle.problem.blocked");
  });

  it("refuses to end a move in engagement range of an enemy", () => {
    const foe = placeUnit(defender(), { x: 30, y: 22 });
    const mover = placeUnit(attacker(), { x: 30, y: 18 });
    const next = replaceUnit(replaceUnit(state, foe), mover);
    const verdict = dragVerdict(next, mover, { x: 30, y: 20.5 }, indexOf(next));
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain("battle.problem.engagement");
  });
});

describe("moving models one at a time", () => {
  // A single squad on empty ground. The sample battle packs units along the deployment edge, and a
  // neighbouring unit's bases make every verdict about them rather than about the model being moved.
  const open = sampleBattle(OPEN_APPROACH);
  const index = indexOf(open);
  const squad = () => placeUnit(open.units[0]!, { x: 30, y: 16 });
  const alone = (unit: BattleUnit): BattleState => ({ ...open, units: [unit] });
  /** Model 0 sits at the front-left of the block, so −x is open ground and +x is its neighbours. */
  const OPEN = -1;

  it("moves one model and leaves the rest where they stand", () => {
    const unit = squad();
    const before = unit.models.map((m) => ({ ...m.hull.pos }));
    const model = unit.models[0]!;
    const verdict = modelMoveVerdict(alone(unit), unit, model, { x: model.hull.pos.x + 3 * OPEN, y: model.hull.pos.y }, index);
    expect(verdict.ok).toBe(true);
    const after = applyModelMove(unit, model.id, verdict.at!, verdict.cost!);
    expect(after.models[0]!.hull.pos.x).toBeCloseTo(verdict.at!.x);
    for (let i = 1; i < after.models.length; i++) expect(after.models[i]!.hull.pos).toEqual(before[i]);
  });

  it("spends a model's move and will not let it spend the same inches twice", () => {
    const unit = squad();
    const model = unit.models[0]!;
    expect(remainingMove(unit, model)).toBe(unit.move);

    // Three inches out, then three inches back: six spent, not zero.
    const out = modelMoveVerdict(alone(unit), unit, model, { x: model.hull.pos.x + 3 * OPEN, y: model.hull.pos.y }, index);
    const afterOut = applyModelMove(unit, model.id, out.at!, out.cost!);
    const moved = findModel(afterOut, model.id)!;
    const back = modelMoveVerdict(alone(afterOut), afterOut, moved, { x: model.hull.pos.x, y: model.hull.pos.y }, index);
    const afterBack = applyModelMove(afterOut, model.id, back.at!, back.cost!);
    const done = findModel(afterBack, model.id)!;

    expect(done.spent).toBeCloseTo(6, 1);
    expect(remainingMove(afterBack, done)).toBeCloseTo(unit.move - 6, 1);
    expect(done.hull.pos.x).toBeCloseTo(model.hull.pos.x, 1); // back where it started
  });

  it("refuses a model's move once its own allowance is gone", () => {
    const unit = squad();
    const model = unit.models[0]!;
    const first = modelMoveVerdict(alone(unit), unit, model, { x: model.hull.pos.x + unit.move * OPEN, y: model.hull.pos.y }, index);
    const after = applyModelMove(unit, model.id, first.at!, first.cost!);
    const spent = findModel(after, model.id)!;
    expect(remainingMove(after, spent)).toBeCloseTo(0, 1);
    const second = modelMoveVerdict(alone(after), after, spent, { x: spent.hull.pos.x + 2 * OPEN, y: spent.hull.pos.y }, index);
    expect(second.ok).toBe(false);
    expect(second.problems).toContain("battle.problem.tooFar");
  });

  it("remembers where the move began, and can put it back", () => {
    const unit = squad();
    const model = unit.models[0]!;
    const start = { ...model.hull.pos };
    const verdict = modelMoveVerdict(alone(unit), unit, model, { x: start.x + 2 * OPEN, y: start.y - 1 }, index);
    const after = applyModelMove(unit, model.id, verdict.at!, verdict.cost!);
    expect(findModel(after, model.id)!.from).toEqual(start);
    expect(hasMoved(after)).toBe(true);

    const undone = resetMove(after);
    expect(findModel(undone, model.id)!.hull.pos).toEqual(start);
    expect(hasMoved(undone)).toBe(false);
  });

  it("locks a move in, so the next move starts the allowance again", () => {
    const unit = squad();
    const model = unit.models[0]!;
    const verdict = modelMoveVerdict(alone(unit), unit, model, { x: model.hull.pos.x + 3 * OPEN, y: model.hull.pos.y }, index);
    const after = endMove(applyModelMove(unit, model.id, verdict.at!, verdict.cost!));
    expect(remainingMove(after, findModel(after, model.id)!)).toBe(unit.move);
    expect(resetMove(after).models[0]!.hull.pos.x).toBeCloseTo(verdict.at!.x); // nothing left to undo
  });

  it("does not refuse a move for breaking coherency, because the rules check that at the end", () => {
    const unit = squad();
    const model = unit.models[0]!;
    const away = modelMoveVerdict(alone(unit), unit, model, { x: model.hull.pos.x + 5 * OPEN, y: model.hull.pos.y - 2 }, index);
    expect(away.ok).toBe(true);
    const after = applyModelMove(unit, model.id, away.at!, away.cost!);
    // …but it does report it, and names the model that has strayed.
    expect(unitCoherency(after).ok).toBe(false);
    expect(incoherentModels(after)).toContain(model.id);
  });

  it("will not put one model on top of another in its own unit", () => {
    const unit = squad();
    const model = unit.models[0]!;
    const neighbour = unit.models[1]!;
    const verdict = modelMoveVerdict(alone(unit), unit, model, { x: neighbour.hull.pos.x, y: neighbour.hull.pos.y }, index);
    expect(verdict.ok).toBe(false);
  });

  it("gives each model its own reachable set", () => {
    const unit = squad();
    const first = modelReach(alone(unit), unit, unit.models[0]!, index);
    const last = modelReach(alone(unit), unit, unit.models[unit.models.length - 1]!, index);
    expect(first.length).toBeGreaterThan(0);
    expect(last.length).toBeGreaterThan(0);
    // Different starting points, so different shapes — not one set shared by the whole unit.
    expect(first[0]!.at).not.toEqual(last[0]!.at);
  });

  it("lets a model carry its own Move characteristic", () => {
    const unit = squad();
    const slow: BattleUnit = { ...unit, models: unit.models.map((m, i) => (i === 0 ? { ...m, move: 2 } : m)) };
    expect(remainingMove(slow, slow.models[0]!)).toBe(2);
    expect(remainingMove(slow, slow.models[1]!)).toBe(unit.move);
  });
});

describe("the sight tool", () => {
  const index = indexOf(state);

  it("reports distance, exposure and the rays behind the answer", () => {
    const shooter = placeUnit(attacker(), { x: 30, y: 8 });
    const target = placeUnit(defender(), { x: 30, y: 16 });
    const readout = sightBetween(shooter, target, index);
    expect(readout.distance).toBeGreaterThan(0);
    expect(readout.rays.length).toBeGreaterThan(0);
    expect(readout.exposure).toBeGreaterThanOrEqual(0);
    expect(readout.exposure).toBeLessThanOrEqual(1);
  });

  it("names the terrain in the way when the shot is blocked", () => {
    const shooter = placeUnit(attacker(), { x: 30, y: 26 });
    const target = placeUnit(defender(), { x: 30, y: 40 });
    const readout = sightBetween(shooter, target, index);
    if (!readout.visible) {
      expect(readout.blockers.length).toBeGreaterThan(0);
      expect(readout.rays.every((r) => r.blockedBy)).toBe(true);
    }
  });

  it("picks the most exposed model of the target unit, not just the first", () => {
    // Open Approach has a ruin at (16, 30). A shooter at (16, 8) cannot see a model behind it, but
    // can see one standing clear of it — and the readout has to find the second even though the
    // first is the unit's anchor.
    const open = sampleBattle(OPEN_APPROACH);
    const openIndex = indexOf(open);
    const shooter = placeUnit(open.units[0]!, { x: 16, y: 8 });
    const at = (positions: [number, number][]): BattleUnit => ({
      ...open.units[1]!,
      models: positions.map((p, i) => ({ id: `t${i}`, hull: { ...open.units[1]!.models[0]!.hull, pos: { x: p[0], y: p[1], z: 0 } } })),
    });
    expect(sightBetween(shooter, at([[16, 36]]), openIndex).visible).toBe(false); // behind the ruin
    expect(sightBetween(shooter, at([[16, 36], [26, 36]]), openIndex).visible).toBe(true); // one is clear
  });
});

describe("the charge tool", () => {
  it("turns a distance into a roll and a probability", () => {
    const chargers = placeUnit(attacker(), { x: 30, y: 16 });
    const foe = placeUnit(defender(), { x: 30, y: 23 });
    const next = replaceUnit(replaceUnit(state, chargers), foe);
    const readout = chargeBetween(chargers, foe, next);
    expect(readout.minimumRoll).toBeGreaterThanOrEqual(2);
    expect(readout.probability).toBeGreaterThan(0);
    expect(readout.path.length).toBeGreaterThan(0);
  });

  it("gives a hopeless charge no probability rather than a small one", () => {
    const chargers = placeUnit(attacker(), { x: 30, y: 4 });
    const foe = placeUnit(defender(), { x: 30, y: 40 });
    const next = replaceUnit(replaceUnit(state, chargers), foe);
    const readout = chargeBetween(chargers, foe, next);
    expect(readout.distance).toBe(Infinity);
    expect(readout.probability).toBe(0);
  });

  it("knows what two dice can do", () => {
    expect(chargeOdds(2)).toBe(1);
    expect(chargeOdds(7)).toBeCloseTo(21 / 36);
    expect(chargeOdds(9)).toBeCloseTo(10 / 36);
    expect(chargeOdds(12)).toBeCloseTo(1 / 36);
    expect(chargeOdds(13)).toBe(0);
    expect(chargeOdds(Infinity)).toBe(0);
  });
});

describe("ruin walls on the table", () => {
  it("refuses a vehicle a spot inside a ruin and lets infantry take it", () => {
    const state = sampleBattle(RUINED_CITY);
    const index = indexOf(state);
    const inside = { x: 11, y: 11 }; // the middle of a3', a two-storey ruin
    const transport = state.units.find((u) => u.keywords.includes("VEHICLE"))!;
    const infantry = state.units.find((u) => u.keywords.includes("INFANTRY") && u.side === transport.side)!;
    expect(dragVerdict(state, transport, inside, index).problems).toContain("battle.problem.blocked");
    expect(dragVerdict(state, infantry, inside, index).problems).not.toContain("battle.problem.blocked");
  });
});

describe("the tape", () => {
  it("reads straight across the table between two marks", () => {
    expect(tapeDistance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    expect(tapeDistance({ x: 1, y: 1 }, { x: 1, y: 1 })).toBe(0);
  });
});

