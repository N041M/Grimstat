import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flatten, scanList, fromWords, type ReadWord } from "@grimstat/adapters";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { readWords } from "./recognise";

/**
 * The picture importer, run against fifty pictures.
 *
 * Six lists drawn in ten formats and put through twelve conditions: slides, broadcast overlays in
 * one column and two, light and dark, tournament tables, phone screenshots, chat bubbles, printed
 * pages in four typefaces, compressed video frames, and photographs taken at an angle, in warm
 * light, in glare, under-exposed, over-exposed, smeared by a moving hand, and of a screen rather
 * than of paper. They are drawn by `scripts/make-list-pictures.mjs` from seeded random numbers, so
 * the corpus is the same every run, and `manifest.json` says what is in each one.
 *
 * What is asserted is which units came out, never the recogniser's own text, because its output
 * moves with the model version and the importer's job is to be right about the army regardless.
 *
 * Two properties matter more than the counts. A picture drawn cleanly has to read exactly. A picture
 * at the edge of legibility may lose a unit but must never invent one: a list holding a unit that was
 * never in the picture is worse than one missing a unit, because the reader cannot see it is wrong.
 *
 * The recogniser needs the files `scripts/ocr-assets.mjs` fetches. Without them this skips rather
 * than fails, since a checkout that has never run the script has nothing to test.
 */

interface Entry {
  readonly file: string;
  readonly list: string;
  readonly format: string;
  readonly condition: string;
  readonly strictness: "exact" | "most";
  readonly expect: readonly string[];
  readonly faction?: string;
  readonly detachment?: string;
  readonly asksFaction?: boolean;
}

const ROOT = join(import.meta.dirname, "../../../..");
const PICTURES = join(ROOT, "fixtures/pictures");
const ASSETS = join(ROOT, "apps/web/public/ocr");
const MANIFEST = join(PICTURES, "manifest.json");
const ready = existsSync(join(ASSETS, "eng.traineddata.gz")) && existsSync(MANIFEST);
const manifest: Entry[] = ready ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];

const snapshot = loadSyntheticSnapshot();

/** A fixture as raw pixels, whichever container it was written in. */
function pixels(file: string): { data: Uint8ClampedArray; width: number; height: number } {
  const bytes = readFileSync(join(PICTURES, file));
  if (file.endsWith(".png")) {
    const png = PNG.sync.read(bytes);
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  }
  const raw = jpeg.decode(bytes, { useTArray: true });
  return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
}

/**
 * The fixture, flattened the way the app flattens a picture before recognising it.
 *
 * The app decodes with a canvas and this decodes with a library, and both call the same `flatten`.
 * Only the decoding differs, and the part worth being sure about is the part they share.
 */
function prepared(file: string): Buffer {
  const out = flatten(pixels(file));
  const png = new PNG({ width: out.width, height: out.height });
  png.data = Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength);
  return PNG.sync.write(png);
}

/** How many of a picture's units have to come back when it is not expected to read exactly. */
const floorFor = (expect: readonly string[]): number => Math.max(2, Math.ceil(expect.length * 0.6));

const nameOf = (unit: string): string => unit.replace(/^\d+ x /, "");

/**
 * How a read differs from the picture it came from.
 *
 * Two failures are worth telling apart. A unit whose datasheet was never in the picture is invented,
 * and the reader has no way to see it is wrong. A unit that is in the picture but came back the wrong
 * number of times was miscounted: the army is wrong, but everything in it is real and the points
 * total says so. The first must never happen. The second is what a misread digit does.
 */
function compare(units: readonly string[], expect: readonly string[]): { matched: number; miscounted: string[]; invented: string[] } {
  const left = [...expect];
  const names = expect.map(nameOf);
  const miscounted: string[] = [];
  const invented: string[] = [];
  let matched = 0;
  for (const unit of units) {
    const at = left.indexOf(unit);
    if (at >= 0) {
      left.splice(at, 1);
      matched++;
    } else if (names.includes(nameOf(unit))) miscounted.push(unit);
    else invented.push(unit);
  }
  return { matched, miscounted, invented };
}

/** What a run of the whole corpus came to, for the tally at the end. */
const seen: { file: string; matched: number; wanted: number; exact: boolean; miscounted: number; invented: number }[] = [];

describe.skipIf(!ready)("fifty pictures", () => {
  let worker: Awaited<ReturnType<typeof start>> | undefined;

  async function start() {
    const { createWorker } = await import("tesseract.js");
    // The segmentation modes are set by `readWords`, which runs the same two passes the app runs.
    return createWorker("eng", 1, { langPath: ASSETS, cachePath: ASSETS, gzip: true });
  }

  // One worker for all fifty, because starting one costs about as much as reading a picture with it.
  beforeAll(async () => {
    worker = await start();
  }, 120_000);
  afterAll(async () => {
    await worker?.terminate();
  });

  for (const entry of manifest) {
    it(`${entry.file} · ${entry.strictness}`, { timeout: 120_000 }, async () => {
      // Rated by how many units the read yields, which is the same judgement the app passes in.
      const words: ReadWord[] = await readWords(worker!, prepared(entry.file), (read) => scanList(snapshot, fromWords(read)).units.length);
      const draft = scanList(snapshot, fromWords(words));
      const units = draft.units.map((u) => `${u.models} x ${u.name}`);
      const wanted = [...entry.expect].sort();
      const { matched, miscounted, invented } = compare(units, entry.expect);
      seen.push({ file: entry.file, matched, wanted: entry.expect.length, exact: [...units].sort().join("|") === wanted.join("|"), miscounted: miscounted.length, invented: invented.length });

      // Whatever else a picture does to a read, a unit that was never in it must never come out of it.
      expect(invented, `invented units in ${entry.file}`).toEqual([]);
      if (entry.strictness === "exact") expect([...units].sort()).toEqual(wanted);
      else expect(matched, `too few units in ${entry.file}`).toBeGreaterThanOrEqual(floorFor(entry.expect));

      // A list whose units do not agree which army it is has to say so rather than pick one.
      if (entry.asksFaction) {
        expect(draft.army.factionId).toBeUndefined();
        expect(draft.questions.some((q) => q.kind === "faction")).toBe(true);
      } else if (entry.faction && matched >= floorFor(entry.expect)) {
        expect(draft.army.factionId, `faction of ${entry.file}`).toBe(entry.faction);
      }
    });
  }

  /*
   * The corpus as a whole. One picture failing is a picture; a quarter of them failing is the
   * importer, and a per-picture assertion cannot tell the difference. This is also where a change
   * that trades one kind of picture for another shows up.
   */
  it("reads the corpus", () => {
    expect(seen).toHaveLength(manifest.length);
    const exact = seen.filter((s) => s.exact).length;
    const complete = seen.filter((s) => s.matched >= s.wanted).length;
    const invented = seen.filter((s) => s.invented).length;
    const miscounted = seen.filter((s) => s.miscounted).length;
    const matched = seen.reduce((n, s) => n + s.matched, 0);
    const wanted = seen.reduce((n, s) => n + s.wanted, 0);
    console.log(`\n  ${exact}/${seen.length} exact · ${complete}/${seen.length} complete · ${matched}/${wanted} units · ${miscounted} miscounted · ${invented} invented`);
    expect(invented).toBe(0);
    expect(miscounted).toBeLessThanOrEqual(1);
    expect(exact / seen.length).toBeGreaterThanOrEqual(0.9);
    expect(matched / wanted).toBeGreaterThanOrEqual(0.95);
  });
});
