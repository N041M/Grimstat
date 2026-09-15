/**
 * Reading the words out of a picture.
 *
 * This is the only part of the import that touches a picture. It hands back words with where they
 * sat and how sure it was, and everything after it works the same on a list that was pasted. The
 * recogniser runs on this device and the picture is never sent anywhere.
 *
 * The core, the worker and the English model are served from the app's own origin; see
 * `scripts/ocr-assets.mjs`. Nothing here reaches a content delivery network.
 */

import { flatten } from "@grimstat/adapters";
import type { ReadWord } from "@grimstat/adapters";

/** Where the recogniser's own files are served from. */
const ASSETS = `${import.meta.env?.BASE_URL ?? "/"}ocr`.replace(/\/+ocr$/, "/ocr");


export interface RecogniseProgress {
  /** Zero to one. */
  readonly done: number;
  readonly step: "loading" | "reading";
}

/**
 * How long the recogniser may go without saying anything before the reader is told.
 *
 * Its files are fetched from this origin the first time a picture is read: a worker, a WebAssembly
 * core and a language model, about seven megabytes between them. A browser that refuses one of them
 * — an old copy of the page held by the service worker, whose policy did not allow WebAssembly, is
 * the way this happened — leaves the load neither finished nor failed, and the bar sat at nothing
 * for as long as the reader was willing to watch it. Every step the recogniser reports puts this
 * off, so it only fires when nothing at all is happening.
 */
const STALL_MS = 45_000;

/** Nothing has happened for a while. Named so the screen can say something better than a stack. */
function stalledError(ms: number): Error {
  const e = new Error(`the recogniser said nothing for ${Math.round(ms / 1000)} seconds`);
  e.name = "RecogniserStalledError";
  return e;
}

/**
 * A promise that rejects once nothing has happened for `ms`. `tick` puts that off, `stop` ends it.
 *
 * Exported for the test; nothing outside this module uses it.
 */
export function stallGuard(ms: number): { stalled: Promise<never>; tick: () => void; stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let fire: (e: Error) => void = () => undefined;
  const stalled = new Promise<never>((_, reject) => {
    fire = reject;
  });
  // The rejection is never left unhandled: every caller races it against the work it is guarding.
  void stalled.catch(() => undefined);
  const arm = (): void => {
    timer = setTimeout(() => fire(stalledError(ms)), ms);
  };
  arm();
  return {
    stalled,
    tick: () => {
      if (timer !== undefined) clearTimeout(timer);
      arm();
    },
    stop: () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
    },
  };
}

export interface RecogniseOptions {
  readonly onProgress?: (progress: RecogniseProgress) => void;
  readonly signal?: AbortSignal;
}

/**
 * The picture, decoded, flattened and handed back as one the recogniser can read.
 *
 * The work is in `flatten`, shared with the tests. This only decodes and re-encodes, and gives up
 * quietly on a picture the browser will not decode, because the recogniser can still try the
 * original.
 */
async function prepare(source: Blob): Promise<Blob> {
  if (typeof createImageBitmap !== "function" || typeof OffscreenCanvas !== "function") return source;
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(source);
  } catch {
    return source;
  }
  const read = new OffscreenCanvas(bitmap.width, bitmap.height);
  const readCtx = read.getContext("2d", { willReadFrequently: true });
  if (!readCtx) return source;
  readCtx.drawImage(bitmap, 0, 0);
  const frame = readCtx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();

  const out = flatten({ data: frame.data, width: frame.width, height: frame.height });
  const write = new OffscreenCanvas(out.width, out.height);
  const writeCtx = write.getContext("2d");
  if (!writeCtx) return source;
  // Built through the context rather than with `new ImageData`, whose typing wants a buffer that is
  // not shared and a plain Uint8ClampedArray does not promise to be.
  const frameOut = writeCtx.createImageData(out.width, out.height);
  frameOut.data.set(out.data);
  writeCtx.putImageData(frameOut, 0, 0);
  return write.convertToBlob({ type: "image/png" });
}

/** The words in a picture, with where each one sat. */
export async function recognise(picture: Blob, options: RecogniseOptions = {}): Promise<ReadWord[]> {
  const { createWorker } = await import("tesseract.js");
  options.onProgress?.({ done: 0, step: "loading" });

  const guard = stallGuard(STALL_MS);
  try {
    const worker = await Promise.race([
      createWorker("eng", 1, {
        workerPath: `${ASSETS}/worker.min.js`,
        corePath: ASSETS,
        langPath: ASSETS,
        gzip: true,
        logger: (m: { status: string; progress: number }) => {
          guard.tick();
          if (options.signal?.aborted) return;
          if (m.status === "recognizing text") options.onProgress?.({ done: m.progress, step: "reading" });
          else options.onProgress?.({ done: m.progress, step: "loading" });
        },
      }),
      guard.stalled,
    ]);

    try {
      return await Promise.race([readWords(worker, await prepare(picture)), guard.stalled]);
    } finally {
      await worker.terminate();
    }
  } finally {
    guard.stop();
  }
}

/** Below this many words the recogniser has not read the picture, whatever it says about it. */
const SPARSE = 8;

/** Just enough of a tesseract worker to drive it, so the tests need not import its types. */
interface Recogniser {
  setParameters(params: Record<string, string>): Promise<unknown>;
  recognize(image: unknown, options: unknown, output: { blocks: boolean }): Promise<{ data: { blocks?: readonly ReadBlock[] | null } }>;
}

/** How a caller judges a read; see `readWords`. Higher is better. */
export type Rate = (words: readonly ReadWord[]) => number;

/** A read this poor is worth trying again, whatever the recogniser thought of it. */
const POOR = 2;

/**
 * The words in a prepared picture, in up to two passes.
 *
 * The first lets the recogniser find the blocks itself. Telling it the picture is one uniform block
 * reads a two-column overlay as one wide column, and on a compressed video frame that turned six
 * units into forty-four by joining the columns into lines that were neither.
 *
 * Finding the blocks sometimes finds nothing. On a small, sparse table it returned no words and no
 * confidence, where reading the same picture as one block returned twenty words at eighty-nine, and
 * on a dim photograph of a monospaced page it found one unit where the other way found two. So a
 * read that comes back empty, or that the caller rates poorly, is tried the other way and the better
 * of the two is kept.
 *
 * The caller supplies the rating because the recogniser has no idea what a good read is and this
 * module has no business knowing about armies. Counting the units found is what the app passes.
 * Without one, the word count stands in.
 *
 * Exported so the test that runs the fixture pictures drives the same passes with its own worker.
 */
export async function readWords(worker: Recogniser, image: unknown, rate?: Rate): Promise<ReadWord[]> {
  const read = async (mode: string): Promise<ReadWord[]> => {
    await worker.setParameters({ tessedit_pageseg_mode: mode, preserve_interword_spaces: "1" });
    return wordsFromResult((await worker.recognize(image, {}, { blocks: true })).data);
  };

  const first = await read("3");
  const firstRate = rate ? rate(first) : first.length;
  if (first.length >= SPARSE && firstRate >= POOR) return first;

  const second = await read("6");
  const secondRate = rate ? rate(second) : second.length;
  return secondRate > firstRate ? second : first;
}

/** The shape tesseract returns: blocks of paragraphs of lines of words. */
interface ReadBlock {
  readonly paragraphs?: readonly { readonly lines?: readonly { readonly words?: readonly ReadWordResult[] }[] }[];
}
interface ReadWordResult {
  readonly text?: string;
  readonly confidence?: number;
  readonly bbox?: { x0: number; y0: number; x1: number; y1: number };
}

/**
 * The words out of a recogniser's result.
 *
 * Every word is kept, however little the recogniser thought of it. Its confidence is worth showing a
 * reader but is not worth filtering on: on a clean slide it rated "Ashen" at 15 out of 100 and read
 * it perfectly, and dropping the word lost the unit. Nothing downstream needs the filter either,
 * since a word that is part of no name anchors to nothing and falls out on its own.
 *
 * Exported because the test that runs the fixture pictures drives tesseract itself, and reading its
 * result is the part worth testing rather than the part that starts a worker.
 */
export function wordsFromResult(data: { blocks?: readonly ReadBlock[] | null }): ReadWord[] {
  const out: ReadWord[] = [];
  for (const block of data.blocks ?? []) {
    for (const paragraph of block.paragraphs ?? []) {
      for (const line of paragraph.lines ?? []) {
        for (const word of line.words ?? []) {
          const text = word.text?.trim();
          const { bbox, confidence } = word;
          if (!text || !bbox) continue;
          out.push({ text, confidence: (confidence ?? 0) / 100, box: { x: bbox.x0, y: bbox.y0, w: bbox.x1 - bbox.x0, h: bbox.y1 - bbox.y0 } });
        }
      }
    }
  }
  return out;
}
