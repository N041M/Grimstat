import { BREACHERS, BATTLE_SIZES, CROSSFIRE, LAYOUTS, OPEN_APPROACH, REDOUBT, RUINED_CITY, edgeZones, signedArea, type TerrainLayout } from "@grimstat/board";
import { describe, expect, it } from "vitest";
import { toLayoutFile } from "./export";
import { LayoutImportError, parseLayoutFile, type ImportedLayout } from "./import";
import { LAYOUT_FILE_VERSION, MM_PER_INCH, type LayoutEntry, type LayoutFile, type LayoutPiece } from "./schema";

const SF = BATTLE_SIZES.strikeForce;

/** A minimal layout that is unambiguously playable, so a test can break exactly one thing about it. */
const piece = (over: Partial<LayoutPiece> = {}): LayoutPiece => ({
  id: "p1",
  polygon: [
    [8, 8],
    [12, 8],
    [12, 12],
    [8, 12],
  ],
  base: 0,
  height: 4,
  traits: ["obscuring"],
  floors: [0],
  passableBy: [],
  climbableBy: [],
  ...over,
});

const entry = (over: Partial<LayoutEntry> = {}): LayoutEntry => ({
  id: "test",
  name: "Test",
  size: { width: SF.width, depth: SF.depth },
  pieces: [piece()],
  objectives: [{ id: "obj1", at: [30, 22] }],
  ...over,
});

const file = (over: Partial<LayoutFile> = {}): LayoutFile => ({
  version: LAYOUT_FILE_VERSION,
  units: "in",
  layouts: [entry()],
  ...over,
});

/** A file built around a single deliberately broken or sloppy piece. */
const withPiece = (over: Partial<LayoutPiece>): LayoutFile => file({ layouts: [entry({ pieces: [piece(over)] })] });

const issuesOf = (input: unknown): readonly string[] => {
  try {
    parseLayoutFile(input);
  } catch (e) {
    if (e instanceof LayoutImportError) return e.issues;
    throw e;
  }
  throw new Error("expected the file to be rejected, but it imported");
};

const only = (input: unknown): ImportedLayout => {
  const { layouts } = parseLayoutFile(input);
  const first = layouts[0];
  if (!first) throw new Error("expected one layout");
  return first;
};

describe("round-tripping", () => {
  it.each(LAYOUTS.map((l) => [l.name, l] as const))("round-trips %s without losing anything", (_name, layout) => {
    expect(only(toLayoutFile([layout]))).toEqual(layout);
  });

  it("round-trips the whole shipped set in one file", () => {
    const { layouts, warnings } = parseLayoutFile(toLayoutFile(LAYOUTS));
    expect(layouts).toEqual([OPEN_APPROACH, RUINED_CITY, CROSSFIRE, REDOUBT]);
    expect(warnings).toEqual([]);
  });

  it("survives the JSON text it is meant to be written as", () => {
    const text = JSON.stringify(toLayoutFile(LAYOUTS), null, 2);
    expect(parseLayoutFile(text).layouts).toEqual(LAYOUTS);
  });

  it("is a fixed point: exporting what was imported reproduces the same file", () => {
    const first = toLayoutFile(LAYOUTS, { source: "Grimstat", licence: "CC0" });
    const second = toLayoutFile(parseLayoutFile(first).layouts, { source: "Grimstat", licence: "CC0" });
    expect(toLayoutFile(parseLayoutFile(second).layouts, { source: "Grimstat", licence: "CC0" })).toEqual(second);
  });

  it("keeps the sealed bunkers in Redoubt off the ground floor", () => {
    // The exporter must write `floors` explicitly: an absent one would grow a ground floor here.
    const bunker = only(toLayoutFile([REDOUBT])).pieces.find((p) => p.id === "bunker1");
    expect(bunker?.floors).toEqual([5]);
  });

  it("carries deployment zones and provenance, which TerrainLayout has no room for", () => {
    const zones = edgeZones(SF);
    const source: ImportedLayout = { ...CROSSFIRE, zones, provenance: { source: "Club night", author: "K. Grant", licence: "CC BY 4.0", importedFrom: "club-pack.json" } };
    const back = only(toLayoutFile([source]));
    expect(back.zones).toEqual(zones);
    expect(back.provenance).toEqual(source.provenance);
  });

  it("writes the zones of a plain TerrainLayout too — they are the board's own field, not the importer's", () => {
    const zones = edgeZones(SF);
    const plain: TerrainLayout = { ...CROSSFIRE, zones };
    expect(only(toLayoutFile([plain]))).toEqual(plain);
  });

  it("treats an empty provenance field on a layout as unsaid, so the envelope's value still applies", () => {
    // Export writes nothing for "", and import has to read "" the same way: a hand-edited file with
    // `"author": ""` on one layout must not strip that layout of the bundle's author.
    const f = toLayoutFile([OPEN_APPROACH], { source: "Club night", author: "K. Grant" });
    const first = f.layouts[0];
    if (!first) throw new Error("expected one layout");
    first.author = "";
    expect(parseLayoutFile(f).layouts[0]?.provenance).toEqual({ source: "Club night", author: "K. Grant" });
  });

  it("lets a layout inherit the envelope's provenance and override one field of it", () => {
    const f = toLayoutFile([OPEN_APPROACH, RUINED_CITY], { source: "Club night", licence: "CC BY 4.0" });
    const second = f.layouts[1];
    if (!second) throw new Error("expected two layouts");
    second.author = "Someone else";
    const { layouts } = parseLayoutFile(f);
    expect(layouts[0]?.provenance).toEqual({ source: "Club night", licence: "CC BY 4.0" });
    expect(layouts[1]?.provenance).toEqual({ source: "Club night", licence: "CC BY 4.0", author: "Someone else" });
  });
});

describe("rejecting what would produce a broken board", () => {
  it("rejects a footprint with fewer than three points", () => {
    expect(issuesOf(withPiece({ polygon: [[8, 8], [12, 8]] }))).toEqual(["test/p1: footprint needs at least 3 distinct points, got 2"]);
  });

  it("rejects a footprint that collapses to two points once its repeats are removed", () => {
    expect(issuesOf(withPiece({ polygon: [[8, 8], [12, 8], [12, 8], [8, 8]] }))[0]).toMatch(/at least 3 distinct points/);
  });

  it("rejects a footprint with no area", () => {
    expect(issuesOf(withPiece({ polygon: [[8, 8], [12, 8], [16, 8]] }))).toEqual(["test/p1: footprint encloses no area"]);
  });

  it("rejects a negative height rather than flattening it to a marker", () => {
    expect(issuesOf(withPiece({ height: -4 }))).toEqual(["test/p1: height is negative (-4)"]);
  });

  it("rejects a non-finite length", () => {
    expect(issuesOf(withPiece({ height: Number.POSITIVE_INFINITY })).join(" ")).toMatch(/height/);
    expect(issuesOf(withPiece({ base: Number.NaN })).join(" ")).toMatch(/base/);
  });

  it("rejects a floor above the roof", () => {
    expect(issuesOf(withPiece({ height: 4, floors: [0, 9] }))).toEqual(['test/p1: floor at 9" is outside the piece']);
  });

  it("rejects a floor below the piece", () => {
    expect(issuesOf(withPiece({ floors: [-2] }))[0]).toMatch(/is outside the piece/);
  });

  it("rejects a piece hanging off the table", () => {
    expect(issuesOf(withPiece({ polygon: [[58, 8], [64, 8], [64, 12], [58, 12]] }))).toEqual(["test/p1: hangs off the table"]);
  });

  it("rejects two pieces sharing an id", () => {
    expect(issuesOf(file({ layouts: [entry({ pieces: [piece(), piece()] })] }))).toEqual(["test/p1: duplicate piece id"]);
  });

  it("rejects two layouts sharing an id", () => {
    expect(issuesOf(file({ layouts: [entry(), entry()] }))).toEqual(["test: duplicate layout id"]);
  });

  it("rejects two objectives sharing an id", () => {
    const objectives = [{ id: "obj1", at: [30, 22] as [number, number] }, { id: "obj1", at: [15, 11] as [number, number] }];
    expect(issuesOf(file({ layouts: [entry({ objectives })] }))).toEqual(["test/obj1: duplicate objective id"]);
  });

  it("rejects an objective off the table", () => {
    expect(issuesOf(file({ layouts: [entry({ objectives: [{ id: "obj1", at: [30, 99] }] })] }))).toEqual(["test/obj1: off the table"]);
  });

  it("rejects an objective marooned inside impassable terrain", () => {
    const bunker = piece({ id: "bunker", traits: ["impassable"] });
    expect(issuesOf(file({ layouts: [entry({ pieces: [bunker], objectives: [{ id: "obj1", at: [10, 10] }] })] }))).toEqual(["test/obj1: sits inside impassable terrain (bunker)"]);
  });

  it("rejects a board with no size", () => {
    expect(issuesOf(file({ layouts: [entry({ size: { width: 0, depth: 44 } })] })).join(" ")).toMatch(/size\.width/);
  });

  it("rejects a version it does not understand", () => {
    expect(issuesOf({ ...file(), version: 2 }).join(" ")).toMatch(/version/);
  });

  it("rejects a document that is not a layout file at all", () => {
    expect(issuesOf({ hello: "world" }).length).toBeGreaterThan(0);
    expect(issuesOf("not json at all")[0]).toMatch(/Not valid JSON/);
  });

  it("reports every broken layout in the file, not just the first", () => {
    const bad = file({ layouts: [entry({ id: "a", pieces: [piece({ height: -1 })] }), entry({ id: "b", objectives: [{ id: "o", at: [999, 1] }] })] });
    expect(issuesOf(bad)).toEqual(["a/p1: height is negative (-1)", "b/o: off the table"]);
  });
});

describe("forgiving what is merely sloppy", () => {
  it("accepts a footprint wound clockwise and stores it counter-clockwise", () => {
    const clockwise = only(withPiece({ polygon: [[8, 8], [8, 12], [12, 12], [12, 8]] }));
    const ring = clockwise.pieces[0]?.polygon ?? [];
    expect(signedArea(ring)).toBeGreaterThan(0);
    expect(parseLayoutFile(withPiece({})).warnings).toEqual([]);
  });

  it("accepts a ring that repeats its first point to close itself", () => {
    const closed = only(withPiece({ polygon: [[8, 8], [12, 8], [12, 12], [8, 12], [8, 8]] }));
    expect(closed.pieces[0]?.polygon).toHaveLength(4);
    expect(parseLayoutFile(withPiece({ polygon: [[8, 8], [12, 8], [12, 12], [8, 12], [8, 8]] })).warnings).toEqual([]);
  });

  it("drops a trait this build has never heard of and says so", () => {
    const { layouts, warnings } = parseLayoutFile(withPiece({ traits: ["obscuring", "sporecloud", "heavy-cover"] }));
    expect(layouts[0]?.pieces[0]?.traits).toEqual(["obscuring", "heavy-cover"]);
    expect(warnings).toEqual(['test/p1: dropped unknown terrain trait "sporecloud".']);
  });

  it("drops a duplicated floor and says so", () => {
    const { layouts, warnings } = parseLayoutFile(withPiece({ floors: [0, 4, 4] }));
    expect(layouts[0]?.pieces[0]?.floors).toEqual([0, 4]);
    expect(warnings).toEqual(['test/p1: dropped a duplicate floor at 4".']);
  });

  it("treats an absent floors list as an ordinary ground-level piece", () => {
    const { floors, ...rest } = piece();
    void floors;
    expect(only(file({ layouts: [entry({ pieces: [rest] })] })).pieces[0]?.floors).toEqual([0]);
  });

  it("keeps an explicitly empty floors list empty", () => {
    expect(only(withPiece({ floors: [] })).pieces[0]?.floors).toEqual([]);
  });

  it("upper-cases keywords so a mixed-case file still keeps tanks off the first floor", () => {
    const p = only(withPiece({ climbableBy: ["infantry", " Character ", "INFANTRY"], passableBy: ["infantry"] })).pieces[0];
    expect(p?.climbableBy).toEqual(["INFANTRY", "CHARACTER"]);
    expect(p?.passableBy).toEqual(["INFANTRY"]);
  });

  it("ignores an objective radius or range of zero and falls back to the default", () => {
    const objectives = [{ id: "obj1", at: [30, 22] as [number, number], markerRadius: 0, range: -3 }];
    const { layouts, warnings } = parseLayoutFile(file({ layouts: [entry({ objectives })] }));
    expect(layouts[0]?.objectives[0]).toEqual({ id: "obj1", at: { x: 30, y: 22 } });
    expect(warnings).toEqual(["test/obj1: ignored markerRadius of 0 — it must be greater than zero.", "test/obj1: ignored range of -3 — it must be greater than zero."]);
  });

  it("drops a deployment zone that is not a polygon without losing the layout", () => {
    const zones = [{ id: "z1", owner: "attacker" as const, polygon: [[0, 0], [10, 0]] as [number, number][] }];
    const { layouts, warnings } = parseLayoutFile(file({ layouts: [entry({ zones })] }));
    expect(layouts[0]?.zones).toEqual([]);
    expect(warnings).toEqual(['test: dropped deployment zone "z1" — its outline is not a polygon.']);
  });

  it("drops a second deployment zone with the same id", () => {
    const zone = { id: "z1", owner: "attacker" as const, polygon: [[0, 0], [10, 0], [10, 10]] as [number, number][] };
    const { layouts, warnings } = parseLayoutFile(file({ layouts: [entry({ zones: [zone, zone] })] }));
    expect(layouts[0]?.zones).toHaveLength(1);
    expect(warnings).toEqual(['test: dropped a second deployment zone with id "z1".']);
  });

  it("warns rather than throws when a file contains no layouts", () => {
    expect(parseLayoutFile(file({ layouts: [] }))).toEqual({ layouts: [], warnings: ["File contains no layouts."] });
  });

  it("ignores fields a later version of the format might add", () => {
    const forward = { ...file(), hexTiles: true, layouts: [{ ...entry(), mood: "grim" }] };
    expect(only(forward).id).toBe("test");
  });
});

describe("units", () => {
  const mm = (inches: number): number => inches * MM_PER_INCH;

  it("converts a millimetre file to inches and says that it did", () => {
    const metric: LayoutFile = {
      version: LAYOUT_FILE_VERSION,
      units: "mm",
      layouts: [
        {
          id: "metric",
          name: "Metric",
          size: { width: mm(60), depth: mm(44) },
          pieces: [piece({ polygon: [[mm(8), mm(8)], [mm(12), mm(8)], [mm(12), mm(12)], [mm(8), mm(12)]], base: mm(1), height: mm(4), floors: [0, mm(2)] })],
          objectives: [{ id: "obj1", at: [mm(30), mm(22)], z: mm(4), markerRadius: mm(0.5), range: mm(3) }],
        },
      ],
    };
    const { layouts, warnings } = parseLayoutFile(metric);
    const layout = layouts[0];
    expect(warnings).toEqual(["File is in millimetres; every length was converted to inches."]);
    expect(layout?.size.width).toBeCloseTo(60, 10);
    expect(layout?.size.depth).toBeCloseTo(44, 10);
    expect(layout?.pieces[0]?.height).toBeCloseTo(4, 10);
    expect(layout?.pieces[0]?.base).toBeCloseTo(1, 10);
    expect(layout?.pieces[0]?.floors[1]).toBeCloseTo(2, 10);
    expect(layout?.objectives[0]?.at.x).toBeCloseTo(30, 10);
    expect(layout?.objectives[0]?.range).toBeCloseTo(3, 10);
  });

  it("measures a millimetre board against the table in inches, not in millimetres", () => {
    // 1524 mm is 60 inches; a piece at 1500 mm is on the table, one at 1600 mm is not.
    const off: LayoutFile = { version: LAYOUT_FILE_VERSION, units: "mm", layouts: [{ ...entry({ size: { width: mm(60), depth: mm(44) } }), pieces: [piece({ polygon: [[1500, 100], [1600, 100], [1600, 200], [1500, 200]] })] }] };
    expect(issuesOf(off)).toEqual(["test/p1: hangs off the table"]);
  });

  it("assumes inches when the file does not say, rather than guessing from magnitudes", () => {
    const silent = { version: LAYOUT_FILE_VERSION, layouts: [entry()] };
    expect(only(silent).size).toEqual({ width: 60, depth: 44 });
  });

  it("always writes inches, because a millimetre round trip would not be exact", () => {
    const exported = toLayoutFile([OPEN_APPROACH]);
    expect(exported.units).toBe("in");
  });
});

describe("toLayoutFile", () => {
  it("writes an envelope a reader can version-check before touching the layouts", () => {
    const f = toLayoutFile([OPEN_APPROACH], { source: "Grimstat", author: "Grimstat", licence: "CC0", importedFrom: "built-in" });
    expect(f.version).toBe(LAYOUT_FILE_VERSION);
    expect(f.source).toBe("Grimstat");
    expect(f.importedFrom).toBe("built-in");
    expect(f.layouts).toHaveLength(1);
  });

  it("omits provenance fields nobody set rather than writing empty strings", () => {
    const f = toLayoutFile([OPEN_APPROACH], { source: "", author: "K. Grant" });
    expect(f).not.toHaveProperty("source");
    expect(f.author).toBe("K. Grant");
  });

  it("accepts a plain TerrainLayout with no zones and no provenance", () => {
    const plain: TerrainLayout = { id: "bare", name: "Bare", size: SF, pieces: [], objectives: [] };
    const back = only(toLayoutFile([plain]));
    expect(back).toEqual(plain);
    expect(back.zones).toBeUndefined();
    expect(back.provenance).toBeUndefined();
  });
});

describe("breachable walls in older files", () => {
  it("assumes the default breachers when a breachable piece names nobody, and says so", () => {
    const { layouts, warnings } = parseLayoutFile(withPiece({ traits: ["obscuring", "breachable"], floors: [0, 4] }));
    expect(layouts[0]!.pieces[0]!.passableBy).toEqual([...BREACHERS]);
    expect(warnings).toEqual([expect.stringMatching(/breachable walls name nobody/)]);
  });

  it("leaves a breachable piece that names its own list alone", () => {
    const { layouts, warnings } = parseLayoutFile(withPiece({ traits: ["breachable"], passableBy: ["monster"] }));
    expect(layouts[0]!.pieces[0]!.passableBy).toEqual(["MONSTER"]);
    expect(warnings).toEqual([]);
  });
});

