import { describe, expect, it } from "vitest";
import { SnapshotData } from "@grimstat/schema";
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
  it("copies the values it takes from the patch", () => {
    const patch = { a: [{ b: 1 }] };
    const result = mergePatch({}, patch) as typeof patch;
    expect(result.a).toEqual(patch.a);
    expect(result.a).not.toBe(patch.a);
    expect(result.a[0]).not.toBe(patch.a[0]);
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

  it("counts one override once, however many records it patched", () => {
    const res = applyOverrides(data, [{ entity: "priceRule", id: "ds:ashen-wardens:warden-squad", patch: { tiers: [{ models: 1, points: 95 }] } }]);
    expect(res.data.priceRules.filter((r) => r.datasheetId === "ds:ashen-wardens:warden-squad")).toHaveLength(2);
    expect(res.applied).toBe(1);
  });

  it("drops an override that leaves a record the schema rejects, and names the entity", () => {
    const res = applyOverrides(data, [
      { entity: "datasheet", id: "ds:ashen-wardens:warden-captain", patch: { models: null, name: 42 } },
      { entity: "detachment", id: "det:ashen-wardens:ember-vanguard", patch: { dp: 3 } },
    ]);
    expect(res.rejected).toHaveLength(1);
    expect(res.rejected[0]).toMatchObject({ index: 0, entity: "datasheet", id: "ds:ashen-wardens:warden-captain" });
    expect(res.rejected[0]!.error).toMatch(/name|models/);
    expect(res.applied).toBe(1);
    expect(res.missing).toEqual([]);
    // the rejected patch left the datasheet as it was, and the rest of the pack still applied
    const ds = res.data.datasheets.find((d) => d.id === "ds:ashen-wardens:warden-captain")!;
    expect(ds.name).toBe("Warden Captain");
    expect(ds.models.length).toBeGreaterThan(0);
    expect(res.data.detachments.find((d) => d.id === "det:ashen-wardens:ember-vanguard")!.dp).toBe(3);
    expect(() => SnapshotData.parse(res.data)).not.toThrow();
  });

  it("gives every patched entity its own copy of the patch", () => {
    const patch = { tiers: [{ models: 1, points: 95 }] };
    const res = applyOverrides(data, [{ entity: "priceRule", id: "ds:ashen-wardens:warden-squad", patch }]);
    const rules = res.data.priceRules.filter((r) => r.datasheetId === "ds:ashen-wardens:warden-squad");
    expect(rules).toHaveLength(2);
    expect(rules[0]!.tiers).toEqual(patch.tiers);
    expect(rules[0]!.tiers).not.toBe(patch.tiers);
    expect(rules[0]!.tiers).not.toBe(rules[1]!.tiers);
    rules[0]!.tiers[0]!.points = 1;
    expect(rules[1]!.tiers[0]!.points).toBe(95);
    expect(patch.tiers[0]!.points).toBe(95);
  });
});
