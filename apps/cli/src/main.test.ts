import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WAHAPEDIA_TABLES } from "@grimstat/adapters";
import { main } from "./main";

/**
 * The command line itself: that each command's options reach the function behind it.
 *
 * The commands' own behaviour is covered where it lives; what is checked here is the wiring, which
 * is where an option can be declared, parsed and then quietly dropped.
 */

const SNAPSHOT = join(process.cwd(), "fixtures/synthetic/snapshot.json");

/** Two snapshots that differ in the price of every datasheet the fixture prices — six of them. */
function pricePair(dir: string): [string, string] {
  const before = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { id: string; data: { priceRules: Array<{ tiers: Array<{ points: number }> }> } };
  const after = JSON.parse(JSON.stringify(before)) as typeof before;
  after.id = `${before.id}-later`;
  for (const rule of after.data.priceRules) for (const tier of rule.tiers) tier.points += 5;
  const a = join(dir, "a.json");
  const b = join(dir, "b.json");
  writeFileSync(a, JSON.stringify(before));
  writeFileSync(b, JSON.stringify(after));
  return [a, b];
}

const dirs: string[] = [];
function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "grimstat-cli-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Run a command with console.log captured, and hand back what it printed. */
async function run(argv: string[]): Promise<{ code: number; out: string }> {
  const lines: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  const code = await main(argv);
  return { code, out: lines.join("\n") };
}

describe("diff --limit", () => {
  it("stops the points list at the limit and says how many more there are", async () => {
    const [a, b] = pricePair(workDir());
    const { code, out } = await run(["diff", a, b, "--limit", "2"]);
    expect(code).toBe(0);
    expect(out).toContain("points changed 6");
    expect(out).toContain("... and 4 more");
    expect(out.split("\n").filter((l) => / -> \d+ \(/.test(l))).toHaveLength(2);
  });

  it("prints every row when the limit is not reached", async () => {
    const [a, b] = pricePair(workDir());
    const { code, out } = await run(["diff", a, b]);
    expect(code).toBe(0);
    expect(out).not.toContain("more");
    expect(out.split("\n").filter((l) => / -> \d+ \(/.test(l))).toHaveLength(6);
  });

  it("refuses a limit that is not a positive whole number", async () => {
    const [a, b] = pricePair(workDir());
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await main(["diff", a, b, "--limit", "0"])).toBe(1);
    expect(await main(["diff", a, b, "--limit", "two"])).toBe(1);
  });
});

describe("the usage text", () => {
  it("names the diff limit, so the option can be found without reading the source", async () => {
    // The usage goes to stdout rather than through console.log, so it is read from there.
    let text = "";
    vi.spyOn(process.stdout, "write").mockImplementation((chunk: string | Uint8Array) => {
      text += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
      return true;
    });
    expect(await main(["help"])).toBe(0);
    expect(text).toContain("diff     <a.json> <b.json> [--limit n]");
    expect(text).toContain("mirror   [--system wh40k-11e] [--out data/mirror] [--delay ms] [--quiet]");
  });
});

/** Every request Wahapedia's mirror made, so the test can check the URLs and the user agent. */
interface Call {
  url: string;
  userAgent: string | undefined;
}

/** Stand in for Wahapedia: each table answers with a one-row pipe-separated file naming itself. */
function stubWahapedia(): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: { headers?: Record<string, string> }) => {
    calls.push({ url, userAgent: init?.headers?.["user-agent"] });
    return { ok: true, status: 200, text: async () => `name|id\n${url.split("/").pop()}|1\n` };
  });
  return calls;
}

describe("mirror", () => {
  it("writes one directory per edition, holding the tables and a meta.json", async () => {
    const dir = workDir();
    const calls = stubWahapedia();
    expect(await main(["mirror", "--system", "wh40k-11e", "--system", "wh40k-10e", "--out", dir, "--delay", "0", "--quiet"])).toBe(0);

    for (const system of ["wh40k-11e", "wh40k-10e"]) {
      expect(readFileSync(join(dir, system, "Datasheets.csv"), "utf8")).toContain("Datasheets.csv");
      expect(readFileSync(join(dir, system, "Stratagems.csv"), "utf8")).toContain("Stratagems.csv");
      const meta = JSON.parse(readFileSync(join(dir, system, "meta.json"), "utf8")) as { fetchedAt: string; gameSystemId: string; source: { id: string; url: string; attribution: string; licence: string }; tables: string[] };
      expect(meta.gameSystemId).toBe(system);
      expect(Number.isNaN(Date.parse(meta.fetchedAt))).toBe(false);
      expect(meta.source.id).toBe("wahapedia-csv");
      expect(meta.source.attribution).toContain("Wahapedia");
      expect(meta.source.licence).toBeTruthy();
      expect(meta.tables).toHaveLength(WAHAPEDIA_TABLES.length);
      expect(meta.tables).toContain("Stratagems.csv");
      expect(meta.tables.every((t) => t.endsWith(".csv"))).toBe(true);
    }
    // The editions come from the two upstream exports, and every request says who is calling.
    expect(calls.filter((c) => c.url.includes("wh40k11ed")).length).toBe(WAHAPEDIA_TABLES.length);
    expect(calls.filter((c) => c.url.includes("wh40k10ed")).length).toBe(WAHAPEDIA_TABLES.length);
    expect(calls.every((c) => (c.userAgent ?? "").startsWith("Grimstat/"))).toBe(true);
  });

  it("carries the attribution on the dataset's front page", async () => {
    const dir = workDir();
    stubWahapedia();
    expect(await main(["mirror", "--out", dir, "--delay", "0", "--quiet"])).toBe(0);
    const readme = readFileSync(join(dir, "README.md"), "utf8");
    expect(readme).toContain("Powered by Wahapedia");
    expect(readme).toContain("https://wahapedia.ru");
    // One --system was given, so only that edition is there.
    expect(existsSync(join(dir, "wh40k-11e", "meta.json"))).toBe(true);
    expect(existsSync(join(dir, "wh40k-10e"))).toBe(false);
  });

  it("refuses a game system Wahapedia has no export for, and a delay that is not a number", async () => {
    const calls = stubWahapedia();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await main(["mirror", "--system", "wh40k-9e", "--out", workDir()])).toBe(1);
    expect(await main(["mirror", "--delay", "soon", "--out", workDir()])).toBe(1);
    expect(calls).toHaveLength(0);
  });
});
