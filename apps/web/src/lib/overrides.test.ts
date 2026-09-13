import { describe, expect, it } from "vitest";
import type { EffectRecord, Override, Snapshot } from "@grimstat/schema";
import { abilityEffects } from "@grimstat/game-40k-11e";
import { abilityOverride, buildEffect, conditionFromForm, defaultEffectForm, editingAfterRemove, editorFor, effectToForm, effectiveSnapshot, fnv1a128, fnpOverride, isNoEffectPatch, mergeOverrides, noEffectOverride, overrideKey, parseOverridePack, patchBeyondEffects, suggestedValueKind, summarisePatch, toPack, toRecord, withEffect, withPatch, withoutEffect, type EffectForm } from "./overrides";

const NOW = "2026-01-01T00:00:00.000Z";

/** A snapshot holding nothing but the abilities under test. */
function snapshotWith(abilities: Snapshot["data"]["abilities"]): Snapshot {
  return {
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
      abilities,
      detachments: [],
      enhancements: [],
      stratagems: [],
      priceRules: [],
      wargearPrices: [],
    },
  };
}

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

describe("removing an effect while one is open for edit", () => {
  it("slides the open effect down when one above it goes", () => {
    // Effects [A,B,C,D] with C open: taking A out leaves [B,C,D], and C is now index 1.
    expect(editingAfterRemove(2, 0)).toBe(1);
    expect(editingAfterRemove(3, 1)).toBe(2);
  });

  it("leaves the open effect where it is when one below it goes", () => {
    expect(editingAfterRemove(1, 2)).toBe(1);
    expect(editingAfterRemove(0, 3)).toBe(0);
  });

  it("closes the form when the effect being edited is the one removed", () => {
    expect(editingAfterRemove(2, 2)).toBeUndefined();
    expect(editingAfterRemove(undefined, 0)).toBeUndefined();
  });
});

describe("the 128-bit hash", () => {
  it("is 32 hex characters, the same for the same string", () => {
    expect(fnv1a128("abc")).toMatch(/^[0-9a-f]{32}$/);
    expect(fnv1a128("abc")).toBe(fnv1a128("abc"));
    expect(fnv1a128("")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("moves every lane when one character changes, so no lane rides along with another", () => {
    const lanes = (s: string) => [0, 1, 2, 3].map((i) => fnv1a128(s).slice(i * 8, i * 8 + 8));
    const a = lanes("Ada Lovelace|1st|Intercessors (80 points)");
    const b = lanes("Ada Lovelace|2nd|Intercessors (80 points)");
    expect(a.filter((x, i) => x === b[i])).toEqual([]);
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

describe("the ability editor", () => {
  const ability = { id: "ab:x", name: "X" };
  const effect = (target: string): EffectRecord => ({ when: { stage: "hit", side: "attacker" }, op: "add", target, value: 1, source: "X" });
  const save = (s: ReturnType<typeof editorFor>) => abilityOverride(ability, s.effects, s.note, s.patch);

  it("keeps the parts of the patch it cannot show when the override is saved again", () => {
    const stored = fnpOverride(ability, 5);
    const editor = editorFor(ability, stored);
    expect(editor.effects).toEqual([]);
    expect(patchBeyondEffects(editor.patch)).toEqual({ coreKeyword: "FEEL NO PAIN", coreValue: 5 });
    const saved = save(editor);
    expect(saved.patch).toEqual(stored.patch);
    expect(isNoEffectPatch(saved.patch)).toBe(false);
    expect(summarisePatch(saved.patch).kind).toBe("fnp");
  });

  it("adds an effect beside the core keyword instead of replacing it", () => {
    const editor = withEffect(editorFor(ability, fnpOverride(ability, 5)), effect("hit-roll"));
    expect(save(editor).patch).toEqual({ coreKeyword: "FEEL NO PAIN", coreValue: 5, effects: [effect("hit-roll")] });
  });

  it("stores the empty list once the ability had one, and nothing at all before that", () => {
    const emptied = withoutEffect(editorFor(ability, { patch: { effects: [effect("hit-roll")] } }), 0);
    expect(isNoEffectPatch(save(emptied).patch)).toBe(true);
    expect(save(editorFor(ability, undefined)).patch).toEqual({});
  });

  it("closes the effect under edit when a quick action replaces the list", () => {
    const loaded = editorFor(ability, { patch: { effects: [effect("hit-roll"), effect("wound-roll")] } });
    const editing = { ...loaded, editing: 1 };
    const afterQuick = withPatch(editing, fnpOverride(ability, 5).patch, "Feel No Pain 5+");
    expect(afterQuick.editing).toBeUndefined();
    expect(afterQuick.effects).toEqual([]);
    const added = withEffect(afterQuick, effect("damage"));
    expect(added.effects).toEqual([effect("damage")]);
  });

  it("appends when the index under edit points past the list", () => {
    const stale = { ...editorFor(ability, undefined), editing: 3 };
    expect(withEffect(stale, effect("damage")).effects).toEqual([effect("damage")]);
    expect(withEffect(stale, effect("damage")).editing).toBeUndefined();
  });

  it("leaves a Feel No Pain override at tier 1 after a round trip through the editor", () => {
    const stored = fnpOverride(ability, 5);
    const raw = snapshotWith([{ id: "ab:x", name: "X", scope: "datasheet", text: "Feel No Pain 5+", isLegends: false }]);
    const saved = save(editorFor(ability, stored));
    const after = effectiveSnapshot(raw, [saved]).snapshot.data.abilities[0]!;
    expect(after.coreKeyword).toBe("FEEL NO PAIN");
    expect(abilityEffects(after)).toMatchObject({ tier: "tier1", fnp: 5 });
  });

  it("replaces the effect under edit and closes the form", () => {
    const loaded = editorFor(ability, { patch: { effects: [effect("hit-roll"), effect("wound-roll")] } });
    const edited = withEffect({ ...loaded, editing: 0 }, effect("damage"));
    expect(edited.effects).toEqual([effect("damage"), effect("wound-roll")]);
    expect(edited.editing).toBeUndefined();
  });
});

describe("effective snapshot", () => {
  const raw = snapshotWith([{ id: "ab:x", name: "X", scope: "other", text: "t", isLegends: false }]);

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
