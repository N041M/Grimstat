import { useCallback, useEffect, useMemo, useState } from "react";
import type { Scenario } from "@grimstat/schema";
import { db } from "../db";
import { useApp } from "../state/AppContext";
import { navigate } from "../router";
import { hasUnsavedEdits, newScenario } from "../lib/scenario";
import { newId, nowIso } from "../lib/ids";
import { permalinkUrl } from "../lib/permalink";
import { fmt, fmtRelative, pct } from "../lib/format";
import { filterScenarios, nextSort, sortScenarios, type ScenarioSortKey, type Sort } from "../lib/scenarioTable";
import { useScenarioMetrics } from "../hooks/useScenarioMetrics";
import { Empty, Icon, useConfirm } from "../components/ui";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable } from "../components/kit";
import { PageHeader, useContextNewAction } from "../components/shell";
import { t, type I18nKey } from "../i18n";

/** Scenario | Attacker | Defender | Avg damage | Kill chance | Dmg / 100 pts | Edited. */
const COLUMNS = "minmax(180px,2fr) minmax(150px,1.4fr) minmax(150px,1.4fr) 90px 90px 100px 110px";

/** Kill chance at or above this is drawn in the accent. */
const KILL_HIGHLIGHT = 0.5;

const HEADS: Array<{ key: ScenarioSortKey; label: I18nKey; title?: I18nKey; align: "start" | "end" }> = [
  { key: "name", label: "scenarios.col.name", align: "start" },
  { key: "attacker", label: "scenarios.col.attacker", align: "start" },
  { key: "defender", label: "scenarios.col.defender", align: "start" },
  { key: "dmg", label: "scenarios.col.dmg", title: "scenarios.col.dmg.title", align: "end" },
  { key: "kill", label: "scenarios.col.kill", title: "scenarios.col.kill.title", align: "end" },
  { key: "per100", label: "scenarios.col.per100", title: "scenarios.col.per100.title", align: "end" },
  { key: "edited", label: "scenarios.col.edited", align: "end" },
];

/** The glyph every table uses for a value that is not there yet. */
const DASH = "–";

export function ScenariosPage() {
  const { scenario, snapshot, activeSnapshotId, replaceScenario, notify, openPalette } = useApp();
  const { confirm, dialog } = useConfirm();
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

  // Replacing the scenario in the calculator drops whatever is there; ask when that would lose edits.
  const mayReplace = useCallback(async (): Promise<boolean> => {
    const stored = items?.find((s) => s.id === scenario.id);
    if (!hasUnsavedEdits(scenario, stored)) return true;
    return confirm({ title: t("scenario.discardTitle"), body: t("scenario.discardBody", { name: scenario.name }), confirmLabel: t("scenario.discard"), danger: true });
  }, [items, scenario, confirm]);

  const create = useCallback(async () => {
    if (!(await mayReplace())) return;
    await replaceScenario(newScenario());
    navigate("calculator");
  }, [mayReplace, replaceScenario]);

  // The context column's "+ New scenario" affordance starts a fresh scenario in the calculator.
  useContextNewAction("scenarios", () => void create());

  const load = async (s: Scenario) => {
    if (!(await mayReplace())) return;
    await replaceScenario(s, s.snapshotId);
    navigate("calculator");
  };

  const duplicate = async (s: Scenario) => {
    const now = nowIso();
    const copy: Scenario = { ...s, id: newId("sc"), name: t("scenario.copyName", { name: s.name }), createdAt: now, updatedAt: now, revision: 0 };
    await db.scenarios.put(copy);
    await refresh();
    notify(t("scenarios.duplicated", { name: s.name, copy: copy.name }), "success");
  };

  const remove = async (s: Scenario) => {
    if (!(await confirm({ title: t("scenario.confirmDelete", { name: s.name }), body: t("scenario.deleteBody"), confirmLabel: t("common.delete"), danger: true }))) return;
    await db.scenarios.delete(s.id);
    await refresh();
    notify(t("scenarios.deleted", { name: s.name }), "info", undefined, {
      label: t("common.undo"),
      run: () => {
        void db.scenarios
          .put(s)
          .then(refresh)
          .then(() => notify(t("scenarios.restored", { name: s.name }), "success"));
      },
    });
  };

  const share = async (s: Scenario) => {
    const url = permalinkUrl(s.snapshotId ? { scenario: s, snapshotId: s.snapshotId } : { scenario: s });
    setLink(url);
    await copyLink(url);
  };

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      notify(t("scenario.linkCopied"), "success");
    } catch {
      notify(t("scenario.linkCopyFailed"), "info");
    }
  };

  const subtitle = items === undefined ? t("scenarios.loading") : metrics.pending > 0 ? t("page.sub.scenariosSolving", { n: items.length, p: metrics.pending }) : t("page.sub.scenarios", { n: items.length });
  const highlight = pct(KILL_HIGHLIGHT, 0);

  return (
    <>
      {dialog}
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
            <button type="button" className="primary" onClick={() => void create()}>
              {t("scenarios.new")}
            </button>
          </>
        }
      />
      <div className="page-body flush">
        {link ? (
          <div className="calc-link inline">
            <input type="text" readOnly value={link} aria-label={t("scenario.permalink")} onFocus={(e) => e.currentTarget.select()} />
            <button type="button" onClick={() => void copyLink(link)}>
              {t("scenario.copy")}
            </button>
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
                    <span title={h.title ? t(h.title, { p: highlight }) : undefined}>{t(h.label)}</span>
                  </GridHeadCell>
                ))}
              </GridHead>
              {rows.map((s) => {
                const m = metrics.get(s);
                const err = metrics.error(s);
                // A solve that threw is marked, with the message in the title; a pending one shows the dash.
                const failed =
                  err === undefined ? null : (
                    <span className="scn-err" title={err ? t("scenarios.solveFailed", { msg: err }) : t("scenarios.solveNoResult")}>
                      <Icon name="warn" /> {t("scenarios.solveFailedShort")}
                    </span>
                  );
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
                      {failed ?? (m ? fmt(m.expectedDamage, 1) : DASH)}
                    </GridCell>
                    <GridCell align="end" mono tone={m && m.pKill >= KILL_HIGHLIGHT ? "accent" : undefined}>
                      {m ? pct(m.pKill, 0) : DASH}
                    </GridCell>
                    <GridCell align="end" mono>
                      {m?.per100 === undefined ? DASH : fmt(m.per100, 1)}
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
            {rows.length === 0 ? <p className="scn-none">{t("scenarios.noMatch", { q: query })}</p> : <p className="scn-legend">{t("scenarios.legend", { p: highlight })}</p>}
          </>
        )}
      </div>
    </>
  );
}
