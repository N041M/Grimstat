import { describe, expect, it } from "vitest";
import { buildGroups, filterItems, flattenGroups, matchesQuery, PALETTE_GROUP_ORDER, stepIndex, type PaletteItem } from "./palette";

const LABELS = { goto: "Go to", scenarios: "Scenarios", armies: "Armies", units: "Units", actions: "Actions" };

const items: PaletteItem[] = [
  { id: "go:calculator", group: "goto", glyph: "C", label: "Calculator", hint: "⌘C" },
  { id: "go:scenarios", group: "goto", glyph: "S", label: "Scenarios", hint: "⌘S" },
  { id: "go:armies", group: "goto", glyph: "A", label: "Armies", hint: "⌘A" },
  { id: "sc:1", group: "scenarios", glyph: "›", label: "Walker screen clear", hint: "14.7 dmg" },
  { id: "sc:2", group: "scenarios", glyph: "›", label: "Anti-tank efficiency" },
  { id: "army:1", group: "armies", glyph: "›", label: "Ashen strike force", hint: "2,000 pts" },
  { id: "u:1", group: "units", glyph: "›", label: "Assault Infantry" },
  { id: "u:2", group: "units", glyph: "›", label: "Armoured Walker" },
  { id: "u:3", group: "units", glyph: "›", label: "Light Transport" },
  { id: "ac:new", group: "actions", glyph: "+", label: "New scenario" },
  { id: "ac:theme", group: "actions", glyph: "☾", label: "Switch to dark theme" },
];

describe("matchesQuery", () => {
  it("matches everything on a blank or whitespace-only query", () => {
    expect(matchesQuery("Calculator", "")).toBe(true);
    expect(matchesQuery("Calculator", "   ")).toBe(true);
  });

  it("matches a case-insensitive substring anywhere in the label", () => {
    expect(matchesQuery("Walker screen clear", "SCREEN")).toBe(true);
    expect(matchesQuery("Walker screen clear", "clear")).toBe(true);
    expect(matchesQuery("Walker screen clear", "walker")).toBe(true);
  });

  it("trims the query before matching", () => {
    expect(matchesQuery("Armies", "  armi ")).toBe(true);
  });

  it("rejects labels that do not contain the query", () => {
    expect(matchesQuery("Armies", "zzz")).toBe(false);
  });
});

describe("filterItems", () => {
  it("keeps input order", () => {
    expect(filterItems(items, "a").map((i) => i.id)).toEqual(["go:calculator", "go:scenarios", "go:armies", "sc:1", "sc:2", "army:1", "u:1", "u:2", "u:3", "ac:new", "ac:theme"]);
  });

  it("filters on the label only, never the hint or glyph", () => {
    expect(filterItems(items, "14.7")).toEqual([]);
    expect(filterItems(items, "⌘C")).toEqual([]);
  });
});

describe("buildGroups", () => {
  it("returns every group in the fixed order for a blank query", () => {
    const groups = buildGroups(items, "", LABELS);
    expect(groups.map((g) => g.id)).toEqual([...PALETTE_GROUP_ORDER]);
    expect(groups.map((g) => g.label)).toEqual(["Go to", "Scenarios", "Armies", "Units", "Actions"]);
  });

  it("drops groups whose items all filtered out", () => {
    const groups = buildGroups(items, "walker", LABELS);
    expect(groups.map((g) => g.id)).toEqual(["scenarios", "units"]);
    expect(groups[0]?.items.map((i) => i.id)).toEqual(["sc:1"]);
    expect(groups[1]?.items.map((i) => i.id)).toEqual(["u:2"]);
  });

  it("returns no groups when nothing matches", () => {
    expect(buildGroups(items, "nothing-like-this", LABELS)).toEqual([]);
  });

  it("caps a group after filtering, not before", () => {
    const groups = buildGroups(items, "a", LABELS, { units: 2 });
    const units = groups.find((g) => g.id === "units");
    expect(units?.items.map((i) => i.id)).toEqual(["u:1", "u:2"]);
    // Other groups are untouched by a cap that does not name them.
    expect(groups.find((g) => g.id === "goto")?.items).toHaveLength(3);
  });

  it("treats a cap of 0 as hiding the group entirely", () => {
    expect(buildGroups(items, "", LABELS, { units: 0 }).map((g) => g.id)).toEqual(["goto", "scenarios", "armies", "actions"]);
  });
});

describe("flattenGroups", () => {
  it("walks the groups in render order", () => {
    expect(flattenGroups(buildGroups(items, "sc", LABELS)).map((i) => i.id)).toEqual(["go:scenarios", "sc:1", "ac:new"]);
  });
});

describe("stepIndex", () => {
  it("moves forward and backward", () => {
    expect(stepIndex(3, 0, 1)).toBe(1);
    expect(stepIndex(3, 2, -1)).toBe(1);
  });

  it("wraps at both ends", () => {
    expect(stepIndex(3, 2, 1)).toBe(0);
    expect(stepIndex(3, 0, -1)).toBe(2);
  });

  it("returns -1 with no items", () => {
    expect(stepIndex(0, -1, 1)).toBe(-1);
  });
});
