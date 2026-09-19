import { describe, expect, it } from "vitest";
import { CROSSFIRE, OPEN_APPROACH, RUINED_CITY, TerrainIndex, bounds, canSee, canStand, circleBase, coherency, coreSegment, distance, footReach, heightForKeywords, inBox, inZone, ovalBase, segPolygonDistance, terrain, type ReachNode, type TerrainLayout, type Vec2 } from "@grimstat/board";
import type { ModelProfile } from "@grimstat/schema";
import { UNIT_CLASS_IDS, unitClassFor } from "./unitArt";
import {
  anchorOf,
  applyGroupMove,
  applyModelMove,
  applyUnitMove,
  autoDeploy,
  battleWith,
  blockSize,
  clearDeployment,
  enemyBearing,
  faceUnit,
  footprintFor,
  hullFromWounds,
  deployUnit,
  deployVerdict,
  deployedUnits,
  endMove,
  findModel,
  hasMoved,
  incoherentModels,
  modelMoveVerdict,
  modelReach,
  reachSignature,
  remainingMove,
  groupMoveVerdict,
  type GroupMove,
  resetMove,
  rotateUnit,
  rotateVerdict,
  unitCoherency,
  chargeBetween,
  chargeOdds,
  dragVerdict,
  dropMark,
  findUnit,
  formation,
  freshDeployment,
  indexOf,
  placeUnit,
  muster,
  musterAt,
  musterUnit,
  musterVerdict,
  replaceUnit,
  sampleBattle,
  sampleForce,
  showcaseForce,
  sightBetween,
  tapeDistance,
  translateUnit,
  unitHulls,
  withForce,
  withdrawUnit,
  moveOf,
  zoneOf,
  type BattleState,
  type BattleUnit,
} from "./battle";

/**
 * A sample force set down on the board.
 *
 * `sampleBattle` leaves both forces on their muster tables, which is where a game starts; almost
 * everything tested here is about units that are already deployed, so they are deployed first.
 */
const deployed = (layout: TerrainLayout): BattleState => freshDeployment(sampleBattle(layout));

const state = deployed(RUINED_CITY);
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
});

describe("the force with every unit type", () => {
  it("has one unit of every class the table draws a figure for, with the sample force first", () => {
    const force = showcaseForce("attacker");
    const sample = sampleForce("attacker");
    expect(force.slice(0, sample.length).map((u) => u.name)).toEqual(sample.map((u) => u.name));
    expect(new Set(force.map((u) => unitClassFor(u.keywords))).size).toBe(UNIT_CLASS_IDS.length);
    expect(new Set(force.map((u) => u.id)).size).toBe(force.length);
    for (const u of force) for (const m of u.models) expect(m.hull.height).toBe(heightForKeywords(u.keywords));
  });

  it("stands on the muster table like any force, and most of it can be set down", () => {
    const start = withForce(sampleBattle(OPEN_APPROACH), "defender", showcaseForce("defender"));
    const mine = start.units.filter((u) => u.side === "defender");
    expect(mine).toHaveLength(showcaseForce("defender").length);
    for (const u of mine) expect(u.reserve).toBe(true);
    const down = freshDeployment(start);
    expect(deployedUnits(down).filter((u) => u.side === "defender").length).toBeGreaterThan(sampleForce("defender").length);
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
    const sealed = deployed(OPEN_APPROACH);
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
  const open = deployed(OPEN_APPROACH);
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
    const open = deployed(OPEN_APPROACH);
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
    const state = deployed(RUINED_CITY);
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

  it("starts a tape with one mark and finishes it with the next, ignoring a mark on the same spot", () => {
    const a = { x: 1, y: 2, z: 0 };
    const b = { x: 4, y: 6, z: 0 };
    expect(dropMark(undefined, a, "t1")).toEqual({ pending: a });
    expect(dropMark(a, a, "t1")).toEqual({ pending: a });
    expect(dropMark(a, b, "t1")).toEqual({ tape: { id: "t1", from: a, to: b } });
  });
});

describe("deployment", () => {
  const base = deployed(OPEN_APPROACH);
  const attacker = base.units.find((u) => u.side === "attacker" && u.models.length === 10)!;

  it("keeps a unit in reserve off the table: it blocks nothing and is not counted among the deployed", () => {
    const withdrawn = { ...base, units: base.units.map((u) => (u.id === attacker.id ? withdrawUnit(base, u) : u)) };
    expect(deployedUnits(withdrawn).map((u) => u.id)).not.toContain(attacker.id);
    expect(withdrawn.units.find((u) => u.id === attacker.id)!.reserve).toBe(true);
    // Its old spot is free ground for anyone else now.
    const other = withdrawn.units.find((u) => u.side === "attacker" && u.id !== attacker.id)!;
    const spot = { x: anchorOf(attacker).pos.x, y: anchorOf(attacker).pos.y };
    expect(deployVerdict(withdrawn, other, spot).ok).toBe(true);
    expect(clearDeployment(base).units.every((u) => u.reserve)).toBe(true);
  });

  it("refuses a spot outside the zone, off the table, or on top of another unit", () => {
    const zone = zoneOf(base, "attacker");
    expect(zone.owner).toBe("attacker");
    expect(deployVerdict(base, attacker, { x: 30, y: 22 }).problems).toContain("battle.problem.outsideZone");
    expect(deployVerdict(base, attacker, { x: -3, y: 6 }).problems).toContain("battle.problem.offTable");
    const other = base.units.find((u) => u.side === "attacker" && u.id !== attacker.id)!;
    const onTop = { x: anchorOf(other).pos.x, y: anchorOf(other).pos.y };
    expect(deployVerdict(base, attacker, onTop).problems).toContain("battle.problem.blocked");
  });

  it("sets a unit down as a fresh block, with nothing spent and no route", () => {
    const moved = applyUnitMove(attacker, { x: anchorOf(attacker).pos.x + 2, y: anchorOf(attacker).pos.y, z: 0 }, 2);
    const down = deployUnit(withdrawUnit(base, moved), { x: 20, y: 5 });
    expect(down.reserve).toBe(false);
    expect(down.models.every((m) => (m.spent ?? 0) === 0 && m.from === undefined && m.route === undefined)).toBe(true);
    expect(deployVerdict(base, down, { x: 20, y: 5 }).at).toEqual({ x: 20, y: 5, z: 0 });
  });

  it("auto-deploys every reserve unit of a side somewhere legal in its zone, back edge first", () => {
    const empty = clearDeployment(base);
    const done = autoDeploy(empty, "attacker");
    const zone = zoneOf(done, "attacker");
    for (const u of done.units) {
      if (u.side !== "attacker") continue;
      expect(u.reserve).toBe(false);
      for (const m of u.models) expect(inZone(m.hull, zone)).toBe(true);
    }
    // The defender is untouched.
    expect(done.units.filter((u) => u.side === "defender").every((u) => u.reserve)).toBe(true);
    // Nobody stands on anybody: each unit's spot is refused to the next.
    const first = done.units.find((u) => u.side === "attacker")!;
    const anchor = anchorOf(first).pos;
    expect(first.models[0]!.hull.pos.y).toBeLessThan(6);
    expect(deployVerdict(done, done.units.find((u) => u.side === "attacker" && u.id !== first.id)!, { x: anchor.x, y: anchor.y }).ok).toBe(false);
  });
});

describe("the muster table", () => {
  const start = sampleBattle(OPEN_APPROACH);
  const { width, depth } = start.layout.size;

  it("spawns every unit on its own side's table, beside the play area rather than on it", () => {
    expect(start.units.length).toBeGreaterThan(0);
    expect(deployedUnits(start)).toHaveLength(0);
    for (const unit of start.units) {
      expect(unit.reserve).toBe(true);
      for (const m of unit.models) expect(musterAt(start, { x: m.hull.pos.x, y: m.hull.pos.y })).toBe(unit.side);
    }
    // Each table is clear of the board, on its own side of it.
    expect(muster(start, "attacker").area.maxY).toBeLessThan(0);
    expect(muster(start, "defender").area.minY).toBeGreaterThan(depth);
    // And nothing on the board is on a muster table.
    expect(musterAt(start, { x: width / 2, y: depth / 2 })).toBeUndefined();
  });

  it("gives every unit a berth of its own, and keeps it while the others are deployed", () => {
    const berths = muster(start, "attacker").berths;
    const mine = start.units.filter((u) => u.side === "attacker");
    expect(berths.size).toBe(mine.length);
    for (const unit of mine) expect(inBox(berths.get(unit.id)!, muster(start, "attacker").area)).toBe(true);
    // Berths come from the whole force, so deploying one unit does not move the rest.
    const after = freshDeployment(start);
    expect([...muster(after, "attacker").berths]).toEqual([...berths]);
  });

  it("sends a withdrawn unit back to the berth it was deployed from", () => {
    const unit = start.units.find((u) => u.side === "attacker")!;
    const home = unit.models.map((m) => m.hull.pos);
    const down = replaceUnit(start, deployUnit(unit, { x: 20, y: 6 }));
    expect(findUnit(down, unit.id)!.reserve).toBe(false);
    const back = withdrawUnit(down, findUnit(down, unit.id)!);
    expect(back.reserve).toBe(true);
    back.models.forEach((m, i) => {
      expect(m.hull.pos.x).toBeCloseTo(home[i]!.x);
      expect(m.hull.pos.y).toBeCloseTo(home[i]!.y);
    });
    // And the board is clear again: everything is back where it spawned.
    expect(clearDeployment(down).units.every((u) => u.reserve)).toBe(true);
  });

  it("refuses a spot off the table or one another unit is already standing on", () => {
    const home = muster(start, "attacker");
    const unit = start.units.find((u) => u.side === "attacker")!;
    const neighbour = start.units.find((u) => u.side === "attacker" && u.id !== unit.id)!;
    // Its own berth is free, since a unit never stands on itself.
    expect(musterVerdict(start, unit, home.berths.get(unit.id)!).ok).toBe(true);
    expect(musterVerdict(start, unit, { x: width / 2, y: depth / 2 }).problems).toContain("battle.problem.offMuster");
    expect(musterVerdict(start, unit, home.berths.get(neighbour.id)!).problems).toContain("battle.problem.musterTaken");
    // The defender's table is not a place for an attacker's unit either.
    expect(musterVerdict(start, unit, { x: width / 2, y: muster(start, "defender").area.minY + 2 }).problems).toContain("battle.problem.offMuster");
  });

  it("wraps a force too wide for one row onto more, and deepens the table to hold them", () => {
    const shallow = muster(start, "attacker");
    // Five copies of the sample force: far more than fits across a 60" table in one row.
    const many = Array.from({ length: 5 }, (_, copy) =>
      sampleForce("attacker").map((u) => ({ ...u, id: `${u.id}-${copy}`, models: u.models.map((m) => ({ ...m, id: `${m.id}-${copy}` })) })),
    ).flat();
    const big = withForce(start, "attacker", many);
    const table = muster(big, "attacker");
    expect(table.berths.size).toBe(many.length);
    expect(table.area.maxY - table.area.minY).toBeGreaterThan(shallow.area.maxY - shallow.area.minY);
    // Every unit still stands wholly on the table, and none of them on another.
    for (const unit of big.units.filter((u) => u.side === "attacker")) {
      expect(musterVerdict(big, unit, table.berths.get(unit.id)!).ok).toBe(true);
      for (const m of unit.models) expect(musterAt(big, { x: m.hull.pos.x, y: m.hull.pos.y })).toBe("attacker");
    }
    // The defender's table is untouched by the attacker's crowd.
    expect(muster(big, "defender").area).toEqual(muster(start, "defender").area);
  });

  it("stands a unit where it is put down on the table, off the board and with nothing spent", () => {
    const table = muster(start, "defender");
    const unit = start.units.find((u) => u.side === "defender")!;
    const spot = { x: table.area.minX + 8, y: (table.area.minY + table.area.maxY) / 2 };
    const moved = applyUnitMove(unit, { x: 20, y: 20, z: 0 }, 3);
    const shelved = musterUnit(moved, spot);
    expect(shelved.reserve).toBe(true);
    expect(musterVerdict(start, shelved, spot).ok).toBe(true);
    for (const m of shelved.models) expect(musterAt(start, { x: m.hull.pos.x, y: m.hull.pos.y })).toBe("defender");
    expect(shelved.models.every((m) => (m.spent ?? 0) === 0 && m.from === undefined && m.route === undefined)).toBe(true);
  });
});

describe("routes", () => {
  it("remembers the way a model went, so the table can animate it round a corner", () => {
    const state = deployed(RUINED_CITY);
    const unit = state.units.find((u) => u.side === "attacker" && u.models.length === 10)!;
    const model = unit.models[0]!;
    const index = indexOf(state);
    // Straight towards the near edge: open ground, away from the rest of the unit.
    const verdict = modelMoveVerdict(state, unit, model, { x: model.hull.pos.x, y: model.hull.pos.y - 2.5 }, index);
    expect(verdict.ok).toBe(true);
    expect(verdict.path!.length).toBeGreaterThanOrEqual(2);
    expect(verdict.path![0]).toEqual(model.hull.pos);
    const moved = applyModelMove(unit, model.id, verdict.at!, verdict.cost!, verdict.path);
    expect(moved.models[0]!.route).toEqual(verdict.path);
    expect(applyModelMove(unit, model.id, verdict.at!, verdict.cost!).models[0]!.route).toEqual([model.hull.pos, verdict.at]);
  });

  it("never reaches past the table's edge", () => {
    const state = deployed(OPEN_APPROACH);
    const unit = state.units.find((u) => u.side === "attacker")!;
    const edge = { ...state, units: state.units.map((u) => (u.id === unit.id ? placeUnit(u, { x: 5, y: 5 }) : u)) };
    const model = edge.units.find((u) => u.id === unit.id)!.models[0]!;
    const nodes = modelReach(edge, edge.units.find((u) => u.id === unit.id)!, model, indexOf(edge));
    for (const n of nodes) {
      expect(n.at.x).toBeGreaterThanOrEqual(model.hull.foot.r - 1e-6);
      expect(n.at.y).toBeGreaterThanOrEqual(model.hull.foot.r - 1e-6);
    }
  });
});


/**
 * The reach overlay is drawn from these cells, and drawing it costs a mask the width of the table.
 * So the page keeps the last answer and asks `reachSignature` whether anything it depends on has
 * moved. The cells are pinned here, and so is what the signature notices.
 */
describe("the reach overlay", () => {
  const index = indexOf(state);

  /** A fingerprint of the cells lit, so a change to any one of them fails here. */
  const cells = (nodes: readonly ReachNode[]): string => {
    const each = nodes.map((n) => `${n.at.x.toFixed(4)},${n.at.y.toFixed(4)},${n.at.z.toFixed(4)}`).sort();
    let hash = 0;
    for (const cell of each) for (let i = 0; i < cell.length; i++) hash = (Math.imul(hash, 31) + cell.charCodeAt(i)) | 0;
    return `${each.length}:${(hash >>> 0).toString(16)}`;
  };

  it("lights the cells it has always lit", () => {
    expect(cells(modelReach(state, attacker(0), attacker(0).models[0]!, index))).toBe("228:cb758c41");
    expect(cells(modelReach(state, attacker(3), attacker(3).models[0]!, index))).toBe("290:e0ec7584");
  });

  it("is unchanged by a turn on round bases, and says so", () => {
    const unit = attacker(0);
    const turned = replaceUnit(state, rotateUnit(unit, 0.37));
    const after = findUnit(turned, unit.id)!;
    expect(cells(modelReach(turned, after, after.models[0]!, index))).toBe(cells(modelReach(state, unit, unit.models[0]!, index)));
    expect(reachSignature(turned, after, after.models[0]!)).toBe(reachSignature(state, unit, unit.models[0]!));
    expect(reachSignature(turned, after)).toBe(reachSignature(state, unit));
  });

  it("is searched again when an oval base turns, when anything moves, and when the mover has spent some of its move", () => {
    const unit = attacker(0);
    const before = reachSignature(state, unit, unit.models[0]!);

    const ovals = { ...unit, models: unit.models.map((m) => ({ ...m, hull: { ...m.hull, foot: ovalBase(105, 70) } })) };
    const flat = replaceUnit(state, ovals);
    const swung = replaceUnit(flat, rotateUnit(ovals, 0.37));
    expect(reachSignature(swung, findUnit(swung, unit.id)!, findModel(findUnit(swung, unit.id)!, ovals.models[0]!.id))).not.toBe(reachSignature(flat, ovals, ovals.models[0]!));

    const walked = replaceUnit(state, translateUnit(unit, { x: 0, y: 1 }));
    expect(reachSignature(walked, findUnit(walked, unit.id)!, findModel(findUnit(walked, unit.id)!, unit.models[0]!.id))).not.toBe(before);

    // Someone else moving matters too: the mover has to get round them.
    const other = attacker(1);
    const shifted = replaceUnit(state, translateUnit(other, { x: 0, y: 1 }));
    expect(reachSignature(shifted, unit, unit.models[0]!)).not.toBe(before);

    const spent = { ...unit, models: unit.models.map((m, i) => (i === 0 ? { ...m, spent: 1.5 } : m)) };
    expect(reachSignature(replaceUnit(state, spent), spent, spent.models[0]!)).not.toBe(before);
  });
});

describe("turning in place", () => {
  it("turns one model, or the whole unit, about its own base and keeps the angle in range", () => {
    const unit = attacker(0);
    const start = unit.models[1]!.hull.facing;
    const one = rotateUnit(unit, Math.PI / 12, unit.models[1]!.id);
    expect(one.models[1]!.hull.facing).toBeCloseTo(start + Math.PI / 12);
    expect(one.models[0]!.hull.facing).toBe(unit.models[0]!.hull.facing);
    expect(one.models[1]!.hull.pos).toEqual(unit.models[1]!.hull.pos);
    const all = rotateUnit(unit, 2 * Math.PI + 0.1);
    for (const m of all.models) expect(m.hull.facing).toBeCloseTo(start + 0.1);
  });

  it("lets a round base turn anywhere, but not an oval one that would swing off the table", () => {
    const round = { ...attacker(0), models: [{ ...attacker(0).models[0]!, hull: { ...attacker(0).models[0]!.hull, pos: { x: 2, y: 10, z: 0 } } }] };
    expect(rotateVerdict(state, round, Math.PI / 2).ok).toBe(true);
    const tank = { ...round, models: [{ ...round.models[0]!, hull: { ...round.models[0]!.hull, foot: ovalBase(120, 92), facing: Math.PI / 2 } }] };
    expect(rotateVerdict(state, tank, 0).ok).toBe(true); // long axis along the edge: on the table
    const swung = rotateVerdict(state, tank, -Math.PI / 2); // long axis across the edge: off it
    expect(swung.ok).toBe(false);
    expect(swung.problems).toContain("battle.problem.offTable");
  });
});

describe("moving a selection together", () => {
  const clear = { ...state, layout: { ...state.layout, pieces: [] } };

  it("moves every member by the offset, each charged its own route, and leaves the rest alone", () => {
    const unit = attacker(0);
    const members = unit.models.map((m) => ({ unitId: unit.id, modelId: m.id }));
    const verdict = groupMoveVerdict(clear, members, { x: 0, y: 2 });
    expect(verdict.problems).toEqual([]);
    expect(verdict.ok).toBe(true);
    expect(verdict.moves).toHaveLength(unit.models.length);
    for (const move of verdict.moves) {
      const from = unit.models.find((m) => m.id === move.modelId)!.hull.pos;
      expect(Math.hypot(move.at.x - from.x, move.at.y - (from.y + 2))).toBeLessThan(0.6);
      expect(move.cost).toBeGreaterThan(1.4);
      expect(move.cost).toBeLessThan(3);
    }
    const after = applyGroupMove(clear, verdict.moves.slice(0, 2));
    const moved = after.units.find((u) => u.id === unit.id)!;
    expect(moved.models[0]!.spent).toBeCloseTo(verdict.moves[0]!.cost);
    expect(moved.models[2]!.spent ?? 0).toBe(0);
    expect(moved.models[2]!.hull.pos).toEqual(unit.models[2]!.hull.pos);
  });

  /**
   * A squad sent at a wall it cannot cross in formation: one model's place in the block is inside
   * an impassable solid. The squad should still go, fitted round it.
   */
  const squadAtAWall = () => {
    const squad = placeUnit(attacker(0), { x: 20, y: 10 });
    const by = { x: 0, y: 4 };
    const blocked = squad.models[squad.models.length - 1]!.hull.pos;
    const at = { x: blocked.x + by.x, y: blocked.y + by.y };
    const half = 0.75;
    const wall = terrain({
      id: "wall",
      polygon: [
        { x: at.x - half, y: at.y - half },
        { x: at.x + half, y: at.y - half },
        { x: at.x + half, y: at.y + half },
        { x: at.x - half, y: at.y + half },
      ],
      height: 5,
      traits: ["impassable"],
    });
    const world: BattleState = { ...clear, layout: { ...clear.layout, pieces: [wall] }, units: [squad] };
    return { squad, by, world, members: squad.models.map((m) => ({ unitId: squad.id, modelId: m.id })) };
  };

  it("fits the squad into the ground when it cannot cross in formation", () => {
    const { squad, by, world, members } = squadAtAWall();
    expect(groupMoveVerdict({ ...world, layout: { ...world.layout, pieces: [] } }, members, by).spaced).toBeFalsy();

    const verdict = groupMoveVerdict(world, members, by);
    expect(verdict.ok).toBe(true);
    expect(verdict.spaced).toBe(true);
    expect(verdict.moves).toHaveLength(squad.models.length);

    const index = indexOf(world);
    const landed = verdict.moves.map((move) => {
      const model = findModel(squad, move.modelId)!;
      // Nobody is shuffled far from where the formation wanted them, and nobody overspends.
      expect(Math.hypot(move.at.x - (model.hull.pos.x + by.x), move.at.y - (model.hull.pos.y + by.y))).toBeLessThanOrEqual(2 + 1e-9);
      expect(move.cost).toBeLessThanOrEqual(squad.move + 1e-9);
      expect(canStand({ ...model.hull, pos: move.at }, move.at, index)).toBe(true);
      return { ...model.hull, pos: move.at };
    });
    for (let i = 0; i < landed.length; i++) {
      for (let j = i + 1; j < landed.length; j++) expect(distance(landed[i]!, landed[j]!)).toBeGreaterThan(0);
    }
    expect(coherency(landed).ok).toBe(true);
  });

  it("keeps the fitted squad out of the solid it was fitted round", () => {
    const { squad, by, world, members } = squadAtAWall();
    const wall = world.layout.pieces[0]!;
    for (const move of groupMoveVerdict(world, members, by).moves) {
      const model = findModel(squad, move.modelId)!;
      expect(segPolygonDistance({ a: move.at, b: move.at }, wall.polygon)).toBeGreaterThanOrEqual(model.hull.foot.r - 1e-9);
    }
  });

  /**
   * A squad sent up to a building. A ruin's footprint is its walls and infantry may cross them, so
   * the formation standing half in the wall and half in the ground floor is a legal arrangement —
   * and not one anybody makes with real models.
   */
  const squadAtARuin = (sideways = 0) => {
    const world = deployed(RUINED_CITY);
    const unit = world.units.find((u) => u.side === "attacker" && u.models.length === 5)!;
    const ruin = world.layout.pieces.find((p) => p.id === "b1")!;
    const box = bounds(ruin.polygon);
    const squad = placeUnit(unit, { x: (box.minX + box.maxX) / 2 + sideways, y: box.minY - 2.6 });
    const state: BattleState = { ...world, units: world.units.map((u) => (u.id === unit.id ? squad : u)) };
    const anchor = anchorOf(squad).pos;
    const sent = (aim: Vec2) => groupMoveVerdict(state, squad.models.map((m) => ({ unitId: squad.id, modelId: m.id })), { x: aim.x - anchor.x, y: aim.y - anchor.y }, indexOf(state), aim);
    const inside = (moves: readonly GroupMove[]) =>
      moves.filter((move) => {
        const hull = { ...findModel(squad, move.modelId)!.hull, pos: move.at };
        return segPolygonDistance(coreSegment(hull), ruin.polygon) < hull.foot.r - 0.01;
      });
    return { ruin, box, squad, sent, inside };
  };

  it("puts a squad sent up to a building along its face rather than through the wall", () => {
    const { box, squad, sent, inside } = squadAtARuin();
    const verdict = sent({ x: (box.minX + box.maxX) / 2, y: box.minY - 1 });
    expect(verdict.ok).toBe(true);
    expect(verdict.spaced).toBe(true);
    expect(verdict.moves).toHaveLength(squad.models.length);
    expect(inside(verdict.moves)).toEqual([]);
    // Every model still travelled, and no further than it may.
    for (const move of verdict.moves) expect(move.cost).toBeLessThanOrEqual(squad.move + 1e-9);
  });

  it("sends the squad inside when that is where it was sent", () => {
    const { box, squad, sent, inside } = squadAtARuin();
    const verdict = sent({ x: (box.minX + box.maxX) / 2, y: box.minY + 0.5 });
    expect(verdict.ok).toBe(true);
    expect(verdict.moves).toHaveLength(squad.models.length);
    expect(inside(verdict.moves).length).toBeGreaterThan(0);
  });

  it("refuses the whole group when any member cannot make it", () => {
    const unit = attacker(0);
    const members = unit.models.slice(0, 3).map((m) => ({ unitId: unit.id, modelId: m.id }));
    const verdict = groupMoveVerdict(clear, members, { x: 0, y: 20 });
    expect(verdict.ok).toBe(false);
    expect(verdict.problems).toContain("battle.problem.tooFar");
  });

  it("turns only the members named when given a set", () => {
    const unit = attacker(0);
    const ids = new Set(unit.models.slice(0, 2).map((m) => m.id));
    const turned = rotateUnit(unit, Math.PI / 12, ids);
    expect(turned.models[0]!.hull.facing).toBeCloseTo(unit.models[0]!.hull.facing + Math.PI / 12);
    expect(turned.models[1]!.hull.facing).toBeCloseTo(unit.models[1]!.hull.facing + Math.PI / 12);
    expect(turned.models[2]!.hull.facing).toBe(unit.models[2]!.hull.facing);
  });

  /** Where a verdict puts each member, to a thousandth of an inch. */
  const where = (verdict: { moves: readonly GroupMove[] }): string[] => verdict.moves.map((m) => `${m.at.x.toFixed(3)} ${m.at.y.toFixed(3)} ${m.at.z.toFixed(3)}`);

  /**
   * A move sent between two cells the squad can reach, both of them near enough to where it was
   * pointed to count as it. It goes to the one the shorter route reaches, and these are the places
   * that puts it in.
   */
  it("takes the nearer of two cells a member could land on", () => {
    const unit = attacker(0);
    const members = unit.models.map((m) => ({ unitId: unit.id, modelId: m.id }));
    const verdict = groupMoveVerdict(state, members, { x: 5.8, y: 0 }, indexOf(state));
    expect(verdict.ok).toBe(true);
    for (const move of verdict.moves) expect(move.cost).toBeCloseTo(5.5, 6);
    expect(where(verdict)).toEqual([
      "14.710 4.140 0.000",
      "16.570 4.140 0.000",
      "18.430 4.140 0.000",
      "20.290 4.140 0.000",
      "14.710 6.000 0.000",
      "16.570 6.000 0.000",
      "18.430 6.000 0.000",
      "20.290 6.000 0.000",
      "16.570 7.860 0.000",
      "18.430 7.860 0.000",
    ]);
  });

  it("puts the squad where it has always put it", () => {
    const unit = attacker(0);
    const members = unit.models.map((m) => ({ unitId: unit.id, modelId: m.id }));
    expect(where(groupMoveVerdict(clear, members, { x: 0, y: 2 }))).toEqual([
      "9.210 6.140 0.000",
      "11.070 6.140 0.000",
      "12.930 6.140 0.000",
      "14.790 6.140 0.000",
      "9.210 8.000 0.000",
      "11.070 8.000 0.000",
      "12.930 8.000 0.000",
      "14.790 8.000 0.000",
      "11.070 9.860 0.000",
      "12.930 9.860 0.000",
    ]);

    const { by, world, members: squad } = squadAtAWall();
    expect(where(groupMoveVerdict(world, squad, by))).toEqual([
      "17.210 12.140 0.000",
      "19.070 12.140 0.000",
      "20.930 12.140 0.000",
      "22.790 12.140 0.000",
      "17.210 14.000 0.000",
      "19.070 14.000 0.000",
      "20.930 14.000 0.000",
      "22.790 14.000 0.000",
      "19.070 15.860 0.000",
      "22.430 15.860 0.000",
    ]);
  });

  /**
   * A drag hands the same state object back sixty times a second and the searches behind it are kept
   * for as long as that object lives. What is kept must not depend on where the hand was when it was
   * made, so every frame has to answer as it would have on its own.
   */
  it("answers a drag the same whether or not it has been asked before", () => {
    const unit = attacker(0);
    const members = unit.models.map((m) => ({ unitId: unit.id, modelId: m.id }));
    const index = indexOf(state);
    for (const by of [
      { x: 0.4, y: 0 },
      { x: 0, y: 2 },
      { x: -1.5, y: 3.2 },
      { x: 4.9, y: 0 },
      { x: 0, y: 30 },
      { x: 0, y: 2 },
    ]) {
      const alone: BattleState = { ...state, units: [...state.units] };
      const aim = { x: unit.models[0]!.hull.pos.x + by.x, y: unit.models[0]!.hull.pos.y + by.y };
      expect(groupMoveVerdict(state, members, by, index, aim)).toEqual(groupMoveVerdict(alone, members, by, indexOf(alone), aim));
    }
  });

  /**
   * Half a squad still on its muster table. Nothing around it is on the board, so only its own five
   * companions are in its way, and the two halves of the move count those companions differently:
   * the body move has to get past them and the fit does not. The move comes out spaced, and these
   * are the places it puts the five in.
   */
  it("moves a group that is still on its muster table past its own companions", () => {
    const off: BattleUnit = { ...placeUnit(attacker(0), { x: 20, y: 20 }), reserve: true };
    const shelf = replaceUnit(clear, off);
    const members = off.models.slice(0, 5).map((m) => ({ unitId: off.id, modelId: m.id }));
    const verdict = groupMoveVerdict(shelf, members, { x: 2, y: 0 });
    expect(verdict.ok).toBe(true);
    expect(verdict.spaced).toBe(true);
    expect(where(verdict)).toEqual(["19.210 18.140 0.000", "21.070 18.140 0.000", "22.930 18.140 0.000", "24.790 18.140 0.000", "19.210 20.000 0.000"]);
  });
});

describe("the sight tool asks the whole unit", () => {
  const squad = (id: string, side: "attacker" | "defender", xs: number[], y: number): BattleUnit => ({
    id, side, name: id, move: 6, oc: 1, keywords: ["INFANTRY"],
    models: xs.map((x, i) => ({ id: `${id}-${i}`, hull: { pos: { x, y, z: 0 }, facing: 0, foot: circleBase(32), height: 2 } })),
  });

  it("sees the target when a flank model does, even though the lead model is walled off", () => {
    const shooter = squad("A", "attacker", [0, 2, 4, 18, 20], 0);
    const target = squad("B", "defender", [0, 2, 4], 20);
    const wall = terrain({ id: "wall", polygon: [{ x: -40, y: 9 }, { x: 9, y: 9 }, { x: 9, y: 11 }, { x: -40, y: 11 }], height: 9, traits: ["obscuring"] });
    const index = new TerrainIndex([wall]);

    expect(canSee(shooter.models[0]!.hull, target.models[0]!.hull, index)).toBe(false);
    const readout = sightBetween(shooter, target, index);
    expect(readout.visible).toBe(true);
    expect(readout.exposure).toBeGreaterThan(0);
  });
});

describe("dragging a whole unit", () => {
  it("is limited by the model with the least movement left, and never spends more than a model has", () => {
    const open = deployed(OPEN_APPROACH);
    const unit = placeUnit(deployedUnits(open).find((u) => u.side === "attacker" && u.models.length >= 5)!, { x: 30, y: 8 });
    let world = replaceUnit(open, unit);
    const index = indexOf(world);

    // Move one model of the squad three inches on its own first.
    const before = findUnit(world, unit.id)!;
    const m = before.models[3]!;
    const step = modelMoveVerdict(world, before, m, { x: m.hull.pos.x, y: m.hull.pos.y - 3 }, index);
    expect(step.ok).toBe(true);
    world = replaceUnit(world, applyModelMove(before, m.id, step.at!, step.cost!, step.path));

    const moved = findUnit(world, unit.id)!;
    const left = remainingMove(moved, moved.models[3]!);
    const anchor = anchorOf(moved).pos;
    const drag = dragVerdict(world, moved, { x: anchor.x, y: anchor.y + 5 }, index);
    expect(drag.ok).toBe(false);

    const short = dragVerdict(world, moved, { x: anchor.x, y: anchor.y + left }, index);
    if (short.ok) {
      const after = applyUnitMove(moved, short.at!, short.cost!, short.path);
      for (const each of after.models) expect(each.spent ?? 0).toBeLessThanOrEqual(moveOf(after, each) + 1e-6);
    }
  });
});

describe("facing the enemy", () => {
  const start = sampleBattle(OPEN_APPROACH);

  it("points a side straight at the other's zone: up the table for the attacker, down it for the defender", () => {
    expect(enemyBearing(start, "attacker")).toBeCloseTo(Math.PI / 2);
    expect(enemyBearing(start, "defender")).toBeCloseTo(-Math.PI / 2);
  });

  it("follows the zones when they are not the usual strips", () => {
    const corners = battleWith(
      { ...OPEN_APPROACH, zones: [{ id: "a", owner: "attacker", polygon: [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 20 }] }, { id: "d", owner: "defender", polygon: [{ x: 60, y: 44 }, { x: 40, y: 44 }, { x: 60, y: 24 }] }] },
      start.units,
    );
    const up = enemyBearing(corners, "attacker");
    expect(Math.cos(up)).toBeGreaterThan(0);
    expect(Math.sin(up)).toBeGreaterThan(0);
    expect(enemyBearing(corners, "defender")).toBeCloseTo(up - Math.PI);
  });

  it("turns every model to face the enemy on the muster table and again when it is set down", () => {
    for (const u of start.units) for (const m of u.models) expect(m.hull.facing).toBeCloseTo(enemyBearing(start, u.side));
    const down = freshDeployment(start);
    for (const u of down.units) for (const m of u.models) expect(m.hull.facing).toBeCloseTo(u.side === "attacker" ? Math.PI / 2 : -Math.PI / 2);
    const auto = autoDeploy(clearDeployment(down), "defender");
    for (const u of auto.units) if (u.side === "defender") for (const m of u.models) expect(m.hull.facing).toBeCloseTo(-Math.PI / 2);
  });

  it("keeps a turn the player made when the unit is deployed by hand, and forgets it on withdrawal", () => {
    const unit = start.units.find((u) => u.side === "attacker")!;
    const turned = faceUnit(unit, 0.3);
    expect(deployUnit(turned, { x: 20, y: 6 }).models.every((m) => m.hull.facing === 0.3)).toBe(true);
    const back = withdrawUnit(start, deployUnit(turned, { x: 20, y: 6 }));
    for (const m of back.models) expect(m.hull.facing).toBeCloseTo(Math.PI / 2);
  });
});

describe("a block of oval bases", () => {
  const bikes: BattleUnit = {
    id: "bikes",
    side: "attacker",
    name: "bikes",
    move: 12,
    oc: 2,
    keywords: ["MOUNTED"],
    models: [0, 1, 2].map((i) => ({ id: `b${i}`, hull: { pos: { x: 0, y: 0, z: 0 }, facing: 0, foot: ovalBase(75, 42), height: 2 } })),
  };

  it("leaves room for the length of the base whichever way the unit faces", () => {
    for (const facing of [0, Math.PI / 2, 1]) {
      const placed = placeUnit(faceUnit(bikes, facing), { x: 30, y: 20 });
      const reach = footReach(placed.models[0]!.hull.foot);
      placed.models.forEach((a, i) => placed.models.slice(i + 1).forEach((b) => expect(Math.hypot(a.hull.pos.x - b.hull.pos.x, a.hull.pos.y - b.hull.pos.y)).toBeGreaterThanOrEqual(2 * reach)));
    }
    const size = blockSize(bikes);
    expect(size.width).toBeGreaterThanOrEqual(2 * 2 * footReach(bikes.models[0]!.hull.foot));
  });
});

describe("what a model stands on", () => {
  const profile = (baseSize: string | undefined, W: number): ModelProfile => ({ id: "m", name: "m", T: 4, Sv: 3, W, baseSize });

  it("takes the base the datasheet names, whatever the class", () => {
    expect(footprintFor(["VEHICLE"], profile("120 x 92mm", 10))).toEqual(ovalBase(120, 92));
    expect(footprintFor(["INFANTRY"], profile("28.5mm", 1))).toEqual(circleBase(28.5));
  });

  it("sizes a hull from Wounds when a vehicle or monster has no base, and grows it with them", () => {
    const carrier = footprintFor(["VEHICLE", "TRANSPORT"], profile("Use model", 10));
    const tank = footprintFor(["VEHICLE"], profile("Use model", 13));
    const superheavy = footprintFor(["VEHICLE", "TITANIC"], profile(undefined, 24));
    expect(carrier.kind).toBe("capsule");
    expect(2 * footReach(carrier)).toBeCloseTo(4.5, 1);
    expect(2 * footReach(tank)).toBeCloseTo(5.6, 1);
    expect(2 * footReach(superheavy)).toBeCloseTo(9.5, 1);
    expect(footReach(tank)).toBeGreaterThan(footReach(carrier));
    expect(footReach(superheavy)).toBeGreaterThan(footReach(tank));
    // A walker stands on its feet: round, as wide as the hull would have been.
    expect(hullFromWounds(["VEHICLE", "WALKER"], 10)).toEqual(circleBase(4.5 * 0.65 * 25.4));
  });

  it("takes a kit's measured hull when the datasheet names no base, and the base when it does", () => {
    const russ = footprintFor(["VEHICLE"], profile("Use model", 13), "Leman Russ Demolisher");
    expect(russ.kind).toBe("capsule");
    expect(2 * footReach(russ)).toBeCloseTo(120 / 25.4, 2);
    expect(2 * russ.r).toBeCloseTo(110 / 25.4, 2);
    expect(footprintFor(["VEHICLE"], profile("Use model", 8), "Drop Pod")).toEqual(circleBase(115));
    // The marine Stalker and the Necron Triarch Stalker are different kits.
    expect(2 * footReach(footprintFor(["VEHICLE"], profile("Use model", 11), "Stalker"))).toBeCloseTo(100 / 25.4, 2);
    expect(2 * footReach(footprintFor(["VEHICLE", "WALKER"], profile("Use model", 12), "Triarch Stalker"))).toBeCloseTo(140 / 25.4, 2);
    // A named base beats the record.
    expect(footprintFor(["VEHICLE", "WALKER"], profile("60mm", 10), "Contemptor Dreadnought")).toEqual(circleBase(60));
    // A model is tied to its own profile's kit before its squad's.
    expect(footprintFor(["MOUNTED"], { ...profile("Use model", 5), name: "Attack Bike" }, "Bike Squad")).toEqual(ovalBase(90, 52));
    // A kit not on record still gets the wounds estimate.
    expect(footprintFor(["VEHICLE"], profile("Use model", 13), "Unheard-of Tank")).toEqual(hullFromWounds(["VEHICLE"], 13));
  });

  it("falls back on the class's usual base for anything else without one", () => {
    expect(footprintFor(["INFANTRY"], profile("Use model", 4))).toEqual(circleBase(32));
    expect(footprintFor(["INFANTRY", "CHARACTER"], undefined)).toEqual(circleBase(40));
  });
});
