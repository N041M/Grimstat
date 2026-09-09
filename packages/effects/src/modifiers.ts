import type { EffectOp } from "@grimstat/schema";

export type RerollPolicy = "ones" | "failed" | "non-crit";

export interface Modifier {
  channel: string;
  op: EffectOp;
  value: number | string | boolean;
  source?: string;
}

export interface ChannelPolicy {
  /** Symmetric cap applied to the net sum of `add` modifiers (e.g. hit-roll ±1). */
  capAdd?: number;
  /** Minimum of the resolved value. */
  min?: number;
  /** Maximum of the resolved value. */
  max?: number;
  /** Round-up after multiply/divide (default true). */
  roundUp?: boolean;
}

const REROLL_RANK: Record<RerollPolicy, number> = { ones: 1, failed: 2, "non-crit": 3 };

/**
 * A bag of modifiers with a deterministic resolution order:
 *   set → mul → add (net, capped) → cap → clamp[min,max]
 */
export class ModifierSet {
  private readonly mods: Modifier[] = [];

  add(m: Modifier): void {
    this.mods.push(m);
  }

  addAll(ms: Iterable<Modifier>): void {
    for (const m of ms) this.mods.push(m);
  }

  list(channel?: string): Modifier[] {
    return channel ? this.mods.filter((m) => m.channel === channel) : this.mods.slice();
  }

  has(channel: string): boolean {
    return this.mods.some((m) => m.channel === channel);
  }

  /** Net sum of `add` modifiers before capping (useful for UI explanations). */
  rawAdd(channel: string): number {
    let s = 0;
    for (const m of this.mods) if (m.channel === channel && m.op === "add" && typeof m.value === "number") s += m.value;
    return s;
  }

  num(channel: string, base: number, policy: ChannelPolicy = {}): number {
    let v = base;
    const roundUp = policy.roundUp ?? true;
    for (const m of this.mods) if (m.channel === channel && m.op === "set" && typeof m.value === "number") v = m.value;
    for (const m of this.mods) {
      if (m.channel === channel && m.op === "mul" && typeof m.value === "number") {
        v = v * m.value;
        v = roundUp ? Math.ceil(v - 1e-9) : Math.floor(v + 1e-9);
      }
    }
    let add = this.rawAdd(channel);
    if (policy.capAdd !== undefined) add = Math.max(-policy.capAdd, Math.min(policy.capAdd, add));
    v += add;
    for (const m of this.mods) if (m.channel === channel && m.op === "cap" && typeof m.value === "number") v = Math.min(v, m.value);
    if (policy.min !== undefined) v = Math.max(policy.min, v);
    if (policy.max !== undefined) v = Math.min(policy.max, v);
    return v;
  }

  flag(channel: string): boolean {
    let f = false;
    for (const m of this.mods) if (m.channel === channel && m.op === "flag") f = m.value !== false;
    return f;
  }

  /** Best re-roll policy on a channel (non-crit > failed > ones). */
  reroll(channel: string): RerollPolicy | null {
    let best: RerollPolicy | null = null;
    for (const m of this.mods) {
      if (m.channel !== channel || m.op !== "reroll") continue;
      const v = m.value as string;
      if (v === "ones" || v === "failed" || v === "non-crit") {
        if (!best || REROLL_RANK[v] > REROLL_RANK[best]) best = v;
      }
    }
    return best;
  }

  oneDieReroll(channel: string): boolean {
    return this.mods.some((m) => m.channel === channel && m.op === "reroll" && m.value === "one-die");
  }

  substitute(channel: string): number | null {
    let s: number | null = null;
    for (const m of this.mods) if (m.channel === channel && m.op === "substitute" && typeof m.value === "number") s = m.value;
    return s;
  }
}
