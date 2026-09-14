import { describe, expect, it } from "vitest";
import { ModifierSet, evaluateCondition, collectModifiers, targetKeywordCondition, KeywordRegistry, type EvalContext } from "./index";

const ctx: EvalContext = {
  attackerKeywords: new Set(["INFANTRY"]),
  targetKeywords: new Set(["VEHICLE", "IMPERIUM"]),
  weaponKind: "ranged",
  weaponKeywords: new Set(["MELTA"]),
  rangeBand: "half",
  charged: false,
  stationary: true,
  inCover: false,
  phase: "shooting",
  flags: new Set(["oath"]),
};

describe("ModifierSet", () => {
  it("caps net add and resolves in order", () => {
    const m = new ModifierSet();
    m.add({ channel: "hit-roll", op: "add", value: 1 });
    m.add({ channel: "hit-roll", op: "add", value: 1 });
    m.add({ channel: "hit-roll", op: "add", value: -1 });
    expect(m.num("hit-roll", 0, { capAdd: 1 })).toBe(1);
    m.add({ channel: "hit-roll", op: "add", value: 1 });
    expect(m.num("hit-roll", 0, { capAdd: 1 })).toBe(1);
    expect(m.rawAdd("hit-roll")).toBe(2);
  });
  it("an outright set stands below a channel's floor, a modifier does not", () => {
    // "Change the Damage characteristic of that attack to 0" against a floor that says modifiers
    // cannot reduce Damage below 1.
    const set = new ModifierSet();
    set.add({ channel: "damage", op: "set", value: 0 });
    expect(set.num("damage", 3, { min: 1 })).toBe(0);
    const reduced = new ModifierSet();
    reduced.add({ channel: "damage", op: "add", value: -3 });
    expect(reduced.num("damage", 1, { min: 1 })).toBe(1);
    // A modifier on top of the set meets the floor again.
    set.add({ channel: "damage", op: "add", value: -1 });
    expect(set.num("damage", 3, { min: 1 })).toBe(1);
  });
  it("mul rounds up, cap and min apply", () => {
    const m = new ModifierSet();
    m.add({ channel: "damage", op: "mul", value: 0.5 });
    expect(m.num("damage", 3)).toBe(2);
    m.add({ channel: "damage", op: "add", value: -1 });
    expect(m.num("damage", 3, { min: 1 })).toBe(1);
    m.add({ channel: "damage", op: "cap", value: 1 });
    expect(m.num("damage", 10, { min: 1 })).toBe(1);
  });
  it("reroll precedence", () => {
    const m = new ModifierSet();
    m.add({ channel: "reroll-hit", op: "reroll", value: "ones" });
    expect(m.reroll("reroll-hit")).toBe("ones");
    m.add({ channel: "reroll-hit", op: "reroll", value: "failed" });
    expect(m.reroll("reroll-hit")).toBe("failed");
    m.add({ channel: "reroll-hit", op: "reroll", value: "one-die" });
    expect(m.oneDieReroll("reroll-hit")).toBe(true);
    expect(m.reroll("reroll-hit")).toBe("failed");
  });
});

describe("conditions", () => {
  it("evaluates keyword, range, flags and boolean combinators", () => {
    expect(evaluateCondition({ targetKeyword: "vehicle" }, ctx)).toBe(true);
    expect(evaluateCondition({ targetKeyword: "MONSTER" }, ctx)).toBe(false);
    expect(evaluateCondition({ any: [{ targetKeyword: "MONSTER" }, { rangeBand: "half" }] }, ctx)).toBe(true);
    expect(evaluateCondition({ all: [{ flag: "oath" }, { not: { charged: true } }] }, ctx)).toBe(true);
    expect(evaluateCondition({ weaponKind: "melee" }, ctx)).toBe(false);
    expect(evaluateCondition(undefined, ctx)).toBe(true);
  });
  it("reads a printed target-keyword list, negated or not", () => {
    expect(targetKeywordCondition("VEHICLE")).toEqual({ targetKeyword: "VEHICLE" });
    expect(targetKeywordCondition("MONSTER/VEHICLE")).toEqual({ any: [{ targetKeyword: "MONSTER" }, { targetKeyword: "VEHICLE" }] });
    expect(targetKeywordCondition("NON-VEHICLE")).toEqual({ not: { targetKeyword: "VEHICLE" } });
    expect(targetKeywordCondition("non-MONSTER/VEHICLE")).toEqual({ not: { any: [{ targetKeyword: "MONSTER" }, { targetKeyword: "VEHICLE" }] } });
    expect(targetKeywordCondition(undefined)).toBeUndefined();
    // ctx target is VEHICLE, IMPERIUM
    expect(evaluateCondition(targetKeywordCondition("MONSTER/VEHICLE"), ctx)).toBe(true);
    expect(evaluateCondition(targetKeywordCondition("NON-MONSTER/VEHICLE"), ctx)).toBe(false);
    expect(evaluateCondition(targetKeywordCondition("NON-MONSTER/TITANIC"), ctx)).toBe(true);
  });
  it("collects only matching side and condition", () => {
    const mods = collectModifiers(
      [
        { when: { stage: "wound", side: "attacker" }, if: { targetKeyword: "VEHICLE" }, op: "add", target: "wound-roll", value: 1, source: "a" },
        { when: { stage: "hit", side: "defender" }, op: "add", target: "hit-roll", value: -1, source: "b" },
        { when: { stage: "hit", side: "attacker" }, if: { charged: true }, op: "add", target: "hit-roll", value: 1, source: "c" },
      ],
      "attacker",
      ctx,
    );
    expect(mods.map((m) => m.source)).toEqual(["a"]);
  });
});

describe("KeywordRegistry", () => {
  it("applies handlers and reports unknown keywords", () => {
    const r = new KeywordRegistry();
    r.register("MELTA", (kw, c) => c.mods.add({ channel: "damage", op: "add", value: Number(kw.value) }));
    r.registerInert("ASSAULT");
    const mods = new ModifierSet();
    const unknown = r.apply([{ name: "MELTA", value: 2 }, { name: "ASSAULT" }, { name: "WEIRD", raw: "Weird 3" }], { ...ctx, mods, targetModelCount: 5, warnings: [] });
    expect(unknown).toEqual(["Weird 3"]);
    expect(mods.num("damage", 1)).toBe(3);
  });
  it("gates a handler on the condition printed with the keyword", () => {
    const r = new KeywordRegistry();
    r.register("LETHAL HITS", (_kw, c) => c.mods.add({ channel: "lethal", op: "flag", value: true }));
    const run = (keyword?: string) => {
      const mods = new ModifierSet();
      r.apply([{ name: "LETHAL HITS", ...(keyword ? { keyword } : {}) }], { ...ctx, mods, targetModelCount: 5, warnings: [] });
      return mods.flag("lethal");
    };
    expect(run()).toBe(true);
    expect(run("VEHICLE")).toBe(true); // ctx target is VEHICLE
    expect(run("NON-MONSTER/VEHICLE")).toBe(false);
    expect(run("INFANTRY")).toBe(false);
  });
  it("leaves `kw.keyword` to a handler that owns it", () => {
    const r = new KeywordRegistry();
    r.register("ANTI", (kw, c) => c.mods.add({ channel: "crit-wound", op: "cap", value: Number(kw.value), source: kw.keyword }), { ownsKeyword: true });
    const mods = new ModifierSet();
    r.apply([{ name: "ANTI", keyword: "MONSTER", value: 4 }], { ...ctx, mods, targetModelCount: 5, warnings: [] });
    expect(mods.num("crit-wound", 6)).toBe(4);
  });
});
