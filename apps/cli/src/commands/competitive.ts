import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { parseArticle, parseFeed, type PublishedArticle, type PublishedList } from "@grimstat/adapters";

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
 * It does not resolve the lists into units. That needs a snapshot, and the corpus is more useful
 * kept as text: it survives a points change, an edition, and a different reader's game data.
 *
 * The feed is another matter — an interface published for machines, which answers this tool by name —
 * so `--feed` is offered for discovery: it reports which write-ups exist and which are new.
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

/** One record per published list: everything the write-up said, plus where it came from. */
interface StoredList extends PublishedList {
  readonly source: PublishedArticle["source"];
  readonly importedAt: string;
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
      log("This tool does not fetch article pages: their publishers gate them, and it respects that.");
    }
    if (!opts.dir) return 0;
  }

  const dir = resolve(opts.dir!);
  const files = readdirSync(dir).filter((f) => [".html", ".htm"].includes(extname(f).toLowerCase()));
  if (!files.length) throw new Error(`no .html files in ${dir}`);

  const lists: StoredList[] = [];
  const importedAt = new Date().toISOString();
  let skipped = 0;

  for (const file of files) {
    const html = readFileSync(join(dir, file), "utf8");
    const article = parseArticle(html, { title: titleOf(html) ?? basename(file, extname(file)), url: canonicalOf(html) ?? undefined, publication: publisherOf(html) ?? undefined });
    for (const w of article.warnings) log(`  ${file}: ${w}`);
    if (!article.lists.length) skipped++;
    for (const list of article.lists) lists.push({ ...list, source: article.source, importedAt });
    log(`${file}: ${article.lists.length} lists`);
  }

  mkdirSync(resolve(opts.out), { recursive: true });
  const target = join(resolve(opts.out), `lists-${importedAt.slice(0, 10)}.json`);
  const existing = readExisting(target);
  const merged = dedupe([...existing, ...lists]);
  writeFileSync(target, `${JSON.stringify({ format: "grimstat-published-lists", version: 1, importedAt, lists: merged }, null, 2)}\n`);

  log("");
  log(`${merged.length} lists (${merged.length - existing.length} new) → ${target}`);
  if (skipped) log(`${skipped} files held no results.`);
  log("These are other people's lists, published by other people. The file records where each came from.");
  return 0;
}

/** The feed is fetched; it answers this tool by name and exists to be read by one. */
async function readFeed(url: string): Promise<ReturnType<typeof parseFeed>> {
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "application/rss+xml, application/xml;q=0.9" } });
  if (!res.ok) throw new Error(`feed ${url} → ${res.status}`);
  return parseFeed(await res.text());
}

/**
 * The same list, published twice, is one list.
 *
 * Keyed on the player, the placing and the list text rather than on the article, because write-ups
 * run in parts and a bonus round often reprints what an earlier part already carried.
 */
function dedupe(lists: readonly StoredList[]): StoredList[] {
  const seen = new Map<string, StoredList>();
  for (const l of lists) seen.set(`${l.player ?? ""}|${l.placing ?? ""}|${l.listText.replace(/\s+/g, " ").trim()}`, l);
  return [...seen.values()];
}

function readExisting(path: string): StoredList[] {
  try {
    if (!statSync(path).isFile()) return [];
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { lists?: StoredList[] };
    return Array.isArray(parsed.lists) ? parsed.lists : [];
  } catch {
    return [];
  }
}

/**
 * Where the page says it came from.
 *
 * Provenance is the point, not decoration: these are other people's lists and the file has to be
 * able to say whose. So each is looked for in more than one place — a canonical link, then Open
 * Graph, then the browser title, which by convention ends with the publication's name.
 */
const meta = (html: string, property: string): string | undefined =>
  new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`, "i").exec(html)?.[1] ??
  new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`, "i").exec(html)?.[1];

const titleOf = (html: string): string | undefined => meta(html, "og:title") ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
const canonicalOf = (html: string): string | undefined => /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(html)?.[1] ?? meta(html, "og:url");

/** The publication's own name, or the tail of a "<article> - <publication>" browser title. */
function publisherOf(html: string): string | undefined {
  const named = meta(html, "og:site_name");
  if (named) return named;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim();
  const tail = title?.split(/\s+[-–|]\s+/).pop()?.trim();
  return tail && tail !== title ? tail : undefined;
}
