/**
 * Choosing a table.
 *
 * Fifty layouts do not fit in a drop-down, and the published ones are not browsed by name anyway:
 * a player knows the two Force Dispositions and wants the three cards for that pairing. So the
 * picker reads the pairing back out of a published layout's name — the converter writes
 * "Take and Hold vs Purge the Foe · 2", and a renamed one simply stops matching and stays in the
 * flat list — and filters on it, with a search box for everything else.
 */

import type { StoredLayout } from "./layoutStore";
import { isPublished } from "./layoutFetch";

export interface Pairing {
  readonly you: string;
  readonly opponent: string;
  readonly card: number;
}

const PAIRING = /^(?<you>.+?) vs (?<opponent>.+?) · (?<card>\d+)$/;

/** The two dispositions and the card number a published layout's name carries, if it still does. */
export function pairingOf(name: string): Pairing | undefined {
  const m = PAIRING.exec(name.trim());
  if (!m?.groups) return undefined;
  return { you: m.groups["you"]!, opponent: m.groups["opponent"]!, card: Number(m.groups["card"]) };
}

/** The deployment pattern a published layout's note names, if it does. */
export const deploymentOf = (note: string | undefined): string | undefined => /Deployment: ([^.]+)\./.exec(note ?? "")?.[1];

/** Every disposition the published layouts mention, in the order the cards list them. */
export function dispositionsIn(layouts: readonly StoredLayout[]): string[] {
  const seen: string[] = [];
  for (const l of layouts) {
    const p = pairingOf(l.layout.name);
    if (!p) continue;
    for (const d of [p.you, p.opponent]) if (!seen.includes(d)) seen.push(d);
  }
  return seen;
}

export interface PickFilter {
  readonly query: string;
  /** A disposition name, or "" for any. */
  readonly you: string;
  readonly opponent: string;
}

export type PickGroup = "shipped" | "published" | "mine";

export const groupOf = (l: StoredLayout): PickGroup => (l.builtIn ? "shipped" : isPublished(l.layout.id) ? "published" : "mine");

/**
 * The layouts a filter leaves, in their groups.
 *
 * The pairing filter applies to published cards only — the shipped and the user's own layouts have
 * no pairing to filter on and stay unless the search box rules them out. Search matches the name,
 * the pairing's dispositions and the deployment, case-insensitively, on every word typed.
 */
export function pickLayouts(layouts: readonly StoredLayout[], filter: PickFilter): Record<PickGroup, StoredLayout[]> {
  const words = filter.query.toLowerCase().split(/\s+/).filter(Boolean);
  const out: Record<PickGroup, StoredLayout[]> = { shipped: [], published: [], mine: [] };
  for (const l of layouts) {
    const group = groupOf(l);
    const pairing = pairingOf(l.layout.name);
    // With a disposition chosen, only published cards that name it belong; a renamed card is still
    // there for the search box.
    if (group === "published" && (filter.you || filter.opponent)) {
      if (!pairing) continue;
      if (filter.you && pairing.you !== filter.you) continue;
      if (filter.opponent && pairing.opponent !== filter.opponent) continue;
    }
    const hay = `${l.layout.name} ${deploymentOf(l.layout.note) ?? ""}`.toLowerCase();
    if (!words.every((w) => hay.includes(w))) continue;
    out[group].push(l);
  }
  out.published.sort((a, b) => a.layout.name.localeCompare(b.layout.name, undefined, { numeric: true }));
  return out;
}
