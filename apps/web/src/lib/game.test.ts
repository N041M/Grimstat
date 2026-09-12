import { describe, expect, it } from "vitest";
import { atStrength, logEntry, summarise, applyAction, applyDamage, applyHeal, advance, modelsLeft, newGameState, newOpponentUnit, NEW_UNIT_STATE, opponentScenarioUnit, PHASES, scoredIn, totalsFor, woundsLeft, type GameState, type Secondary } from "./game";

const run = (state: GameState, ...actions: Parameters<typeof applyAction>[1][]): GameState => actions.reduce(applyAction, state);

describe("advance", () => {
  it("walks the phases in order", () => {
    let s = newGameState();
    expect(s.phase).toBe("command");
    for (const expected of PHASES.slice(1)) {
      s = advance(s);
      expect(s.phase).toBe(expected);
    }
  });

  it("hands the turn over after the end phase, keeping the round", () => {
    let s = newGameState();
    for (let i = 0; i < PHASES.length; i++) s = advance(s);
    expect(s.active).toBe("them");
    expect(s.phase).toBe("command");
    expect(s.round).toBe(1);
  });

  it("starts the next round once both players have had a turn", () => {
    let s = newGameState();
    for (let i = 0; i < PHASES.length * 2; i++) s = advance(s);
    expect(s.active).toBe("you");
    expect(s.round).toBe(2);
  });

  it("pays a command point at the start of each turn", () => {
    let s = newGameState();
    expect(s.you.cp).toBe(0);
    for (let i = 0; i < PHASES.length; i++) s = advance(s);
    expect(s.them.cp).toBe(1);
    expect(s.you.cp).toBe(0);
    for (let i = 0; i < PHASES.length; i++) s = advance(s);
    expect(s.you.cp).toBe(1);
  });

  it("clears the flags of the player whose turn begins, and leaves the other alone", () => {
    let s = newGameState();
    s = run(s, { kind: "flag", target: { side: "you", id: "u1" }, flag: "moved", on: true }, { kind: "flag", target: { side: "them", id: "e1" }, flag: "charged", on: true });
    for (let i = 0; i < PHASES.length; i++) s = advance(s);
    // their turn started: their flags cleared, mine untouched
    expect(s.opponentUnits["e1"]?.flags.charged).toBe(false);
    expect(s.units["u1"]?.flags.moved).toBe(true);
    for (let i = 0; i < PHASES.length; i++) s = advance(s);
    expect(s.units["u1"]?.flags.moved).toBe(false);
  });
});

describe("applyDamage", () => {
  it("fills the wounded model before removing whole ones", () => {
    const one = applyDamage(NEW_UNIT_STATE, 1, 2, 5);
    expect(one).toMatchObject({ modelsLost: 0, woundsLost: 1, destroyed: false });
    const two = applyDamage(one, 1, 2, 5);
    expect(two).toMatchObject({ modelsLost: 1, woundsLost: 0, destroyed: false });
  });

  it("destroys the unit once every wound is gone", () => {
    expect(applyDamage(NEW_UNIT_STATE, 10, 2, 5).destroyed).toBe(true);
    expect(applyDamage(NEW_UNIT_STATE, 99, 2, 5)).toMatchObject({ modelsLost: 5, woundsLost: 0, destroyed: true });
  });

  it("ignores a zero or nonsense amount", () => {
    expect(applyDamage(NEW_UNIT_STATE, 0, 2, 5)).toBe(NEW_UNIT_STATE);
    expect(applyDamage(NEW_UNIT_STATE, -3, 2, 5)).toBe(NEW_UNIT_STATE);
    expect(applyDamage(NEW_UNIT_STATE, Number.NaN, 2, 5)).toBe(NEW_UNIT_STATE);
  });

  it("treats a single-wound unit one model at a time", () => {
    expect(applyDamage(NEW_UNIT_STATE, 3, 1, 10)).toMatchObject({ modelsLost: 3, woundsLost: 0 });
  });
});

describe("applyHeal", () => {
  it("puts wounds back and lifts the destroyed mark", () => {
    const dead = applyDamage(NEW_UNIT_STATE, 10, 2, 5);
    expect(applyHeal(dead, 2, 2)).toMatchObject({ modelsLost: 4, woundsLost: 0, destroyed: false });
  });

  it("never goes past full health", () => {
    expect(applyHeal(applyDamage(NEW_UNIT_STATE, 1, 2, 5), 9, 2)).toMatchObject({ modelsLost: 0, woundsLost: 0 });
  });
});

describe("woundsLeft and modelsLeft", () => {
  it("counts what is still standing", () => {
    const hurt = applyDamage(NEW_UNIT_STATE, 3, 2, 5);
    expect(woundsLeft(hurt, 2, 5)).toBe(7);
    expect(modelsLeft(hurt, 5)).toBe(4);
  });

  it("reads zero for a destroyed unit", () => {
    const dead = applyDamage(NEW_UNIT_STATE, 10, 2, 5);
    expect(woundsLeft(dead, 2, 5)).toBe(0);
    expect(modelsLeft(dead, 5)).toBe(0);
  });
});

describe("scoring", () => {
  const secondaries: Secondary[] = [
    { id: "s1", name: "Hold the line" },
    { id: "s2", name: "Capped one", cap: 10 },
  ];

  it("adds primary and secondary separately", () => {
    let s = newGameState();
    s = run(s, { kind: "score", side: "you", points: 5 }, { kind: "score", side: "you", points: 3, secondaryId: "s1" });
    const t = totalsFor(s.you, secondaries);
    expect(t).toMatchObject({ primary: 5, secondary: 3, total: 8 });
  });

  it("replaces a line already scored in the same round", () => {
    let s = newGameState();
    s = run(s, { kind: "score", side: "you", points: 5 }, { kind: "score", side: "you", points: 10 });
    expect(totalsFor(s.you, secondaries).primary).toBe(10);
    expect(s.you.scores).toHaveLength(1);
  });

  it("keeps the same line in different rounds apart", () => {
    let s = newGameState();
    s = run(s, { kind: "score", side: "you", points: 5, round: 1 }, { kind: "score", side: "you", points: 4, round: 2 });
    expect(totalsFor(s.you, secondaries).primary).toBe(9);
    expect(scoredIn(s.you, 1)).toBe(5);
    expect(scoredIn(s.you, 2)).toBe(4);
  });

  it("caps a secondary that has one", () => {
    let s = newGameState();
    s = run(s, { kind: "score", side: "you", points: 8, round: 1, secondaryId: "s2" }, { kind: "score", side: "you", points: 8, round: 2, secondaryId: "s2" });
    expect(totalsFor(s.you, secondaries).secondary).toBe(10);
  });

  it("reports points per round", () => {
    let s = newGameState();
    s = run(s, { kind: "score", side: "you", points: 5, round: 1 }, { kind: "score", side: "you", points: 2, round: 1, secondaryId: "s1" });
    expect(totalsFor(s.you, secondaries).byRound.get(1)).toBe(7);
  });

  it("forgets a secondary's points when it is removed", () => {
    let s = newGameState();
    s = run(s, { kind: "addSecondary", secondary: secondaries[0]! }, { kind: "score", side: "you", points: 4, secondaryId: "s1" }, { kind: "removeSecondary", id: "s1" });
    expect(s.you.scores).toHaveLength(0);
    expect(s.secondaries).toHaveLength(0);
  });
});

describe("command points", () => {
  it("never goes below zero", () => {
    let s = newGameState();
    s = run(s, { kind: "cp", side: "you", delta: -5 });
    expect(s.you.cp).toBe(0);
  });

  it("spending a stratagem deducts its cost", () => {
    let s = newGameState();
    s = run(s, { kind: "cp", side: "you", delta: 4 }, { kind: "spendStratagem", side: "you", cp: 2, name: "Hold Fast" });
    expect(s.you.cp).toBe(2);
  });
});

describe("opponent units", () => {
  it("adds and removes, dropping the removed unit's state", () => {
    const foe = { ...newOpponentUnit("Rhino"), id: "e1", models: 1, T: 9, Sv: 3, W: 10 };
    let s = newGameState();
    s = run(s, { kind: "addOpponent", unit: foe }, { kind: "damage", target: { side: "them", id: "e1" }, wounds: 4, profileWounds: 10, models: 1 });
    expect(s.opponentUnits["e1"]?.woundsLost).toBe(4);
    s = applyAction(s, { kind: "removeOpponent", id: "e1" });
    expect(s.opponent).toHaveLength(0);
    expect(s.opponentUnits["e1"]).toBeUndefined();
  });

  it("builds a solver unit from the typed stats, sized to what is left", () => {
    const foe = { ...newOpponentUnit("Squad"), id: "e1", models: 10, T: 4, Sv: 3, W: 2, InvSv: 5, fnp: 6 };
    const hurt = applyDamage(NEW_UNIT_STATE, 6, 2, 10);
    const unit = opponentScenarioUnit(foe, hurt);
    expect(unit.models[0]).toMatchObject({ count: 7, T: 4, Sv: 3, W: 2, InvSv: 5, fnp: 6 });
  });

  it("leaves the invulnerable save and Feel No Pain off when they are not set", () => {
    const unit = opponentScenarioUnit({ ...newOpponentUnit("Plain"), id: "e2", models: 5, T: 4, Sv: 4, W: 1 });
    expect(unit.models[0]).not.toHaveProperty("InvSv");
    expect(unit.models[0]).not.toHaveProperty("fnp");
  });
});

describe("destroy", () => {
  it("marks and unmarks, restoring a unit to full when unmarked", () => {
    let s = newGameState();
    s = run(s, { kind: "damage", target: { side: "you", id: "u1" }, wounds: 3, profileWounds: 2, models: 5 }, { kind: "destroy", target: { side: "you", id: "u1" }, destroyed: true });
    expect(s.units["u1"]?.destroyed).toBe(true);
    s = applyAction(s, { kind: "destroy", target: { side: "you", id: "u1" }, destroyed: false });
    expect(s.units["u1"]).toMatchObject({ destroyed: false, modelsLost: 0, woundsLost: 0 });
  });
});

describe("summarise", () => {
  const base = newGameState();

  it("credits wounds to the side that dealt them", () => {
    const log = [logEntry(base, "damage", "hit them", { amount: 6, side: "them", unitId: "e1" }), logEntry(base, "damage", "hit me", { amount: 4, side: "you", unitId: "u1" })];
    const sum = summarise(log, base);
    expect(sum.dealt).toEqual({ you: 6, them: 4 });
    expect(sum.rounds[0]).toMatchObject({ round: 1, dealt: { you: 6, them: 4 } });
  });

  it("totals command points spent per side", () => {
    const log = [logEntry(base, "stratagem", "Hold Fast", { amount: 2, side: "you" }), logEntry(base, "stratagem", "Something", { amount: 1 })];
    expect(summarise(log, base).cpSpent).toEqual({ you: 3, them: 0 });
  });

  it("pairs an accepted estimate with what was applied", () => {
    const log = [logEntry(base, "damage", "shot", { amount: 5, side: "them", unitId: "e1", predicted: 6.2 })];
    expect(summarise(log, base).estimates).toEqual([{ predicted: 6.2, actual: 5, unitId: "e1" }]);
  });

  it("folds the scores into their rounds", () => {
    const scored = applyAction(applyAction(base, { kind: "score", side: "you", points: 5, round: 1 }), { kind: "score", side: "them", points: 3, round: 2 });
    const rounds = summarise([], scored).rounds;
    expect(rounds.find((r) => r.round === 1)?.scored).toEqual({ you: 5, them: 0 });
    expect(rounds.find((r) => r.round === 2)?.scored).toEqual({ you: 0, them: 3 });
  });

  it("ignores lines that carry no number", () => {
    expect(summarise([logEntry(base, "note", "said something")], base)).toMatchObject({ dealt: { you: 0, them: 0 }, estimates: [] });
  });
});

describe("atStrength", () => {
  const unit = {
    name: "Squad",
    keywords: [],
    models: [
      { name: "Sergeant", count: 1, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] },
      { name: "Trooper", count: 9, T: 4, Sv: 3, W: 2, isCharacter: false, keywords: [] },
    ],
    weapons: [{ name: "Bolter", count: 10, kind: "ranged" as const, range: 24, A: "2", skill: 3, S: 4, AP: 0, D: "1", keywords: [], enabled: true }],
    effects: [],
  };

  it("returns the unit untouched while it is at full strength", () => {
    expect(atStrength(unit, NEW_UNIT_STATE, 10)).toBe(unit);
  });

  it("takes casualties from the back and scales the weapons with them", () => {
    const hurt = applyDamage(NEW_UNIT_STATE, 8, 2, 10);
    const now = atStrength(unit, hurt, 10);
    expect(now.models.map((m) => m.count)).toEqual([1, 5]);
    expect(now.weapons[0]?.count).toBe(6);
  });

  it("empties a destroyed unit", () => {
    const dead = applyDamage(NEW_UNIT_STATE, 99, 2, 10);
    const now = atStrength(unit, dead, 10);
    expect(now.models.every((m) => m.count === 0)).toBe(true);
    expect(now.weapons[0]?.count).toBe(0);
  });

  it("keeps a surviving weapon line at one rather than rounding it away", () => {
    const nearlyGone = applyDamage(NEW_UNIT_STATE, 18, 2, 10);
    expect(atStrength(unit, nearlyGone, 10).weapons[0]?.count).toBe(1);
  });
});
