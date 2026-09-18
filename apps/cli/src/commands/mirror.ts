import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { SOURCES, WAHAPEDIA_TABLES, fetchSource, wahapediaUrlFor, type FetchLike, type SourceId } from "@grimstat/adapters";

/**
 * The Wahapedia mirror, the relay behind the Wahapedia half of the app's "fetch from community
 * sources" button.
 *
 * Wahapedia is the only source that carries stratagems, enhancements and rules text, and
 * wahapedia.ru sends no Access-Control-Allow-Origin header, so a browser cannot read it. This
 * command copies the CSV export onto disk, one directory per game system, one request at a time
 * under a named user agent. A scheduled job pushes the result to a dataset repository whose raw
 * URLs are CORS-enabled, and the app fetches the tables from there.
 *
 * The files keep the names the export uses, so the same adapter reads a mirrored copy and a
 * directly downloaded one. Nothing is rewritten on the way through.
 */

const UA = "Grimstat/0.1 (local-first Warhammer 40,000 statistics tool; +https://grimstat.com)";

/** The editions Wahapedia publishes an export for. */
export const MIRRORED_SYSTEMS: string[] = ["wh40k-11e", "wh40k-10e"];

/** Mirrored when no --system is given. */
const DEFAULT_SYSTEM = "wh40k-11e";

export const MIRROR_META_FILE = "meta.json";
export const MIRROR_README_FILE = "README.md";

export interface MirrorOptions {
  /** Game systems to copy; each becomes a subdirectory of `out`. */
  systems: string[];
  out: string;
  /** Milliseconds between requests. */
  delay: number;
  quiet: boolean;
}

/** What a mirrored directory records about itself, for the app to show beside the data. */
export interface MirrorMeta {
  /** When this directory's tables were fetched (ISO). */
  fetchedAt: string;
  gameSystemId: string;
  source: { id: SourceId; url: string; licence: string; attribution: string };
  /** File names in this directory, in the order the export lists them. */
  tables: string[];
}

export function parseMirrorArgs(argv: string[]): MirrorOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      system: { type: "string", multiple: true },
      out: { type: "string", default: "data/mirror" },
      delay: { type: "string", default: "1000" },
      quiet: { type: "boolean", default: false },
    },
    allowPositionals: false,
  });
  const systems = values.system?.length ? values.system : [DEFAULT_SYSTEM];
  for (const s of systems) if (!MIRRORED_SYSTEMS.includes(s)) throw new Error(`unknown system "${s}" (use ${MIRRORED_SYSTEMS.join(" | ")})`);
  const delay = Number(values.delay);
  if (!Number.isFinite(delay) || delay < 0) throw new Error("--delay needs a number of milliseconds");
  return { systems: [...new Set(systems)], out: values.out!, delay, quiet: values.quiet! };
}

/** One request at a time, a wait between them, and a user agent that says who is calling. */
function polite(fetchImpl: FetchLike, delayMs: number): FetchLike {
  let sent = 0;
  return async (url, init) => {
    if (sent++ > 0 && delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    return fetchImpl(url, { ...init, headers: { ...init?.headers, "user-agent": UA } });
  };
}

export async function runMirror(opts: MirrorOptions, fetchImpl: FetchLike = fetch as unknown as FetchLike): Promise<number> {
  const log = (s: string) => !opts.quiet && process.stdout.write(`${s}\n`);
  const def = SOURCES["wahapedia-csv"];
  const root = resolve(opts.out);
  mkdirSync(root, { recursive: true });
  const get = polite(fetchImpl, opts.delay);

  log(`Copying the Wahapedia CSV export for ${opts.systems.join(", ")} to ${root}.`);
  log(`One request every ${opts.delay} ms, identified as "${UA}".`);

  for (const gameSystemId of opts.systems) {
    const base = wahapediaUrlFor(gameSystemId);
    log("");
    log(`${gameSystemId}  ${base}`);
    const fetched = await fetchSource("wahapedia-csv", get, {
      urls: [base],
      onProgress: ({ url, index, total }) => log(`  [${index}/${total}] ${url.slice(base.length)}`),
    });

    // A table that answers with an empty body would publish a mirror the app cannot read, so the
    // whole edition is checked before any of it is written.
    const tables = Object.keys(fetched.files);
    for (const name of tables) if (!fetched.files[name]!.trim()) throw new Error(`${gameSystemId}/${name} came back empty, so nothing was written`);
    if (tables.length !== WAHAPEDIA_TABLES.length) throw new Error(`${gameSystemId}: ${tables.length} of ${WAHAPEDIA_TABLES.length} tables arrived, so nothing was written`);

    const dir = join(root, gameSystemId);
    mkdirSync(dir, { recursive: true });
    let bytes = 0;
    for (const name of tables) {
      const text = fetched.files[name]!;
      writeFileSync(join(dir, name), text);
      bytes += Buffer.byteLength(text);
    }
    const meta: MirrorMeta = {
      fetchedAt: new Date().toISOString(),
      gameSystemId,
      source: { id: def.id, url: base, licence: def.licence, attribution: def.attribution },
      tables,
    };
    writeFileSync(join(dir, MIRROR_META_FILE), `${JSON.stringify(meta, null, 2)}\n`);
    log(`  ${tables.length} tables, ${Math.round(bytes / 1024)} KiB → ${dir}`);
  }

  writeFileSync(join(root, MIRROR_README_FILE), datasetReadme());
  log("");
  log(`${opts.systems.length} game ${opts.systems.length === 1 ? "system" : "systems"} → ${root} (${MIRROR_README_FILE} written for the dataset's front page)`);
  log(def.attribution);
  return 0;
}

/** The dataset repository's front page. It travels with the data and carries the attribution. */
export function datasetReadme(): string {
  return `# Wahapedia mirror

A copy of the CSV tables Wahapedia publishes, one directory per game system. Each directory holds the
tables under the names the export uses (\`Datasheets.csv\`, \`Stratagems.csv\` and the rest), plus a
\`${MIRROR_META_FILE}\` recording when they were fetched and where they came from.

The copy exists so a browser can read them. \`wahapedia.ru\` sends no \`Access-Control-Allow-Origin\`
header, and \`raw.githubusercontent.com\` does.

## Attribution

Powered by Wahapedia — https://wahapedia.ru

The tables are Wahapedia's own export, passed through unchanged. The rules, points and names in them
are copyright Games Workshop. Wahapedia asks that the line above travels with the data, so it is
repeated in every copy of this dataset.

## How it is refreshed

Weekly, by a workflow that runs \`pnpm cli mirror\` from
[Grimstat](https://grimstat.com) and pushes the result here. The workflow can sit in
either repository; nothing in this one is written by hand.
`;
}
