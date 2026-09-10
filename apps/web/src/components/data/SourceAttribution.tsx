import type { SourceRef } from "@grimstat/schema";
import { attributionFor } from "../../lib/attribution";
import { t } from "../../i18n";

/** Credits for a snapshot's sources (e.g. "Powered by Wahapedia"), one line per adapter. */
export function SourceAttribution({ sources }: { sources: readonly SourceRef[] | undefined }) {
  const lines = sources ? attributionFor(sources) : [];
  if (!sources) return <p className="small muted">{t("data.attribution.none")}</p>;
  if (!lines.length) return <p className="small muted">–</p>;
  return (
    <ul className="attribution-list">
      {lines.map((l) => (
        <li key={l.adapter}>
          <div>
            {l.attribution ?? t("data.attribution.unknown", { adapter: l.adapter })}
            {l.url && !l.attribution ? (
              <>
                {" "}
                <span className="mono small muted">{l.url}</span>
              </>
            ) : null}
          </div>
          <div className="small muted">
            {l.licence ? t("data.fetch.licence", { licence: l.licence }) : null}
            {l.refs.length ? (
              <>
                {l.licence ? " · " : ""}
                <span className="mono">{t("data.attribution.refs", { refs: l.refs.join(", ") })}</span>
              </>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
