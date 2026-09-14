/**
 * Draws the test pictures for the picture importer.
 *
 * Real army lists reach people as pictures of six or seven different kinds, and a fixture that is
 * only ever a clean screenshot proves very little. These are drawn to span what actually arrives: a
 * slide, a stream overlay, a compressed video frame, a phone screenshot and two photographs of a
 * printed list, one taken in good light and one in bad.
 *
 * Every list is written in the synthetic snapshot's vocabulary, because the app ships no game data
 * and a fixture naming real units could not be resolved by anything in the repository.
 *
 * Run with `node scripts/make-list-pictures.mjs`. It shells out to a Python script because Pillow
 * draws text with real fonts and applies the blur, noise and compression the hard pictures need, and
 * nothing in this repository's dependencies does. The pictures it writes are committed, so this only
 * has to run when a fixture changes.
 */

import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = join(root, ".venv-pictures/bin/python3");
const script = join(root, "scripts/make-list-pictures.py");

if (!existsSync(python)) {
  console.error(`No interpreter at ${python}.`);
  console.error("Create one with:  python3 -m venv .venv-pictures && .venv-pictures/bin/pip install pillow");
  process.exit(1);
}

const out = spawnSync(python, [script, join(root, "fixtures")], { stdio: "inherit" });
process.exit(out.status ?? 1);
