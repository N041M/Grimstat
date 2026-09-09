import { describe, expect, it } from "vitest";
import { ModifierSet, evaluateCondition, collectModifiers, KeywordRegistry, type EvalContext } from "./index";

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
});
