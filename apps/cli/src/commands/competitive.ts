import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { dedupePublishedLists, parseArticle, parseFeed, parsePublishedListsFile, sourceOf, stringifyPublishedListsFile, type StoredPublishedList } from "@grimstat/adapters";

/**
 * Published tournament lists, gathered onto this machine.
 *
 * Two things this deliberately does not do.
 *
 * It does not fetch articles. Write-up pages sit behind a bot challenge their publishers put there
 * on purpose (AWS WAF answers a plainly-identified client with a 202 and an empty body), and getting
 * past it would mean pretending to be a browser. Reading a page yourself and handing the file to a
 * local tool is a different thing, and it is the supported one.
 *
 * It does not resolve the lists into units. That needs a snapshot, and a corpus kept as text
 * survives a points change, an edition change, and a different reader's game data.
 *
 * The feed is different. It is an interface published for machines and answers this tool by name,
 * so `--feed` reads it to report which write-ups exist and which are new.
 */

const UA = "Grimstat/0.1 (local-first Warhammer 40,000 statistics tool)";

export interface CompetitiveOptions {
  /** Directory of saved article HTML files to read. */
  dir?: string;
  /** Feed URL to list write-ups from. */
  feed?: string;
  out: string;
  quiet: boolean;
}

export function parseCompetitiveArgs(argv: string[]): CompetitiveOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      dir: { type: "string" },
      feed: { type: "string" },
      out: { type: "string", default: "data/competitive" },
      quiet: { type: "boolean", default: false },
    },
  });
  if (!values.dir && !values.feed) throw new Error("competitive needs --dir <saved articles> or --feed <url>");
  return { ...(values.dir ? { dir: values.dir } : {}), ...(values.feed ? { feed: values.feed } : {}), out: values.out!, quiet: values.quiet! };
}

export async function runCompetitive(opts: CompetitiveOptions): Promise<number> {
  const log = (s: string) => !opts.quiet && process.stdout.write(`${s}\n`);

  if (opts.feed) {
    const entries = await readFeed(opts.feed);
    const k40 = entries.filter((e) => e.isWarhammer40k);
    log(`${entries.length} entries in the feed, ${k40.length} for Warhammer 40,000:`);
    for (const e of k40) log(`  ${e.published ? e.published.slice(0, 16) : "".padEnd(16)}  ${e.title}\n      ${e.url}`);
    if (!opts.dir) {
      log("");
      log("Open the ones you want in a browser and save the page, then re-run with --dir <folder>.");
      log("This tool does not fetch article pages, because their publishers gate them.");
    }
    if (!opts.dir) return 0;
  }

  const dir = resolve(opts.dir!);
  const files = readdirSync(dir).filter((f) => [".html", ".htm"].includes(extname(f).toLowerCase()));
  if (!files.length) throw new Error(`no .html files in ${dir}`);

  const lists: StoredPublishedList[] = [];
  const importedAt = new Date().toISOString();
  let skipped = 0;

  for (const file of files) {
    const html = readFileSync(join(dir, file), "utf8");
    const article = parseArticle(html, sourceOf(html, basename(file, extname(file))));
    for (const w of article.warnings) log(`  ${file}: ${w}`);
    if (!article.lists.length) skipped++;
    for (const list of article.lists) lists.push({ ...list, source: article.source, importedAt });
    log(`${file}: ${article.lists.length} lists`);
  }

  mkdirSync(resolve(opts.out), { recursive: true });
  const target = join(resolve(opts.out), `lists-${importedAt.slice(0, 10)}.json`);
  const existing = readExisting(target);
  const merged = dedupePublishedLists([...existing, ...lists]);
  writeFileSync(target, stringifyPublishedListsFile(merged, importedAt));

  log("");
  log(`${merged.length} lists (${merged.length - existing.length} new) → ${target}`);
  if (skipped) log(`${skipped} files held no results.`);
  log("The lists belong to the players named in them. The file records where each came from.");
  return 0;
}

/** The feed is fetched; it answers this tool by name and exists to be read by one. */
async function readFeed(url: string): Promise<ReturnType<typeof parseFeed>> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/xml;q=0.9" } });
  if (!res.ok) throw new Error(`feed ${url} → ${res.status}`);
  return parseFeed(await res.text());
}

function readExisting(path: string): StoredPublishedList[] {
  try {
    if (!statSync(path).isFile()) return [];
    return parsePublishedListsFile(readFileSync(path, "utf8"));
  } catch {
    return [];
  }
}
