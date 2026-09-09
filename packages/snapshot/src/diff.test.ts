import { describe, expect, it } from "vitest";
import { buildSnapshot } from "./build";
import { diffSnapshots, fieldChanges } from "./diff";
import { loadSyntheticSnapshot } from "./synthetic/index";

describe("diffSnapshots", () => {
  it("reports added, removed, changed entities and per-datasheet points changes", async () => {
    const a = loadSyntheticSnapshot();
    const data = structuredClone(a.data);
    // points change (first copy, 5 models 90 -> 95) and a stat change
    for (const r of data.priceRules) if (r.datasheetId === "ds:ashen-wardens:warden-squad" && r.copyRange.min === 1) r.tiers[0]!.points = 95;
    data.datasheets.find((d) => d.id === "ds:verdant-swarm:spine-drake")!.models[0]!.T = 12;
    data.datasheets.find((d) => d.id === "ds:verdant-swarm:spine-drake")!.weapons.push({ id: "wp:x", name: "Tail sweep", kind: "melee", range: null, A: 3, skill: 3, S: 8, AP: 1, D: 2, keywords: [] });
    // removed datasheet + its rules, added ability, changed dp
    data.datasheets = data.datasheets.filter((d) => d.id !== "ds:verdant-swarm:swarm-seer");
    data.priceRules = data.priceRules.filter((r) => r.datasheetId !== "ds:verdant-swarm:swarm-seer");
    data.abilities.push({ id: "ab:new", name: "New", scope: "other", text: "t", isLegends: false });
    data.detachments[0]!.dp = 3;
    data.wargearPrices[0]!.points = 15;
    const b = await buildSnapshot({ data, now: "2026-02-02T00:00:00.000Z" });

    const d = diffSnapshots(a, b);
    expect(d.from.id).toBe(a.id);
    expect(d.summary).toEqual({ added: 1, removed: 1, changed: 3, pointsChanged: 2 });
    expect(d.added).toEqual([{ entity: "ability", id: "ab:new", name: "New" }]);
    expect(d.removed).toEqual([{ entity: "datasheet", id: "ds:verdant-swarm:swarm-seer", name: "Swarm Seer" }]);
    const drake = d.changed.find((c) => c.id === "ds:verdant-swarm:spine-drake")!;
    expect(drake.changes).toEqual([
      { field: "models[Spine Drake].T", before: 11, after: 12 },
      { field: "weapons[Tail sweep]", before: undefined, after: expect.objectContaining({ name: "Tail sweep" }) },
    ]);
    expect(d.changed.find((c) => c.entity === "detachment")!.changes).toEqual([{ field: "dp", before: 2, after: 3 }]);
    expect(d.changed.find((c) => c.entity === "wargearPrice")!.changes).toEqual([{ field: "points", before: 10, after: 15 }]);
    const squad = d.points.find((p) => p.datasheetId === "ds:ashen-wardens:warden-squad")!;
    expect(squad).toMatchObject({ name: "Warden Squad", before: 90, after: 95, delta: 5 });
    const seer = d.points.find((p) => p.datasheetId === "ds:verdant-swarm:swarm-seer")!;
    expect(seer.before).toBe(70);
    expect(seer.after).toBeUndefined();
  });

  it("is empty for identical snapshots", () => {
    const a = loadSyntheticSnapshot();
    const d = diffSnapshots(a, a);
    expect(d.summary).toEqual({ added: 0, removed: 0, changed: 0, pointsChanged: 0 });
  });

  it("compares nested named arrays per name", () => {
    expect(fieldChanges({ models: [{ name: "a", T: 4 }] }, { models: [{ name: "a", T: 5 }] })).toEqual([{ field: "models[a].T", before: 4, after: 5 }]);
    expect(fieldChanges({ x: 1 }, { x: 1 })).toEqual([]);
  });
});
