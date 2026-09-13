import type { WeaponKeyword } from "@grimstat/schema";
import { evaluateCondition, targetKeywordCondition, type EvalContext } from "./conditions";
import type { ModifierSet } from "./modifiers";

export interface KeywordContext extends EvalContext {
  mods: ModifierSet;
  /** Number of models in the target unit (Blast/Cleave). */
  targetModelCount: number;
  warnings: string[];
}

export type KeywordHandler = (kw: WeaponKeyword, ctx: KeywordContext) => void;

export interface KeywordOptions {
  /** The handler reads `kw.keyword` as its own target (ANTI-X) rather than as a printed condition. */
  ownsKeyword?: boolean;
  /**
   * How the keyword is printed on a datasheet, with a value where it takes one ("Melta 2").
   *
   * A registry holds upper-case names because that is what it matches on, and "MELTA" is not what a
   * player types. This is the spelling an editor offers and the one a correction suggests. Keywords
   * that take no value need none: their name title-cased is already how they are printed.
   */
  sample?: string;
}

/** Registry of Tier-1 weapon keywords. Game-system plugins register their own set. */
export class KeywordRegistry {
  private readonly handlers = new Map<string, KeywordHandler>();
  /** Keywords that are known but have no effect on the attack maths (e.g. ASSAULT). */
  private readonly inert = new Set<string>();
  /** Keywords whose handler consumes `kw.keyword` itself, so `apply` must not read it as a condition. */
  private readonly ownsKeyword = new Set<string>();
  /** Printed spelling per name, for the ones whose name alone does not give it. */
  private readonly samples = new Map<string, string>();

  register(name: string, handler: KeywordHandler, opts: KeywordOptions = {}): void {
    const n = name.toUpperCase();
    this.handlers.set(n, handler);
    if (opts.ownsKeyword) this.ownsKeyword.add(n);
    else this.ownsKeyword.delete(n);
    if (opts.sample) this.samples.set(n, opts.sample);
    else this.samples.delete(n);
  }

  registerInert(...names: string[]): void {
    for (const n of names) this.inert.add(n.toUpperCase());
  }

  has(name: string): boolean {
    const n = name.toUpperCase();
    return this.handlers.has(n) || this.inert.has(n);
  }

  names(): string[] {
    return [...this.handlers.keys(), ...this.inert];
  }

  /** Every known keyword as it is printed, in alphabetical order. What an editor offers. */
  suggestions(): string[] {
    return this.names()
      .map((n) => this.samples.get(n) ?? titleCase(n))
      .sort((a, b) => a.localeCompare(b));
  }

  /**
   * Apply all keyword handlers; returns the names that were not recognised.
   * A keyword printed with a condition ("LETHAL HITS: non-MONSTER/VEHICLE") carries the target
   * keywords on `kw.keyword`, and its handler runs only against a target the condition admits.
   */
  apply(keywords: WeaponKeyword[], ctx: KeywordContext): string[] {
    const unknown: string[] = [];
    for (const kw of keywords) {
      const n = kw.name.toUpperCase();
      const h = this.handlers.get(n);
      if (!h) {
        if (!this.inert.has(n)) unknown.push(kw.raw ?? kw.name);
        continue;
      }
      if (kw.keyword && !this.ownsKeyword.has(n) && !evaluateCondition(targetKeywordCondition(kw.keyword), ctx)) continue;
      h(kw, ctx);
    }
    return unknown;
  }
}

/** "SUSTAINED HITS" -> "Sustained Hits"; hyphenated parts keep their own capital ("Twin-Linked"). */
function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_m, lead: string, c: string) => lead + c.toUpperCase());
}
