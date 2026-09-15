/**
 * What a bare number beside a unit means.
 *
 * A list writes numbers without saying what they are. `10x Battle Sisters Squad 115` holds a model
 * count and a cost, `2 x 5 Flash Gitz` holds a number of units and a number of models, and
 * `Canis Rex 415` holds a cost and nothing else. Nothing in the shape of those lines tells them
 * apart, and the three formats disagree about the order.
 *
 * The snapshot tells them apart. `PriceTier` is a model count and a cost together, so each datasheet
 * carries the counts it can be fielded at and the costs it can come to, and a number that is one and
 * not the other is settled. What survives as more than one reading goes to the fit.
 */

import type { Snapshot } from "@grimstat/schema";
import type { Token } from "./tokens";
import { integerOf } from "./tokens";

export interface UnitSizes {
  /** Model counts the price table prices. */
  readonly models: readonly number[];
  /** Costs the price table names, every copy band included. */
  readonly points: readonly number[];
  /**
   * Every total this unit could be written down as.
   *
   * A list prints what a unit costs all in, so the number beside its name is its base cost plus any
   * paid wargear and any enhancement it carries. An overlay writes a Warden Captain at 95 because
   * the Ember Blade is 15, and reading only the bare 80 would find no cost on the card at all.
   */
  readonly attainable: readonly number[];
  /** The price table itself: what each model count costs, before wargear and enhancements. */
  readonly tiers: readonly { readonly models: number; readonly points: number }[];
  /** Fewest models the unit is fielded at, from its composition. */
  readonly min?: number;
  /** Most models the unit is fielded at. */
  readonly max?: number;
}

const SIZES = new WeakMap<Snapshot, Map<string, UnitSizes>>();

/**
 * The counts and costs one datasheet permits.
 *
 * The composition bounds are summed across its lines, because a unit written as "1 Sergeant and 4-9
 * Marines" is fielded at five to ten models and each line bounds only its own group.
 */
export function sizesOf(snapshot: Snapshot, datasheetId: string): UnitSizes {
  let cache = SIZES.get(snapshot);
  if (!cache) {
    cache = new Map();
    SIZES.set(snapshot, cache);
  }
  const hit = cache.get(datasheetId);
  if (hit) return hit;

  const models = new Set<number>();
  const points = new Set<number>();
  const tiers: { models: number; points: number }[] = [];
  for (const rule of snapshot.data.priceRules) {
    if (rule.datasheetId !== datasheetId) continue;
    for (const tier of rule.tiers) {
      models.add(tier.models);
      points.add(tier.points);
      tiers.push({ models: tier.models, points: tier.points });
    }
  }
  const ds = snapshot.data.datasheets.find((d) => d.id === datasheetId);
  if (ds?.fallbackPoints !== undefined) points.add(ds.fallbackPoints);

  let min: number | undefined;
  let max: number | undefined;
  for (const c of ds?.composition ?? []) {
    if (c.min !== undefined) min = (min ?? 0) + c.min;
    if (c.max !== undefined) max = (max ?? 0) + c.max;
  }

  /*
   * The extras that can be added to a base cost: this datasheet's own paid wargear, and every
   * enhancement in the snapshot. Two at once is as far as this goes, which covers a character with
   * a paid weapon and an enhancement. Every combination of every item would accept almost any
   * number as a cost, and then a count would start reading as one.
   */
  const extras = new Set<number>([0]);
  for (const w of snapshot.data.wargearPrices) if (w.datasheetId === datasheetId && w.points > 0) extras.add(w.points);
  const enhancements = new Set<number>([0]);
  // Only a character carries one. Allowing every enhancement's cost on every unit spreads the
  // attainable totals so wide that a model count starts to look like a cost, and telling those two
  // apart is the whole point of the table.
  if (ds?.isCharacter) for (const e of snapshot.data.enhancements) if (e.cost > 0) enhancements.add(e.cost);
  const attainable = new Set<number>();
  for (const base of points) for (const extra of extras) for (const enh of enhancements) attainable.add(base + extra + enh);

  const sizes: UnitSizes = {
    models: [...models].sort((a, b) => a - b),
    points: [...points].sort((a, b) => a - b),
    attainable: [...attainable].sort((a, b) => a - b),
    tiers,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
  };
  cache.set(datasheetId, sizes);
  return sizes;
}

/** Whether a number is a model count this unit can be fielded at. */
export function canBeCount(sizes: UnitSizes, value: number): boolean {
  if (value <= 0) return false;
  if (sizes.models.includes(value)) return true;
  return sizes.min !== undefined && sizes.max !== undefined && value >= sizes.min && value <= sizes.max;
}

/** Whether a number is a total this unit can be written down as, wargear and enhancement included. */
export function canBeCost(sizes: UnitSizes, value: number): boolean {
  return sizes.attainable.includes(value);
}

export type NumberRole = "count" | "cost" | "either" | "neither";

/** What one number beside this unit can be. */
export function roleOf(sizes: UnitSizes, value: number): NumberRole {
  const count = canBeCount(sizes, value);
  const cost = canBeCost(sizes, value);
  if (count && cost) return "either";
  if (count) return "count";
  if (cost) return "cost";
  return "neither";
}

/** One way of reading the numbers written in front of a unit's name. */
export interface Multiplier {
  /** How many of this unit the list holds. */
  readonly copies: number;
  /** How many models in each, when the numbers said. */
  readonly models?: number;
  /** Numbers this reading leaves unexplained. */
  readonly spare: readonly number[];
}

/** Tokens before `from` that are numbers or the multiplier's own `x`, nearest first. */
function leading(tokens: readonly Token[], from: number, floor: number): { values: number[]; sawX: boolean } {
  const values: number[] = [];
  let sawX = false;
  for (let at = from - 1; at >= floor && from - at <= 4; at--) {
    const token = tokens[at]!;
    if (token.line !== tokens[from]?.line) break;
    const n = integerOf(token);
    if (n !== undefined) {
      values.unshift(n);
      continue;
    }
    if (/^[x×]$/i.test(token.text)) {
      sawX = true;
      continue;
    }
    if (/^[-•◦▪·*\][(]+$/.test(token.text)) continue;
    break;
  }
  return { values, sawX };
}

/**
 * How the numbers in front of a name could be read, the readings the data permits first.
 *
 * `2 x 5 Warden Squad` is two units of five where the unit is fielded at five, and one unit of two
 * where it is fielded at two. Both are offered when both are legal, and the fit chooses using the
 * total. Where only one is legal there is nothing to choose.
 */
export function multipliersBefore(tokens: readonly Token[], from: number, sizes: UnitSizes, floor = 0): Multiplier[] {
  const { values, sawX } = leading(tokens, from, floor);
  const out: Multiplier[] = [];
  const push = (m: Multiplier) => {
    if (!out.some((o) => o.copies === m.copies && o.models === m.models)) out.push(m);
  };

  if (values.length >= 2) {
    const [a, b] = [values[values.length - 2]!, values[values.length - 1]!];
    // "2 x 5 Name": two units of five.
    if (canBeCount(sizes, b)) push({ copies: a, models: b, spare: values.slice(0, -2) });
    // "2x Name" with a five that belongs to something else.
    if (canBeCount(sizes, a)) push({ copies: 1, models: a, spare: [...values.slice(0, -2), b] });
  } else if (values.length === 1) {
    const a = values[0]!;
    if (canBeCount(sizes, a)) push({ copies: 1, models: a, spare: [] });
    // A number that is no legal size is a count of the units themselves, which is how a list writes
    // two of a one-model datasheet.
    if (!canBeCount(sizes, a) && !canBeCost(sizes, a) && sawX) push({ copies: a, spare: [] });
  }

  if (!out.length) push({ copies: 1, spare: values });
  return out;
}

/**
 * How many models a unit had, worked out from what it cost.
 *
 * A count is the first thing a picture loses: it sits at the start of a line where the bullet is,
 * and it is one or two characters long. The cost is four characters in the clear, and the price
 * table maps it straight back. A table that read "Ox Warden Squad 180" has lost the count and kept
 * the cost, and 180 is what ten of them cost.
 *
 * Extras are allowed for the same way `attainable` allows for them, so a character at 95 with a
 * 15-point enhancement still resolves to its one model.
 */
export function modelsForCost(sizes: UnitSizes, cost: number, extras: readonly number[] = [0]): number[] {
  const out = new Set<number>();
  for (const tier of sizes.tiers) for (const extra of extras) if (tier.points + extra === cost) out.add(tier.models);
  return [...out].sort((a, b) => a - b);
}

/**
 * The cost printed after a unit's name, when one was.
 *
 * A cost is set apart from the name on the line rather than following it as a word, so any number on
 * the line after the name that the datasheet could come to is taken. A list with no costs on it
 * yields nothing here and is costed from the snapshot instead.
 */
export function costAfter(tokens: readonly Token[], to: number, sizes: UnitSizes): number | undefined {
  const at = costIndexAfter(tokens, to, sizes);
  return at === undefined ? undefined : integerOf(tokens[at]!);
}

/**
 * Where that cost sits in the stream.
 *
 * The unit after it needs to know. A broadcast overlay draws an army in columns, and a picture read
 * as one block puts a unit from each of them on one line: the cost of the card on the left then sits
 * just in front of the next card's name, where it reads as that unit's count. One list came back
 * holding a hundred and eighty of a unit it had one of, and another as eleven copies of a unit that
 * was in it twice. A number that has already been read as somebody's cost counts nothing.
 */
export function costIndexAfter(tokens: readonly Token[], to: number, sizes: UnitSizes): number | undefined {
  const line = tokens[to - 1]?.line;
  for (let at = to; at < tokens.length && at - to <= 3; at++) {
    const token = tokens[at]!;
    if (token.line !== line) break;
    const n = integerOf(token);
    if (n === undefined) continue;
    if (canBeCost(sizes, n)) return at;
  }
  return undefined;
}
