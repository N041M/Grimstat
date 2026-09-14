import { Fragment, useMemo } from "react";
import type { Snapshot } from "@grimstat/schema";
import { UnitArt } from "../UnitArt";
import { ContextEmpty, ContextList, ContextRow } from "../shell";
import { CODEX_PAGE, minPoints, shownGroups, sizeBounds, type CodexFaction, type CodexFilters, type CodexGroup, type CodexKeyword } from "../../lib/codex";
import { fmtInt } from "../../lib/format";
import { hrefFor } from "../../router";
import { CodexTools, ColumnAction, GROUP_KEY, NoMatch, sizeText } from "./shared";
import { useGrowingList } from "../../hooks/useGrowingList";
import { t } from "../../i18n";

interface Props {
  snapshot: Snapshot;
  factions: CodexFaction[];
  factionId: string;
  onFaction: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  filters: CodexFilters;
  onFilters: (f: CodexFilters) => void;
  /** Every keyword the faction filter admits, for the keyword picker. */
  keywords: CodexKeyword[];
  groups: CodexGroup[];
  selectedId: string | undefined;
  compare: string[];
  onOpenCompare: () => void;
  /** A row was chosen — the page returns to the sheet view. */
  onPick: () => void;
}

/**
 * The context column's body on the Codex screen: the faction filter and search above the
 * faction's datasheets grouped as the army builder groups them, each row the sheet's name, its
 * points at the smallest size and its role and size beneath. A diamond marks a sheet in compare.
 */
export function CodexBrowser({ snapshot, factions, factionId, onFaction, query, onQuery, filters, onFilters, keywords, groups, selectedId, compare, onOpenCompare, onPick }: Props) {
  const total = groups.reduce((n, g) => n + g.sheets.length, 0);
  const { limit, moreRef } = useGrowingList(CODEX_PAGE, groups, total);
  const shown = useMemo(() => shownGroups(groups, limit), [groups, limit]);
  return (
    <div className="codex-ctx">
      <CodexTools factions={factions} factionId={factionId} onFaction={onFaction} query={query} onQuery={onQuery} filters={filters} onFilters={onFilters} keywords={keywords} className="codex-ctx-tools" />
      {groups.length === 0 ? (
        <ContextEmpty>
          <NoMatch query={query} factions={factions} factionId={factionId} onFaction={onFaction} filters={filters} onFilters={onFilters} />
        </ContextEmpty>
      ) : null}
      {shown.map((g) => (
        <Fragment key={g.group}>
          <div className="codex-group-label">{t(GROUP_KEY[g.group])}</div>
          <ContextList>
            {g.sheets.map((d) => {
              const pts = minPoints(d, snapshot);
              return (
                <ContextRow
                  key={d.id}
                  name={
                    <>
                      {compare.includes(d.id) ? (
                        <span className="codex-mark" aria-hidden="true">
                          ◆
                        </span>
                      ) : null}
                      <UnitArt of={d} className="codex-row-art" />
                      {d.name}
                    </>
                  }
                  value={pts === undefined ? undefined : t("codex.pts", { n: fmtInt(pts) })}
                  meta={[d.role, sizeText(sizeBounds(d))].filter(Boolean).join(" · ")}
                  selected={d.id === selectedId}
                  href={hrefFor("codex", d.id)}
                  onClick={onPick}
                />
              );
            })}
          </ContextList>
        </Fragment>
      ))}
      <div className="codex-more" ref={moreRef} aria-hidden="true" />
      <ColumnAction label={t("ctxcol.openCompare", { n: compare.length })} onClick={onOpenCompare} />
    </div>
  );
}
