import type { EffectRecord, Side, Stage } from "@grimstat/schema";
import { type EvalContext, evaluateCondition } from "./conditions";
import type { Modifier } from "./modifiers";

/**
 * Turn effect records carried by a unit into modifiers for the current weapon resolution.
 * `side` is the role the carrying unit plays in this scenario; records with a different side are ignored.
 * Stage filtering is optional: the 40k plugin resolves everything in one pass and uses channels to route.
 */
export function collectModifiers(effects: EffectRecord[], side: Side, ctx: EvalContext, stage?: Stage): Modifier[] {
  const out: Modifier[] = [];
  for (const e of effects) {
    if ((e.when.side ?? "attacker") !== side) continue;
    if (stage && e.when.stage !== "any" && e.when.stage !== stage) continue;
    if (!evaluateCondition(e.if, ctx)) continue;
    out.push({ channel: e.target, op: e.op, value: e.value, source: e.source });
  }
  return out;
}
