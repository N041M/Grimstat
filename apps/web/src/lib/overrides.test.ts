import { describe, expect, it } from "vitest";
import type { Override, Snapshot } from "@grimstat/schema";
import { buildEffect, conditionFromForm, defaultEffectForm, effectToForm, effectiveSnapshot, fnpOverride, isNoEffectPatch, mergeOverrides, noEffectOverride, overrideKey, parseOverridePack, suggestedValueKind, summarisePatch, toPack, toRecord, type EffectForm } from "./overrides";

const NOW = "2026-01-01T00:00:00.000Z";

describe("effect form → EffectRecord", () => {
  it("builds a numeric modifier with the ability name as source", () => {
    const form: EffectForm = { ...defaultEffectForm(), stage: "wound", side: "attacker", op: "add", target: "wound-roll", valueKind: "number", value: "1" };
    const r = buildEffect(form, "Ember Resolve");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.effect).toEqual({ when: { stage: "wound", side: "attacker" }, op: "add", target: "wound-roll", value: 1, source: "Ember Resolve" });
  });

  it("maps value kinds: re-roll policy, boolean flag and dice text", () => {
    const base = defaultEffectForm();
    const reroll = buildEffect({ ...base, op: "reroll", target: "reroll-hit", valueKind: "reroll", reroll: "failed" }, "A");
    expect(reroll.ok && reroll.effect.value).toBe("failed");
    const flag = buildEffect({ ...base, op: "flag", target: "lethal", valueKind: "boolean", bool: true }, "A");
    expect(flag.ok && flag.effect.value).toBe(true);
    const dice = buildEffect({ ...base, op: "set", target: "sustained", valueKind: "string", value: " d3 " }, "A");
    expect(dice.ok && dice.effect.value).toBe("d3");
  });

  it("only emits the condition keys that were filled in, upper-casing keywords", () => {
    const form: EffectForm = { ...defaultEffectForm(), condition: { targetKeyword: " vehicle ", attackerKeyword: "", weaponKind: "ranged", weaponKeyword: "", rangeBand: "half", charged: "", stationary: "false", inCover: "", phase: "shooting" } };
    expect(conditionFromForm(form.condition)).toEqual({ targetKeyword: "VEHICLE", weaponKind: "ranged", rangeBand: "half", stationary: false, phase: "shooting" });
    const r = buildEffect(form, "A");
    expect(r.ok && r.effect.if).toEqual({ targetKeyword: "VEHICLE", weaponKind: "ranged", rangeBand: "half", stationary: false, phase: "shooting" });
    const empty = buildEffect({ ...defaultEffectForm() }, "A");
    expect(empty.ok && "if" in empty.effect).toBe(false);
  });

  it("rejects an empty target, a non-numeric number and an empty text value", () => {
    const base = defaultEffectForm();
    expect(buildEffect({ ...base, target: "  " }, "A")).toEqual({ ok: false, error: "overrides.err.target" });
    expect(buildEffect({ ...base, value: "abc" }, "A")).toEqual({ ok: false, error: "overrides.err.number" });
    expect(buildEffect({ ...base, valueKind: "string", value: "" }, "A")).toEqual({ ok: false, error: "overrides.err.string" });
  });

  it("round-trips a record through the form", () => {
    const form: EffectForm = { ...defaultEffectForm(), stage: "hit", side: "defender", op: "reroll", target: "reroll-save", valueKind: "reroll", reroll: "one-die", condition: { ...defaultEffectForm().condition, inCover: "true" } };
    const built = buildEffect(form, "X");
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const back = effectToForm(built.effect);
    expect(back.stage).toBe("hit");
    expect(back.side).toBe("defender");
    expect(back.op).toBe("reroll");
    expect(back.valueKind).toBe("reroll");
    expect(back.reroll).toBe("one-die");
    expect(back.condition.inCover).toBe("true");
    const again = buildEffect(back, "X");
    expect(again.ok && again.effect).toEqual(built.effect);
  });

  it("suggests the value kind from the op and channel", () => {
    expect(suggestedValueKind("reroll", "hit-roll")).toBe("reroll");
    expect(suggestedValueKind("flag", "hit-roll")).toBe("boolean");
    expect(suggestedValueKind("set", "lethal")).toBe("boolean");
    expect(suggestedValueKind("add", "hit-roll")).toBe("number");
    expect(suggestedValueKind("set", "made-up")).toBe("number");
  });
});

describe("override records", () => {
  const ability = { id: "ab:x", name: "X" };

  it("builds quick-action overrides", () => {
    expect(fnpOverride(ability, 5)).toEqual({ entity: "ability", id: "ab:x", patch: { coreKeyword: "FEEL NO PAIN", coreValue: 5, effects: null }, note: "Feel No Pain 5+" });
    const none = noEffectOverride(ability, "  ");
    expect(none.patch).toEqual({ effects: [] });
    expect(isNoEffectPatch(none.patch)).toBe(true);
    expect(isNoEffectPatch({ effects: [{}] })).toBe(false);
    expect(summarisePatch({ effects: [{}, {}] })).toEqual({ kind: "effects", n: 2, keys: [] });
    expect(summarisePatch({ coreKeyword: "FEEL NO PAIN", coreValue: 6 })).toEqual({ kind: "fnp", n: 6, keys: [] });
    expect(summarisePatch({ name: "Y", text: "z" })).toEqual({ kind: "fields", n: 0, keys: ["name", "text"] });
  });

  it("merges an imported pack by entity + id, keeping createdAt of updated rows", () => {
    const existing = [toRecord({ entity: "ability", id: "a", patch: { effects: [] }, note: "old" }, "2025-01-01T00:00:00.000Z"), toRecord({ entity: "datasheet", id: "d", patch: { name: "D" } }, "2025-01-01T00:00:00.000Z")];
    const incoming: Override[] = [
      { entity: "ability", id: "a", patch: { effects: [{ when: { stage: "hit", side: "attacker" }, op: "add", target: "hit-roll", value: 1 }] } },
      { entity: "datasheet", id: "d", patch: { name: "D" } },
      { entity: "ability", id: "b", patch: { effects: [] }, note: "new" },
    ];
    const r = mergeOverrides(existing, incoming, NOW);
    expect(r.added).toBe(1);
    expect(r.updated).toBe(1);
    expect(r.unchanged).toBe(1);
    expect(r.merged).toHaveLength(3);
    const a = r.merged.find((x) => x.key === overrideKey("ability", "a"))!;
    expect(a.createdAt).toBe("2025-01-01T00:00:00.000Z");
    expect(a.updatedAt).toBe(NOW);
    expect(a.note).toBeUndefined();
    expect((a.patch["effects"] as unknown[]).length).toBe(1);
    const b = r.merged.find((x) => x.key === "ability:b")!;
    expect(b.createdAt).toBe(NOW);
    expect(b.ownerId).toBe("local");
  });

  it("exports a plain Override array and validates packs on import", () => {
    const recs = [toRecord({ entity: "ability", id: "a", patch: { effects: [] }, note: "n" }, NOW)];
    const pack = toPack(recs);
    expect(pack).toEqual([{ entity: "ability", id: "a", patch: { effects: [] }, note: "n" }]);
    expect(parseOverridePack(pack).overrides).toEqual(pack);
    expect(parseOverridePack({ overrides: pack }).overrides).toEqual(pack);
    const bad = parseOverridePack([{ entity: "spaceship", id: "a", patch: {} }, { entity: "ability", id: "", patch: {} }, { entity: "ability", id: "ok", patch: { x: 1 } }]);
    expect(bad.overrides).toHaveLength(1);
    expect(bad.errors).toHaveLength(2);
    expect(parseOverridePack("nope").errors).toHaveLength(1);
  });
});

describe("effective snapshot", () => {
  const raw: Snapshot = {
    id: "snap",
    ownerId: "local",
    createdAt: NOW,
    updatedAt: NOW,
    revision: 0,
    gameSystemId: "wh40k-11e",
    checksum: "abc",
    sources: [],
    conflicts: [],
    data: {
      gameSystem: { id: "wh40k-11e", name: "x", edition: "11", costTypes: [] },
      factions: [],
      publications: [],
      datasheets: [],
      abilities: [{ id: "ab:x", name: "X", scope: "other", text: "t", isLegends: false }],
      detachments: [],
      enhancements: [],
      stratagems: [],
      priceRules: [],
      wargearPrices: [],
    },
  };

  it("returns the raw object when there are no overrides", () => {
    const r = effectiveSnapshot(raw, []);
    expect(r.snapshot).toBe(raw);
    expect(r.applied).toBe(0);
  });

  it("applies patches, counts misses and stamps the checksum so caches miss", () => {
    const r = effectiveSnapshot(raw, [
      { entity: "ability", id: "ab:x", patch: { effects: [] } },
      { entity: "ability", id: "ab:missing", patch: { effects: [] } },
    ]);
    expect(r.applied).toBe(1);
    expect(r.missing).toBe(1);
    expect(r.snapshot.id).toBe(raw.id);
    expect(r.snapshot.checksum.startsWith("abc+ov")).toBe(true);
    expect(r.snapshot.data.abilities[0]?.effects).toEqual([]);
    expect(raw.data.abilities[0]?.effects).toBeUndefined();
    const same = effectiveSnapshot(raw, [{ entity: "ability", id: "ab:missing", patch: { effects: [] } }, { entity: "ability", id: "ab:x", patch: { effects: [] } }]);
    expect(same.snapshot.checksum).toBe(r.snapshot.checksum); // order-independent stamp
  });
});
