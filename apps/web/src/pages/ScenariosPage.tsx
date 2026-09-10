import { useCallback, useEffect, useMemo, useState } from "react";
import type { Scenario } from "@grimstat/schema";
import { db } from "../db";
import { useApp } from "../state/AppContext";
import { navigate } from "../router";
import { newScenario } from "../lib/scenario";
import { newId, nowIso } from "../lib/ids";
import { permalinkUrl } from "../lib/permalink";
import { fmt, fmtRelative, pct } from "../lib/format";
import { filterScenarios, nextSort, sortScenarios, type ScenarioSortKey, type Sort } from "../lib/scenarioTable";
import { useScenarioMetrics } from "../hooks/useScenarioMetrics";
import { Empty } from "../components/ui";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable } from "../components/kit";
import { PageHeader, useContextNewAction } from "../components/shell";
import { t, type I18nKey } from "../i18n";

/** Scenario | Attacker | Defender | E[dmg] | P(kill) | /100pts | Edited. */
const COLUMNS = "minmax(180px,2fr) minmax(150px,1.4fr) minmax(150px,1.4fr) 90px 80px 80px 110px";

const HEADS: Array<{ key: ScenarioSortKey; label: I18nKey; align: "start" | "end" }> = [
  { key: "name", label: "scenarios.col.name", align: "start" },
  { key: "attacker", label: "scenarios.col.attacker", align: "start" },
  { key: "defender", label: "scenarios.col.defender", align: "start" },
  { key: "dmg", label: "scenarios.col.dmg", align: "end" },
  { key: "kill", label: "scenarios.col.kill", align: "end" },
  { key: "per100", label: "scenarios.col.per100", align: "end" },
  { key: "edited", label: "scenarios.col.edited", align: "end" },
];

/** P(kill) at or above this is drawn in the accent. */
const KILL_HIGHLIGHT = 0.5;

export function ScenariosPage() {
  const { scenario, snapshot, activeSnapshotId, replaceScenario, notify, openPalette } = useApp();
  const [items, setItems] = useState<Scenario[] | undefined>(undefined);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "edited", dir: "desc" });
  const [link, setLink] = useState<string | undefined>(undefined);

  const refresh = useCallback(async () => {
    const all = await db.scenarios.toArray();
    setItems(all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const metrics = useScenarioMetrics(items, snapshot, activeSnapshotId);
  const rows = useMemo(() => sortScenarios(filterScenarios(items ?? [], query), sort, (s) => metrics.get(s)), [items, query, sort, metrics]);

  const create = useCallback(() => {
    void replaceScenario(newScenario()).then(() => navigate("calculator"));
  }, [replaceScenario]);

  // The context column's "+ New scenario" affordance starts a fresh scenario in the calculator.
  useContextNewAction("scenarios", create);

  const load = async (s: Scenario) => {
    await replaceScenario(s, s.snapshotId);
    navigate("calculator");
  };

  const duplicate = async (s: Scenario) => {
    const now = nowIso();
    const copy: Scenario = { ...s, id: newId("sc"), name: t("scenario.copyName", { name: s.name }), createdAt: now, updatedAt: now, revision: 0 };
    await db.scenarios.put(copy);
    await refresh();
  };

  const remove = async (s: Scenario) => {
    if (!window.confirm(t("scenario.confirmDelete", { name: s.name }))) return;
    await db.scenarios.delete(s.id);
    await refresh();
  };

  const share = async (s: Scenario) => {
    const url = permalinkUrl(s.snapshotId ? { scenario: s, snapshotId: s.snapshotId } : { scenario: s });
    setLink(url);
    try {
      await navigator.clipboard.writeText(url);
      notify(t("scenario.linkCopied"), "success");
    } catch {
      /* clipboard unavailable: the link strip below the header is selectable */
    }
  };

  const subtitle = items === undefined ? t("scenarios.loading") : metrics.pending > 0 ? t("page.sub.scenariosSolving", { n: items.length, p: metrics.pending }) : t("page.sub.scenarios", { n: items.length });

  return (
    <>
      <PageHeader
        title={t("nav.scenarios")}
        subtitle={subtitle}
        actions={
          <>
            <span className="filter-field">
              <input type="search" className="filter-input" value={query} placeholder={t("scenarios.filter")} aria-label={t("scenarios.filter")} onChange={(e) => setQuery(e.target.value)} />
              <button type="button" className="filter-kbd" onClick={openPalette} title={t("scenarios.paletteHint")} aria-label={t("scenarios.paletteHint")}>
                ⌘K
              </button>
            </span>
            <button type="button" className="primary" onClick={create}>
              {t("scenarios.new")}
            </button>
          </>
        }
      />
      <div className="page-body flush">
        {link ? (
          <div className="calc-link inline">
            <input type="text" readOnly value={link} aria-label={t("scenario.permalink")} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" className="ghost" onClick={() => setLink(undefined)} aria-label={t("common.close")}>
              ×
            </button>
          </div>
        ) : null}

        {items !== undefined && items.length === 0 ? (
          <div className="scn-empty">
            <Empty>{t("scenarios.empty")}</Empty>
          </div>
        ) : (
          <>
          <GridTable columns={COLUMNS} label={t("nav.scenarios")} className="scn-table">
            <GridHead>
              {HEADS.map((h) => (
                <GridHeadCell key={h.key} align={h.align} sort={sort.key === h.key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} onSort={() => setSort((s) => nextSort(s, h.key))}>
                  {t(h.label)}
                </GridHeadCell>
              ))}
            </GridHead>
            {rows.map((s) => {
              const m = metrics.get(s);
              const dash = "—";
              return (
                <GridRow key={s.id} className={s.id === scenario.id ? "current" : ""} onClick={() => void load(s)} title={t("scenarios.rowTitle", { name: s.name })}>
                  <GridCell>
                    <button
                      type="button"
                      className="scn-name"
                      onClick={(e) => {
                        e.stopPropagation();
                        void load(s);
                      }}
                    >
                      {s.name}
                    </button>
                  </GridCell>
                  <GridCell tone="muted">{s.attacker.name}</GridCell>
                  <GridCell tone="muted">{s.defender.name}</GridCell>
                  <GridCell align="end" mono>
                    {m ? fmt(m.expectedDamage, 1) : dash}
                  </GridCell>
                  <GridCell align="end" mono tone={m && m.pKill >= KILL_HIGHLIGHT ? "accent" : undefined}>
                    {m ? pct(m.pKill, 0) : dash}
                  </GridCell>
                  <GridCell align="end" mono>
                    {m?.per100 === undefined ? dash : fmt(m.per100, 1)}
                  </GridCell>
                  <GridCell align="end" mono tone="faint">
                    {fmtRelative(s.updatedAt)}
                  </GridCell>
                  <span className="scn-actions">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void share(s);
                      }}
                    >
                      {t("scenarios.link")}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void duplicate(s);
                      }}
                    >
                      {t("scenarios.duplicate")}
                    </button>
                    <button
                      type="button"
                      className="danger"
                      onClick={(e) => {
                        e.stopPropagation();
                        void remove(s);
                      }}
                    >
                      {t("scenarios.delete")}
                    </button>
                  </span>
                </GridRow>
              );
            })}
          </GridTable>
          {rows.length === 0 ? <p className="scn-none">{t("scenarios.noMatch", { q: query })}</p> : null}
          </>
        )}
      </div>
    </>
  );
}
