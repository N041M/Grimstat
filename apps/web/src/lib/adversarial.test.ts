import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { flatten, scanList, fromWords, type ReadWord } from "@grimstat/adapters";
import { loadSyntheticSnapshot } from "@grimstat/snapshot";
import { readWords } from "./recognise";

/**
 * What the picture importer does with a picture that is not a clean army list.
 *
 * Thirty-four of them, in three kinds.
 *
 *   none      No army list in it at all, however list-shaped it looks: a menu, a receipt, a shopping
 *             list, a pairings table, source code, prose, a blank page, random letters. Several are
 *             written to sit close to the vocabulary on purpose, so a café serving spiced drake pie
 *             and warden's rest ale is in here. Nothing may come out of any of them.
 *   nonsense  Something list-shaped and wrong: counts of 999 and -4, a cost of 99999, names from a
 *             game the data has never heard of, a wall of the same line, a page of only wargear, a
 *             write-up that mentions units in passing. Only units the picture actually names may
 *             come out.
 *   partial   A real list with part of it gone, because a thumb, a fold, a tear, a shadow, a flash
 *             or the edge of the frame took some of it. What is still legible has to come back and
 *             what was covered must not.
 *   unreadable  Past reading altogether. Nothing has to come back, and nothing may be made up: an
 *             importer that assembles a plausible army out of noise is worse than one that gives up.
 *
 * The property under test is the one a reader cannot check for themselves. A unit that was never in
 * the picture is worse than no unit at all, because a missing unit is visible and an invented one is
 * not. Every assertion here is a form of that.
 */

interface Entry {
  readonly file: string;
  readonly kind: "none" | "nonsense" | "partial" | "unreadable";
  readonly label: string;
  readonly condition: string;
  /** Every unit this picture may produce. Anything else was invented. */
  readonly allowed: readonly string[];
  /** Units the picture no longer shows, which must not come back. */
  readonly never?: readonly string[];
  readonly atLeast: number;
}

const ROOT = join(import.meta.dirname, "../../../..");
const PICTURES = join(ROOT, "fixtures/adversarial");
const ASSETS = join(ROOT, "apps/web/public/ocr");
const MANIFEST = join(PICTURES, "manifest.json");
const ready = existsSync(join(ASSETS, "eng.traineddata.gz")) && existsSync(MANIFEST);
const manifest: Entry[] = ready ? JSON.parse(readFileSync(MANIFEST, "utf8")) : [];

const snapshot = loadSyntheticSnapshot();

function pixels(file: string): { data: Uint8ClampedArray; width: number; height: number } {
  const bytes = readFileSync(join(PICTURES, file));
  if (file.endsWith(".png")) {
    const png = PNG.sync.read(bytes);
    return { data: new Uint8ClampedArray(png.data), width: png.width, height: png.height };
  }
  const raw = jpeg.decode(bytes, { useTArray: true });
  return { data: new Uint8ClampedArray(raw.data), width: raw.width, height: raw.height };
}

function prepared(file: string): Buffer {
  const out = flatten(pixels(file));
  const png = new PNG({ width: out.width, height: out.height });
  png.data = Buffer.from(out.data.buffer, out.data.byteOffset, out.data.byteLength);
  return PNG.sync.write(png);
}

/** Units that came back and are not on the picture's allowed list. */
function strayIn(units: readonly string[], allowed: readonly string[], exhaustible: boolean): string[] {
  const left = [...allowed];
  const out: string[] = [];
  for (const unit of units) {
    const at = left.indexOf(unit);
    if (at >= 0) {
      if (exhaustible) left.splice(at, 1);
    } else out.push(unit);
  }
  return out;
}

const seen: { file: string; kind: string; units: number; stray: number }[] = [];

describe.skipIf(!ready)("pictures that are not a clean list", () => {
  let worker: Awaited<ReturnType<typeof start>> | undefined;

  async function start() {
    const { createWorker } = await import("tesseract.js");
    return createWorker("eng", 1, { langPath: ASSETS, cachePath: ASSETS, gzip: true });
  }

  beforeAll(async () => {
    worker = await start();
  }, 120_000);
  afterAll(async () => {
    await worker?.terminate();
  });

  for (const entry of manifest) {
    it(`${entry.file}`, { timeout: 120_000 }, async () => {
      const words: ReadWord[] = await readWords(worker!, prepared(entry.file), (read) => scanList(snapshot, fromWords(read)).units.length);
      const draft = scanList(snapshot, fromWords(words));
      const units = draft.units.map((u) => `${u.models} x ${u.name}`);
      // A picture holding the same line two dozen times may report it two dozen times; a picture
      // holding a list once may not report a unit more often than it is drawn.
      const stray = strayIn(units, entry.allowed, entry.kind === "partial" || entry.kind === "unreadable");
      seen.push({ file: entry.file, kind: entry.kind, units: units.length, stray: stray.length });

      expect(stray, `units invented from ${entry.file}`).toEqual([]);
      for (const gone of entry.never ?? []) expect(units, `${gone} was covered up in ${entry.file}`).not.toContain(gone);
      if (entry.kind === "none") expect(units, `${entry.file} holds no army list`).toEqual([]);
      if (entry.atLeast) expect(units.length, `too little read from ${entry.file}`).toBeGreaterThanOrEqual(entry.atLeast);

      // Whatever it made of the picture, the draft has to be a roster the app can hold.
      expect(draft.roster.units.length).toBe(units.length);
    });
  }

  it("invents nothing across the corpus", () => {
    expect(seen).toHaveLength(manifest.length);
    const empty = seen.filter((s) => s.kind === "none" && s.units === 0).length;
    const none = seen.filter((s) => s.kind === "none").length;
    const stray = seen.reduce((n, s) => n + s.stray, 0);
    console.log(`\n  ${empty}/${none} pictures with no list read as empty · ${stray} units invented across ${seen.length} pictures`);
    expect(stray).toBe(0);
    expect(empty).toBe(none);
  });
});
