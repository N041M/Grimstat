import { describe, expect, it } from "vitest";
import { applyOverrides, mergePatch } from "./overrides";
import { loadSyntheticSnapshot } from "./synthetic/index";

describe("mergePatch (RFC 7396)", () => {
  it.each([
    [{ a: "b" }, { a: "c" }, { a: "c" }],
    [{ a: "b" }, { b: "c" }, { a: "b", b: "c" }],
    [{ a: "b" }, { a: null }, {}],
    [{ a: "b", b: "c" }, { a: null }, { b: "c" }],
    [{ a: ["b"] }, { a: "c" }, { a: "c" }],
    [{ a: "c" }, { a: ["b"] }, { a: ["b"] }],
    [{ a: { b: "c" } }, { a: { b: "d", c: null } }, { a: { b: "d" } }],
    [{ a: [{ b: "c" }] }, { a: [1] }, { a: [1] }],
    [["a", "b"], { a: "c" }, { a: "c" }],
    [{ a: "foo" }, null, null],
    [{ a: "foo" }, "bar", "bar"],
    [{ e: null }, { a: 1 }, { e: null, a: 1 }],
    [[1, 2], { a: "b", c: null }, { a: "b" }],
    [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
  ])("patches %j with %j", (target, patch, expected) => {
    expect(mergePatch(target, patch)).toEqual(expected);
  });
  it("does not mutate the target", () => {
    const target = { a: { b: 1 } };
    mergePatch(target, { a: { c: 2 } });
    expect(target).toEqual({ a: { b: 1 } });
  });
});

describe("applyOverrides", () => {
  const data = loadSyntheticSnapshot().data;
  it("patches entities by kind and id and reports missing ids", () => {
    const res = applyOverrides(data, [
      { entity: "datasheet", id: "ds:ashen-wardens:warden-captain", patch: { fallbackPoints: 95, damagedProfile: null, keywords: ["INFANTRY"] }, note: "test" },
      { entity: "priceRule", id: "ds:ashen-wardens:warden-captain", patch: { tiers: [{ models: 1, points: 95 }] } },
      { entity: "detachment", id: "det:ashen-wardens:ember-vanguard", patch: { dp: 3 } },
      { entity: "ability", id: "ab:nope", patch: { text: "x" } },
    ]);
    expect(res.applied).toBe(3);
    expect(res.missing).toEqual([{ index: 3, entity: "ability", id: "ab:nope" }]);
    const ds = res.data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-captain")!;
    expect(ds.fallbackPoints).toBe(95);
    expect(ds.keywords).toEqual(["INFANTRY"]);
    expect(ds.name).toBe("Warden Captain");
    expect(res.data.priceRules.find((r) => r.datasheetId === "ds:ashen-wardens:warden-captain")!.tiers).toEqual([{ models: 1, points: 95 }]);
    expect(res.data.detachments.find((d) => d.id === "det:ashen-wardens:ember-vanguard")!.dp).toBe(3);
    // input untouched
    expect(data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-captain")!.fallbackPoints).toBe(80);
  });
});
