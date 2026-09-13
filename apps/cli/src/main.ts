#!/usr/bin/env tsx
import { parseArgs } from "node:util";
import { parseImportArgs, runImport } from "./commands/import";
import { runDiff } from "./commands/diff";
import { runShow } from "./commands/show";
import { runSynthetic } from "./commands/synthetic";
import { parseCompetitiveArgs, runCompetitive } from "./commands/competitive";
import { parseCorpusArgs, runCorpus } from "./commands/corpus";
import { parseMirrorArgs, runMirror } from "./commands/mirror";

/**
 * What each command takes, and what it does. The list of commands and each command's own `--help`
 * are both printed from this, so the two cannot drift apart.
 */
const COMMANDS: Record<string, { args: string; about: string }> = {
  import: {
    args: "--system wh40k-11e --out data/snapshots [--source mfm|wahapedia|bsdata ...] [--from-dir data] [--label text] [--overrides file.json] [--refresh] [--quiet]",
    about: "Parse the sources (local files under --from-dir, downloaded there when missing), merge, and write a checksummed snapshot.",
  },
  diff: {
    args: "<a.json> <b.json> [--limit n]",
    about: "What changed between two snapshots (entities and points). Each list stops after --limit\nrows and says how many more there are; 40 by default.",
  },
  show: {
    args: "<snapshot.json> <datasheet>",
    about: "Print a datasheet (stats, weapons, abilities, points).",
  },
  synthetic: {
    args: "[--check]",
    about: "Regenerate (or verify) the synthetic fixture snapshot.",
  },
  competitive: {
    args: "--feed <url> | --dir <folder of saved articles> [--out data/competitive]",
    about: "List the tournament write-ups a feed advertises, and pull the published army lists out of\nwrite-up pages you have saved. Article pages are never fetched: their publishers gate them.",
  },
  corpus: {
    args: "[--source minihq] [--since YYYY-MM-DD] [--out data/corpus] [--limit n] [--keep-names] [--delay ms]",
    about: "Build the published corpus: read a tournament platform whose pages a machine may read, one\nrequest a second, and fold its ended tournaments' lists and placings into monthly files.",
  },
  mirror: {
    args: "[--system wh40k-11e] [--out data/mirror] [--delay ms] [--quiet]",
    about: "Copy Wahapedia's CSV export onto disk, one directory per game system, for publishing as a\ndataset a browser can read. Repeat --system to copy more than one edition.",
  },
};

/** Where a command's options start in the list, and where a description beside them starts. */
const COMMAND_COLUMN = 9;
const ABOUT_COLUMN = 40;

/**
 * One command's entry in the list of commands. A description that still fits stays beside the
 * options; a longer one starts on the next line, under them.
 */
function usageEntry(name: string, { args, about }: { args: string; about: string }): string {
  const head = `  ${name.padEnd(COMMAND_COLUMN - 1)} ${args}`;
  const indent = " ".repeat(2 + COMMAND_COLUMN);
  const lines = about.split("\n");
  if (head.length + 2 <= ABOUT_COLUMN) return [head.padEnd(ABOUT_COLUMN) + lines[0]!, ...lines.slice(1).map((l) => indent + l)].join("\n");
  return [head, ...lines.map((l) => indent + l)].join("\n");
}

const USAGE = `grimstat <command> [options]

Commands:
${Object.entries(COMMANDS)
  .map(([name, entry]) => usageEntry(name, entry))
  .join("\n")}
`;

/** What `grimstat <command> --help` prints. */
function commandUsage(name: string, { args, about }: { args: string; about: string }): string {
  return `grimstat ${name} ${args}\n\n${about}\n`;
}

export async function main(argv: string[]): Promise<number> {
  const [cmd, ...rest] = argv;
  // parseArgs runs in strict mode and no command declares a help option, so --help has to be answered
  // before the arguments reach the command.
  if (cmd !== undefined && rest.includes("--help")) {
    const entry = COMMANDS[cmd];
    if (entry) {
      process.stdout.write(commandUsage(cmd, entry));
      return 0;
    }
  }
  try {
    switch (cmd) {
      case "import": {
        await runImport(parseImportArgs(rest));
        return 0;
      }
      case "diff": {
        const { positionals, values } = parseArgs({ args: rest, allowPositionals: true, options: { limit: { type: "string" } } });
        const [a, b] = positionals;
        if (!a || !b) throw new Error("diff needs two snapshot files");
        const limit = values.limit !== undefined ? Number(values.limit) : undefined;
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new Error("--limit needs a positive whole number");
        runDiff(a, b, undefined, limit);
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
      case "mirror": {
        return await runMirror(parseMirrorArgs(rest));
      }
      case "synthetic": {
        const { values } = parseArgs({ args: rest, options: { check: { type: "boolean", default: false } } });
        return (await runSynthetic(values.check!)) ? 0 : 1;
      }
      default:
        if (cmd === undefined || cmd === "help" || cmd === "--help") {
          process.stdout.write(USAGE);
          return 0;
        }
        // Usage printed because the command line was wrong is part of an error message, so it goes
        // to stderr with the rest of them.
        process.stderr.write(`error: unknown command "${cmd}"\n\n${USAGE}`);
        return 2;
    }
  } catch (e) {
    console.error(`error: ${(e as Error).message}`);
    return 1;
  }
}

const isEntry = process.argv[1] !== undefined && /main\.ts$|grimstat$/.test(process.argv[1]);
if (isEntry) {
  // process.exit stops the process before Node has finished writing to stdout. Writes to a pipe are
  // asynchronous, so a reader that does not take the output immediately (every pager does this)
  // loses everything still queued, with the exit code saying nothing went wrong. Setting the code
  // and letting the process end on its own lets the writes finish first.
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
