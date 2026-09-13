/**
 * What updating one source must produce.
 *
 * The run goes through the real adapters over the synthetic fixture files, with the downloads and
 * the store stubbed. The question each test asks is whether updating one source leaves the snapshot
 * the same as downloading all three would have. That is the only outcome in which every field comes
 * from the source with authority over it.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BSDATA_RAW_URL, BSDATA_TREE_URL, MFM_DEFAULT_URL } from "@grimstat/adapters";
import type { SourceRef } from "@grimstat/schema";
import type { BrowserSourceId, ImportEvent, ImportRequest } from "../lib/importProgress";

const FIXTURES = fileURLToPath(new URL("../../../../fixtures/synthetic/", import.meta.url));
const MIRROR = "https://mirror.test/wh40k-11e/";
const BSDATA_SHA = "synthetic-sha";
const BSDATA_RAW = `${BSDATA_RAW_URL}${BSDATA_SHA}/`;

function readDir(sub: string, re: RegExp): Record<string, string> {
  return Object.fromEntries(
    readdirSync(join(FIXTURES, sub))
      .filter((f) => re.test(f))
      .map((f) => [f, readFileSync(join(FIXTURES, sub, f), "utf8")]),
  );
}

/** What each source is serving. A test edits one of these to stand for an upstream update. */
const pristine = () => ({ "mfm-yaml": readDir("mfm", /\.ya?ml$/), "bsdata-json": readDir("bsdata", /\.json$/), "wahapedia-csv": readDir("wahapedia", /\.csv$/) });
type Upstream = ReturnType<typeof pristine>;

let upstream: Upstream = pristine();
let asked: string[] = [];

// The store, in memory. Loading the worker publishes its API over `globalThis`, which node has no
// listener API for.
const { kept, refuseWrites } = vi.hoisted(() => ({ kept: new Map<string, Record<string, unknown>>(), refuseWrites: { on: false } }));
vi.mock("../db", () => ({
  readSourceFiles: async (gameSystemId: string, adapter: string) => kept.get(`${gameSystemId}|${adapter}`),
  putSourceFiles: async (rec: { gameSystemId: string; adapter: string }) => {
    if (refuseWrites.on) return false;
    kept.set(`${rec.gameSystemId}|${rec.adapter}`, rec as Record<string, unknown>);
    return true;
  },
}));
vi.stubGlobal("addEventListener", () => undefined);
vi.stubGlobal("fetch", async (url: string) => {
  const body = serve(String(url));
  return body === undefined ? { ok: false, status: 404, text: async () => "" } : { ok: true, status: 200, text: async () => body };
});

function serve(url: string): string | undefined {
  asked.push(url);
  if (url.startsWith(MFM_DEFAULT_URL)) return upstream["mfm-yaml"][url.slice(MFM_DEFAULT_URL.length)];
  if (url === BSDATA_TREE_URL) return JSON.stringify({ sha: BSDATA_SHA, tree: Object.keys(upstream["bsdata-json"]).map((path) => ({ path, type: "blob" })) });
  if (url.startsWith(BSDATA_RAW)) return upstream["bsdata-json"][decodeURIComponent(url.slice(BSDATA_RAW.length))];
  if (url.startsWith(MIRROR)) return upstream["wahapedia-csv"][url.slice(MIRROR.length)];
  return undefined;
}

const { api } = await import("./import.worker");

const ALL: BrowserSourceId[] = ["mfm-yaml", "bsdata-json", "wahapedia-csv"];
const request = (sources: BrowserSourceId[], base?: SourceRef[]): ImportRequest => ({ gameSystemId: "wh40k-11e", sources, label: "test", wahapediaMirror: MIRROR, ...(base ? { base } : {}) });

/** Run the worker and hand back the snapshot with the events it emitted. */
async function run(req: ImportRequest) {
  const events: ImportEvent[] = [];
  asked = [];
  const { snapshot } = await api.run(req, (e) => void events.push(e));
  return { snapshot, events, downloaded: (events.find((e) => e.type === "planned") as { sources: BrowserSourceId[] }).sources };
}

/** The fields each source has authority over, as the merged snapshot holds them. */
const points = (d: { data: { priceRules: Array<{ datasheetId: string; tiers: Array<{ points: number }> }> } }, id: string) => d.data.priceRules.filter((r) => r.datasheetId === id).flatMap((r) => r.tiers.map((t) => t.points));
const abilityText = (d: { data: { abilities: Array<{ id: string; text: string }> } }, id: string) => d.data.abilities.find((a) => a.id === id)?.text;
const CRUSHER = "ds:ashen-wardens:ashen-crusher";
const PLATING = "ab:ashen-wardens:ashen-crusher:ablative-plating";

/** Each source's upstream update, and the file it lands in. */
const EDITS: Record<BrowserSourceId, [string, string, string]> = {
  "mfm-yaml": ["ashen-wardens.yaml", "points: 150", "points: 155"],
  "bsdata-json": ["Imperium - Ashen Wardens - Library.json", '"typeId": "ct-pts",\n            "value": 80', '"typeId": "ct-pts",\n            "value": 111'],
  "wahapedia-csv": ["Datasheets_abilities.csv", "This model has a 5+ invulnerable save against ranged attacks.", "This model has a 4+ invulnerable save against ranged attacks."],
};

function publish(id: BrowserSourceId): void {
  const [file, from, to] = EDITS[id];
  const files = upstream[id] as Record<string, string>;
  const edited = files[file]!.replace(from, to);
  expect(edited, `the ${id} fixture no longer contains ${JSON.stringify(from)}`).not.toBe(files[file]);
  files[file] = edited;
}

beforeEach(() => {
  upstream = pristine();
  kept.clear();
  refuseWrites.on = false;
});

describe("importing every source", () => {
  it("keeps the files each source arrived as", async () => {
    const { snapshot } = await run(request(ALL));
    expect([...kept.keys()].sort()).toEqual(["wh40k-11e|bsdata-json", "wh40k-11e|mfm-yaml", "wh40k-11e|wahapedia-csv"]);
    // What was kept records which download it was, so a later run can tell it built this snapshot.
    for (const source of snapshot.sources) {
      const rec = kept.get(`wh40k-11e|${source.adapter}`)!;
      expect(rec["fetchedAt"]).toBe(source.fetchedAt);
      expect(rec["url"]).toBe(source.url);
    }
  });

  it("finishes when the browser will not keep the files", async () => {
    refuseWrites.on = true;
    const { snapshot } = await run(request(ALL));
    expect(snapshot.data.datasheets.length).toBeGreaterThan(0);
    expect(kept.size).toBe(0);
  });
});

describe("updating one source", () => {
  for (const id of ALL) {
    describe(id, () => {
      it("downloads that source alone and leaves the snapshot as it was", async () => {
        const first = await run(request(ALL));
        const again = await run(request([id], first.snapshot.sources));
        expect(again.downloaded).toEqual([id]);
        expect(asked.every((u) => !u.startsWith(MIRROR) || id === "wahapedia-csv")).toBe(true);
        expect(again.snapshot.checksum).toBe(first.snapshot.checksum);
      });

      it("produces what downloading all three would have", async () => {
        // The bar the old merge could not meet. Updating one source has to leave the snapshot the
        // same as a full download of the same files would have, whichever source it is.
        const first = await run(request(ALL));
        publish(id);
        const refreshed = await run(request([id], first.snapshot.sources));
        const full = await run(request(ALL));
        expect(refreshed.downloaded).toEqual([id]);
        expect(refreshed.snapshot.checksum).toBe(full.snapshot.checksum);
        expect(refreshed.snapshot.conflicts).toEqual(full.snapshot.conflicts);
      });
    });
  }

  it("moves MFM's points and leaves Wahapedia's rules text alone", async () => {
    const first = await run(request(ALL));
    expect(points(first.snapshot, CRUSHER)).toContain(150);
    publish("mfm-yaml");
    const { snapshot } = await run(request(["mfm-yaml"], first.snapshot.sources));
    expect(points(snapshot, CRUSHER)).toContain(155);
    expect(abilityText(snapshot, PLATING)).toBe(abilityText(first.snapshot, PLATING));
  });

  it("moves Wahapedia's rules text and leaves MFM's points alone", async () => {
    const first = await run(request(ALL));
    expect(abilityText(first.snapshot, PLATING)).toContain("5+ invulnerable");
    publish("wahapedia-csv");
    const { snapshot } = await run(request(["wahapedia-csv"], first.snapshot.sources));
    expect(abilityText(snapshot, PLATING)).toContain("4+ invulnerable");
    expect(points(snapshot, CRUSHER)).toEqual(points(first.snapshot, CRUSHER));
  });

  it("takes BSData's new values into the merge and leaves MFM's points and Wahapedia's text alone", async () => {
    // Nothing in this fixture is BSData's to decide. MFM covers every price and Wahapedia every
    // piece of rules text, so BSData's values reach the merge and lose every time. What they leave
    // behind is the recorded disagreement, and that is what shows the fresh part reached the merge.
    // `merge.test.ts` puts the same question to a source that does own the field.
    const first = await run(request(ALL));
    const was = first.snapshot.conflicts.find((c) => c.id === "ds:ashen-wardens:warden-captain" && c.field === "points")!;
    expect(was.candidates.find((c) => c.adapter === "bsdata-json")!.value).toContain("80");
    publish("bsdata-json");
    const { snapshot } = await run(request(["bsdata-json"], first.snapshot.sources));
    const now = snapshot.conflicts.find((c) => c.id === "ds:ashen-wardens:warden-captain" && c.field === "points")!;
    expect(now.candidates.find((c) => c.adapter === "bsdata-json")!.value).toContain("111");
    expect(now.chosen).toBe(was.chosen);
    expect(points(snapshot, CRUSHER)).toEqual(points(first.snapshot, CRUSHER));
    expect(abilityText(snapshot, PLATING)).toBe(abilityText(first.snapshot, PLATING));
  });
});

describe("when the files are not here to read back", () => {
  it("downloads every source of the snapshot", async () => {
    const first = await run(request(ALL));
    kept.clear();
    const { snapshot, downloaded } = await run(request(["bsdata-json"], first.snapshot.sources));
    expect(downloaded).toEqual(ALL);
    expect(snapshot.checksum).toBe(first.snapshot.checksum);
  });

  it("changes nothing when a source the snapshot needs will not answer", async () => {
    // Going on would write a snapshot with no rules text at all over one that had it.
    const first = await run(request(ALL));
    kept.delete("wh40k-11e|wahapedia-csv");
    upstream["wahapedia-csv"] = {};
    await expect(run(request(["mfm-yaml"], first.snapshot.sources))).rejects.toThrow(/could not be fetched/);
  });

  it("still builds a first import when the mirror will not answer", async () => {
    upstream["wahapedia-csv"] = {};
    const { snapshot } = await run(request(ALL));
    expect(snapshot.sources.map((s) => s.adapter)).toEqual(["mfm-yaml", "bsdata-json"]);
  });

  it("downloads the one source whose files came from a different download", async () => {
    const first = await run(request(ALL));
    const rec = kept.get("wh40k-11e|wahapedia-csv")!;
    kept.set("wh40k-11e|wahapedia-csv", { ...rec, fetchedAt: "2020-01-01T00:00:00.000Z" });
    const { downloaded } = await run(request(["mfm-yaml"], first.snapshot.sources));
    expect(downloaded).toEqual(["mfm-yaml", "wahapedia-csv"]);
  });
});
