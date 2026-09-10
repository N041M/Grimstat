import type { SnapshotData } from "@grimstat/schema";

/**
 * Drop factions that have no datasheets, and everything keyed to them (detachments, enhancements,
 * stratagems, price rules, wargear prices). Useful after a filtered import, where a points source
 * still contributes every faction while the structure source was limited to a few catalogues.
 */
export function pruneFactionsWithoutDatasheets(data: SnapshotData): { data: SnapshotData; removedFactions: string[] } {
  const used = new Set(data.datasheets.map((d) => d.factionId));
  const removed = data.factions.filter((f) => !used.has(f.id));
  if (!removed.length) return { data, removedFactions: [] };
  const gone = new Set(removed.map((f) => f.id));
  const detachments = data.detachments.filter((d) => !gone.has(d.factionId));
  const detIds = new Set(detachments.map((d) => d.id));
  const datasheetIds = new Set(data.datasheets.map((d) => d.id));
  return {
    data: {
      ...data,
      factions: data.factions.filter((f) => !gone.has(f.id)),
      detachments,
      enhancements: data.enhancements.filter((e) => detIds.has(e.detachmentId)),
      stratagems: data.stratagems.filter((s) => (!s.factionId || !gone.has(s.factionId)) && (!s.detachmentId || detIds.has(s.detachmentId))),
      priceRules: data.priceRules.filter((p) => datasheetIds.has(p.datasheetId)),
      wargearPrices: data.wargearPrices.filter((w) => datasheetIds.has(w.datasheetId)),
    },
    removedFactions: removed.map((f) => f.name),
  };
}
