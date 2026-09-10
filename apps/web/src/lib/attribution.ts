import { SOURCES, type SourceId } from "@grimstat/adapters";
import type { SourceRef } from "@grimstat/schema";

export interface AttributionLine {
  adapter: string;
  /** Registered source: attribution text from `SOURCES`; otherwise undefined and the adapter id is shown. */
  attribution: string | undefined;
  licence: string | undefined;
  /** Upstream refs seen for that adapter (git SHA, MFM version), deduplicated. */
  refs: string[];
  url: string | undefined;
}

function isSourceId(id: string): id is SourceId {
  return Object.prototype.hasOwnProperty.call(SOURCES, id);
}

/** Attribution lines for a snapshot's sources, one per adapter (a snapshot may list the same adapter twice). */
export function attributionFor(sources: readonly SourceRef[]): AttributionLine[] {
  const out: AttributionLine[] = [];
  for (const s of sources) {
    let line = out.find((l) => l.adapter === s.adapter);
    if (!line) {
      const def = isSourceId(s.adapter) ? SOURCES[s.adapter] : undefined;
      line = { adapter: s.adapter, attribution: def?.attribution, licence: def?.licence, refs: [], url: def ? undefined : s.url };
      out.push(line);
    }
    if (s.ref && !line.refs.includes(s.ref)) line.refs.push(s.ref);
    if (!line.url && s.url) line.url = s.url;
  }
  return out;
}

/** One-line credit for footers: "Powered by Wahapedia (…) · BSData/wh40k-11e-mfm — …". */
export function attributionSummary(sources: readonly SourceRef[]): string {
  return attributionFor(sources)
    .map((l) => l.attribution ?? l.adapter)
    .join(" · ");
}
