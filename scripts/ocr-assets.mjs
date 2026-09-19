/**
 * Puts the recogniser's own files where the app can serve them.
 *
 * The app fetches nothing from a content delivery network at runtime, so the WebAssembly core, the
 * worker and the language model are served from its own origin. The first two ship inside
 * `tesseract.js` and are copied out of it here. The model does not ship with anything and is
 * downloaded once, to the same folder.
 *
 * `apps/web/public/ocr` is not in the repository. Eight megabytes of binaries do not belong in a
 * git history, and every one of them can be fetched again from this script.
 */

import { createRequire } from "node:module";
import { createWriteStream } from "node:fs";
import { copyFile, mkdir, rename, rm, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "apps/web/public/ocr");

// pnpm keeps each package in its own store folder rather than hoisting it, so the two are resolved
// from the app that depends on them instead of being looked for in a shared node_modules.
const from = createRequire(join(root, "apps/web/package.json"));
const dist = dirname(from.resolve("tesseract.js/dist/worker.min.js"));
// The core is a dependency of tesseract.js rather than of the app, so it is resolved from there.
const core = dirname(createRequire(join(dist, "..", "package.json")).resolve("tesseract.js-core/package.json"));

/**
 * The English model, pinned to the fast build.
 *
 * The fast build is two megabytes against the standard one's fifteen, and the names it misreads are
 * repaired downstream by matching against the snapshot rather than by the recogniser's own
 * dictionary. Paying thirteen megabytes for that would buy very little.
 */
const MODEL = "https://raw.githubusercontent.com/naptha/tessdata/gh-pages/4.0.0_fast/eng.traineddata.gz";

/**
 * The cores, in every variant tesseract picks between.
 *
 * It chooses at runtime by what the browser supports, and asks for the file by name, so a variant
 * that is missing is a failed import rather than a slower one. Only the text-recognition cores are
 * taken: the ones that also do layout analysis are a megabyte larger and nothing here uses them.
 */
const COPY = [
  "tesseract-core-relaxedsimd-lstm.js",
  "tesseract-core-relaxedsimd-lstm.wasm",
  "tesseract-core-relaxedsimd-lstm.wasm.js",
  "tesseract-core-simd-lstm.js",
  "tesseract-core-simd-lstm.wasm",
  "tesseract-core-simd-lstm.wasm.js",
  "tesseract-core-lstm.js",
  "tesseract-core-lstm.wasm",
  "tesseract-core-lstm.wasm.js",
];

const exists = async (path) => {
  try {
    return (await stat(path)).size > 0;
  } catch {
    return false;
  }
};

/**
 * Puts a file in place only once it is whole.
 *
 * Every check here is "is it there and not empty", so a download or a copy cut short — a dropped
 * connection, a Ctrl-C during `pnpm dev` — used to leave a piece of a file that every later run
 * accepted. The recogniser then failed at runtime on a broken model and no rebuild repaired it.
 */
const intoPlace = async (path, write) => {
  const partial = `${path}.part`;
  try {
    await write(partial);
    await rename(partial, path);
  } catch (e) {
    await rm(partial, { force: true });
    throw e;
  }
};

await mkdir(out, { recursive: true });

for (const name of COPY) {
  const to = join(out, name);
  if (await exists(to)) continue;
  await intoPlace(to, (partial) => copyFile(join(core, name), partial));
  console.log(`ocr: copied ${name}`);
}

const worker = join(out, "worker.min.js");
if (!(await exists(worker))) {
  await intoPlace(worker, (partial) => copyFile(join(dist, "worker.min.js"), partial));
  console.log("ocr: copied worker.min.js");
}

const model = join(out, "eng.traineddata.gz");
if (!(await exists(model))) {
  console.log("ocr: downloading the English model, about 2 MB");
  const response = await fetch(MODEL);
  if (!response.ok || !response.body) throw new Error(`ocr: the model could not be downloaded (${response.status}). Text import still works without it. Pictures need it.`);
  await intoPlace(model, (partial) => pipeline(Readable.fromWeb(response.body), createWriteStream(partial)));
  console.log("ocr: downloaded eng.traineddata.gz");
}

console.log("ocr: ready");
