import type { Condition } from "@grimstat/schema";

export interface EvalContext {
  attackerKeywords: Set<string>;
  targetKeywords: Set<string>;
  weaponKind: "ranged" | "melee";
  weaponKeywords: Set<string>;
  rangeBand: "half" | "full";
  charged: boolean;
  stationary: boolean;
  inCover: boolean;
  phase: string;
  flags: Set<string>;
}

const norm = (s: string) => s.trim().toUpperCase();

export function evaluateCondition(c: Condition | undefined, ctx: EvalContext): boolean {
  if (!c) return true;
  if (c.all && !c.all.every((x) => evaluateCondition(x, ctx))) return false;
  if (c.any && !c.any.some((x) => evaluateCondition(x, ctx))) return false;
  if (c.not && evaluateCondition(c.not, ctx)) return false;
  if (c.targetKeyword !== undefined && !ctx.targetKeywords.has(norm(c.targetKeyword))) return false;
  if (c.targetNotKeyword !== undefined && ctx.targetKeywords.has(norm(c.targetNotKeyword))) return false;
  if (c.attackerKeyword !== undefined && !ctx.attackerKeywords.has(norm(c.attackerKeyword))) return false;
  if (c.weaponKind !== undefined && ctx.weaponKind !== c.weaponKind) return false;
  if (c.weaponKeyword !== undefined && !ctx.weaponKeywords.has(norm(c.weaponKeyword))) return false;
  if (c.rangeBand !== undefined && ctx.rangeBand !== c.rangeBand) return false;
  if (c.charged !== undefined && ctx.charged !== c.charged) return false;
  if (c.stationary !== undefined && ctx.stationary !== c.stationary) return false;
  if (c.inCover !== undefined && ctx.inCover !== c.inCover) return false;
  if (c.phase !== undefined && ctx.phase !== c.phase) return false;
  if (c.flag !== undefined && !ctx.flags.has(c.flag)) return false;
  return true;
}

/**
 * Read the target-keyword text an adapter leaves on `WeaponKeyword.keyword` — "VEHICLE",
 * "MONSTER/VEHICLE", "NON-MONSTER/VEHICLE" — as a condition. Slash-separated names mean "any of";
 * a leading "NON-" negates the whole list. Empty text yields no condition.
 */
export function targetKeywordCondition(text: string | undefined | null): Condition | undefined {
  if (!text) return undefined;
  let body = norm(text);
  const negated = /^NON[\s-]+/.test(body);
  if (negated) body = body.replace(/^NON[\s-]+/, "").trim();
  const names = body.split("/").map((s) => s.trim()).filter(Boolean);
  if (!names.length) return undefined;
  const match: Condition = names.length === 1 ? { targetKeyword: names[0]! } : { any: names.map((n) => ({ targetKeyword: n })) };
  return negated ? { not: match } : match;
}
