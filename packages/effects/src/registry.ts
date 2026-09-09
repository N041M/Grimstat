import type { WeaponKeyword } from "@grimstat/schema";
import type { EvalContext } from "./conditions";
import type { ModifierSet } from "./modifiers";

export interface KeywordContext extends EvalContext {
  mods: ModifierSet;
  /** Number of models in the target unit (Blast/Cleave). */
  targetModelCount: number;
  warnings: string[];
}

export type KeywordHandler = (kw: WeaponKeyword, ctx: KeywordContext) => void;

/** Registry of Tier-1 weapon keywords. Game-system plugins register their own set. */
export class KeywordRegistry {
  private readonly handlers = new Map<string, KeywordHandler>();
  /** Keywords that are known but have no effect on the attack maths (e.g. ASSAULT). */
  private readonly inert = new Set<string>();

  register(name: string, handler: KeywordHandler): void {
    this.handlers.set(name.toUpperCase(), handler);
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

  /** Apply all keyword handlers; returns the names that were not recognised. */
  apply(keywords: WeaponKeyword[], ctx: KeywordContext): string[] {
    const unknown: string[] = [];
    for (const kw of keywords) {
      const n = kw.name.toUpperCase();
      const h = this.handlers.get(n);
      if (h) h(kw, ctx);
      else if (!this.inert.has(n)) unknown.push(kw.raw ?? kw.name);
    }
    return unknown;
  }
}
