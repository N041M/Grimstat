/**
 * Pure filtering / grouping for the command palette. Kept free of React and i18n so the
 * behaviour (substring match, group order, caps, keyboard wrap-around) is unit-testable.
 */

export type PaletteGroupId = "goto" | "scenarios" | "units" | "actions";

/** Fixed order the groups appear in; groups with no surviving item are dropped. */
export const PALETTE_GROUP_ORDER: readonly PaletteGroupId[] = ["goto", "scenarios", "units", "actions"];

export interface PaletteItem {
  /** Unique across every group (used as the React key and for arrow-key selection). */
  id: string;
  group: PaletteGroupId;
  /** Single mono character shown on the left (`C`, `›`, `+`, `↻`, …). */
  glyph: string;
  /** The only text the filter looks at. */
  label: string;
  /** Right-aligned mono hint (`⌘C`, `14.7 dmg`, …). */
  hint?: string;
}

export interface PaletteGroup<T extends PaletteItem = PaletteItem> {
  id: PaletteGroupId;
  label: string;
  items: T[];
}

/** Case-insensitive substring match on the label; a blank query matches everything. */
export function matchesQuery(label: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q.length === 0 || label.toLowerCase().includes(q);
}

export function filterItems<T extends PaletteItem>(items: readonly T[], query: string): T[] {
  return items.filter((i) => matchesQuery(i.label, query));
}

/**
 * Filter `items` by `query`, then bucket them into the fixed group order.
 * `caps` limits how many survivors a group may show (the Units group is capped).
 */
export function buildGroups<T extends PaletteItem>(items: readonly T[], query: string, labels: Record<PaletteGroupId, string>, caps: Partial<Record<PaletteGroupId, number>> = {}): PaletteGroup<T>[] {
  const out: PaletteGroup<T>[] = [];
  for (const id of PALETTE_GROUP_ORDER) {
    const cap = caps[id];
    let list = filterItems(
      items.filter((i) => i.group === id),
      query,
    );
    if (cap !== undefined) list = list.slice(0, Math.max(0, cap));
    if (list.length) out.push({ id, label: labels[id], items: list });
  }
  return out;
}

/** Every visible item in render order — the list arrow keys walk. */
export function flattenGroups<T extends PaletteItem>(groups: readonly PaletteGroup<T>[]): T[] {
  return groups.flatMap((g) => g.items);
}

/** Arrow-key movement with wrap-around; returns -1 when there is nothing to select. */
export function stepIndex(count: number, current: number, delta: number): number {
  if (count <= 0) return -1;
  const next = current + delta;
  if (next < 0) return count - 1;
  if (next >= count) return 0;
  return next;
}
