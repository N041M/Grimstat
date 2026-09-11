import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { CORPUS_INDEX_FILE, MINIHQ, addToCorpus, crawlMinihq, emptyCorpusIndex, parseCorpusIndex, parsePublishedListsFile, stringifyCorpusIndex, stringifyPublishedListsFile, type CorpusSource, type StoredPublishedList } from "@grimstat/adapters";

/**
 * The published corpus, built from a tournament platform whose pages a machine may read.
 *
 * This is the relay behind the app's "fetch the published corpus" button. It reads MiniHeadQuarters
 * for ended Warhammer 40,000 tournaments, one request a second under a named user agent, and folds
 * their lists and placings into monthly corpus files plus an index. The index remembers which
 * tournaments were fetched, so a scheduled run costs only the new ones. Player names are dropped
 * unless --keep-names is given, because the output is meant to be published.
 */

export interface CorpusOptions {
  source: "minihq";
  /** Only tournaments on or after this ISO date. */
  since: string;
  out: string;
  limit?: number;
  keepNames: boolean;
  /** Milliseconds between requests. */
  delay: number;
  quiet: boolean;
}

const DEFAULT_WINDOW_DAYS = 90;

const daysAgo = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export function parseCorpusArgs(argv: string[]): CorpusOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: "string", default: "minihq" },
      since: { type: "string" },
      out: { type: "string", default: "data/corpus" },
      limit: { type: "string" },
      "keep-names": { type: "boolean", default: false },
      delay: { type: "string", default: "1000" },
      quiet: { type: "boolean", default: false },
    },
  });
  if (values.source !== "minihq") throw new Error(`unknown corpus source "${values.source}" (only minihq is supported)`);
  const since = values.since || daysAgo(DEFAULT_WINDOW_DAYS);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error("--since needs a date as YYYY-MM-DD");
  const limit = values.limit !== undefined ? Number(values.limit) : undefined;
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit needs a positive whole number");
  const delay = Number(values.delay);
  if (!Number.isFinite(delay) || delay < 0) throw new Error("--delay needs a number of milliseconds");
  return { source: "minihq", since, out: values.out!, ...(limit !== undefined ? { limit } : {}), keepNames: values["keep-names"]!, delay, quiet: values.quiet! };
}

export const MINIHQ_SOURCE: CorpusSource = { id: MINIHQ.id, name: MINIHQ.name, url: MINIHQ.site, publication: MINIHQ.publication, attribution: MINIHQ.attribution };

export async function runCorpus(opts: CorpusOptions): Promise<number> {
  const log = (s: string) => !opts.quiet && process.stdout.write(`${s}\n`);
  const dir = resolve(opts.out);
  mkdirSync(dir, { recursive: true });

  const indexPath = join(dir, CORPUS_INDEX_FILE);
  const index = existsSync(indexPath) ? parseCorpusIndex(readFileSync(indexPath, "utf8")) : emptyCorpusIndex(MINIHQ_SOURCE);
  const files = new Map<string, StoredPublishedList[]>();
  for (const f of index.files) {
    const path = join(dir, f.name);
    if (existsSync(path)) files.set(f.name, parsePublishedListsFile(readFileSync(path, "utf8")));
  }
  const skip = new Set(index.tournaments.map((t) => t.slug));

  log(`Reading ${MINIHQ.name} for ended Warhammer 40,000 tournaments since ${opts.since}${skip.size ? `; ${skip.size} already in the corpus` : ""}.`);
  log(`One request every ${opts.delay} ms, identified as "${MINIHQ.userAgent}".`);
  const crawl = await crawlMinihq({ since: opts.since, skip, ...(opts.limit !== undefined ? { limit: opts.limit } : {}), keepNames: opts.keepNames, delayMs: opts.delay, log });
  for (const w of crawl.warnings) log(`  warning: ${w}`);
  if (!crawl.tournaments.length) {
    log(`Nothing new after ${crawl.requests} requests.`);
    return 0;
  }

  const update = addToCorpus({ ...index, source: MINIHQ_SOURCE }, files, crawl.tournaments);
  for (const name of update.touched) writeFileSync(join(dir, name), stringifyPublishedListsFile(update.files.get(name) ?? [], update.index.generatedAt));
  writeFileSync(indexPath, stringifyCorpusIndex(update.index));

  const lists = crawl.tournaments.reduce((n, t) => n + t.lists.length, 0);
  log("");
  log(`${crawl.tournaments.length} tournaments, ${lists} lists, ${crawl.requests} requests → ${dir} (${update.touched.join(", ")})`);
  log(`The corpus now holds ${update.index.tournaments.length} tournaments and ${update.index.files.reduce((n, f) => n + f.lists, 0)} lists.`);
  log(opts.keepNames ? "Player names were kept: this output carries personal data and must not be published." : "Player names were dropped; the lists belong to the players who wrote them, and every list links to the tournament it came from.");
  return 0;
}
