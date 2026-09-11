#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { parseImportArgs, runImport } from "./commands/import";
import { runDiff } from "./commands/diff";
import { runShow } from "./commands/show";
import { runSynthetic } from "./commands/synthetic";
import { parseCompetitiveArgs, runCompetitive } from "./commands/competitive";
import { parseCorpusArgs, runCorpus } from "./commands/corpus";

const USAGE = `grimstat <command> [options]

Commands:
  import   --system wh40k-11e --out data/snapshots [--source mfm|wahapedia|bsdata ...] [--from-dir data] [--label text] [--overrides file.json] [--refresh] [--quiet]
           Parse the sources (local files under --from-dir, downloaded there when missing), merge, and write a checksummed snapshot.
  diff     <a.json> <b.json>            What changed between two snapshots (entities and points).
  show     <snapshot.json> <datasheet>  Print a datasheet (stats, weapons, abilities, points).
  synthetic [--check]                   Regenerate (or verify) the synthetic fixture snapshot.
  competitive --feed <url> | --dir <folder of saved articles> [--out data/competitive]
           List the tournament write-ups a feed advertises, and pull the published army lists out of
           write-up pages you have saved. Article pages are never fetched: their publishers gate them.
  corpus   [--source minihq] [--since YYYY-MM-DD] [--out data/corpus] [--limit n] [--keep-names] [--delay ms]
           Build the published corpus: read a tournament platform whose pages a machine may read, one
           request a second, and fold its ended tournaments' lists and placings into monthly files.
`;

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case "import": {
        await runImport(parseImportArgs(rest));
        return 0;
      }
      case "diff": {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true, options: { limit: { type: "string" } } });
        const [a, b] = positionals;
        if (!a || !b) throw new Error("diff needs two snapshot files");
        runDiff(a, b);
        return 0;
      }
      case "show": {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true });
        const [file, ...query] = positionals;
        if (!file || !query.length) throw new Error("show needs a snapshot file and a datasheet name");
        const hits = runShow(file, query.join(" "));
        return hits.length ? 0 : 1;
      }
      case "competitive": {
        return await runCompetitive(parseCompetitiveArgs(rest));
      }
      case "corpus": {
        return await runCorpus(parseCorpusArgs(rest));
      }
      case "synthetic": {
        const { values } = parseArgs({ args: rest, options: { check: { type: "boolean", default: false } } });
        return (await runSynthetic(values.check!)) ? 0 : 1;
      }
      default:
        process.stdout.write(USAGE);
        return cmd === undefined || cmd === "help" || cmd === "--help" ? 0 : 2;
    }
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }
}

const isEntry = process.argv[1] !== undefined && /main\.ts$|grimstat$/.test(process.argv[1]);
if (isEntry) main(process.argv.slice(2)).then((code) => process.exit(code));
