import { describe, expect, it } from "vitest";
import { RUINED_CITY, OPEN_APPROACH } from "@grimstat/board";
import type { StoredLayout } from "./layoutStore";
import { deploymentOf, dispositionsIn, groupOf, pairingOf, pickLayouts } from "./layoutPick";

const published = (id: string, name: string, deployment: string): StoredLayout => ({ layout: { id: `40kdc-${id}`, name, size: { width: 60, depth: 44 }, pieces: [], objectives: [], note: `Event Companion layout. Deployment: ${deployment}. Geometry from elsewhere.` }, builtIn: false });
const mine = (id: string, name: string): StoredLayout => ({ layout: { id, name, size: { width: 60, depth: 44 }, pieces: [], objectives: [] }, builtIn: false });
const library: StoredLayout[] = [
  { layout: RUINED_CITY, builtIn: true },
  { layout: OPEN_APPROACH, builtIn: true },
  published("take-vs-purge-02", "Take and Hold vs Purge the Foe · 2", "Sweeping Engagement"),
  published("take-vs-purge-01", "Take and Hold vs Purge the Foe · 1", "Dawn of War"),
  published("purge-vs-take-01", "Purge the Foe vs Take and Hold · 1", "Tipping Point"),
  published("recon-vs-recon-03", "Reconnaissance vs Reconnaissance · 3", "Crucible of Battle"),
  published("renamed", "Club night table", "Dawn of War"),
  mine("layout-1", "My dense table"),
];

describe("reading a published card's name", () => {
  it("takes the two dispositions and the card number, and nothing from a renamed one", () => {
    expect(pairingOf("Take and Hold vs Purge the Foe · 2")).toEqual({ you: "Take and Hold", opponent: "Purge the Foe", card: 2 });
    expect(pairingOf("Club night table")).toBeUndefined();
    expect(deploymentOf("Deployment: Sweeping Engagement. Geometry from x.")).toBe("Sweeping Engagement");
    expect(deploymentOf(undefined)).toBeUndefined();
  });

  it("lists the dispositions the cards mention, first seen first", () => {
    expect(dispositionsIn(library)).toEqual(["Take and Hold", "Purge the Foe", "Reconnaissance"]);
  });

  it("files every layout in its group", () => {
    expect(library.map(groupOf)).toEqual(["shipped", "shipped", "published", "published", "published", "published", "published", "mine"]);
  });
});

describe("filtering the library", () => {
  it("narrows the published cards to a pairing and leaves the rest alone", () => {
    const got = pickLayouts(library, { query: "", you: "Take and Hold", opponent: "Purge the Foe" });
    expect(got.published.map((l) => l.layout.name)).toEqual(["Take and Hold vs Purge the Foe · 1", "Take and Hold vs Purge the Foe · 2"]);
    expect(got.shipped).toHaveLength(2);
    expect(got.mine).toHaveLength(1);
  });

  it("filters one side at a time; a renamed card has no pairing and drops out until the filter clears", () => {
    expect(pickLayouts(library, { query: "", you: "", opponent: "Take and Hold" }).published.map((l) => l.layout.id)).toEqual(["40kdc-purge-vs-take-01"]);
    expect(pickLayouts(library, { query: "", you: "", opponent: "" }).published.map((l) => l.layout.id)).toContain("40kdc-renamed");
  });

  it("searches names and deployments, every word, any case", () => {
    expect(pickLayouts(library, { query: "dawn", you: "", opponent: "" }).published.map((l) => l.layout.id)).toEqual(["40kdc-renamed", "40kdc-take-vs-purge-01"]);
    expect(pickLayouts(library, { query: "DENSE table", you: "", opponent: "" }).mine).toHaveLength(1);
    expect(pickLayouts(library, { query: "ruined", you: "", opponent: "" }).shipped.map((l) => l.layout.id)).toEqual(["ruined-city"]);
  });

  it("sorts the published cards by name with their numbers in order", () => {
    const names = pickLayouts(library, { query: "", you: "", opponent: "" }).published.map((l) => l.layout.name);
    expect(names.indexOf("Take and Hold vs Purge the Foe · 1")).toBeLessThan(names.indexOf("Take and Hold vs Purge the Foe · 2"));
  });
});
