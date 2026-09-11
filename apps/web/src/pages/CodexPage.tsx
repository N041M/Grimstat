import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Datasheet } from "@grimstat/schema";
import { useApp } from "../state/AppContext";
import { gameApi } from "../plugin";
import { hrefFor, navigate } from "../router";
import { usePersistedSetting } from "../hooks/usePersistedSetting";
import { ALL_FACTIONS, CODEX_COMPARE_KEY, CODEX_DIFF_KEY, CODEX_FACTION_KEY, codexFactions, codexGroups, COMPARE_CAP, effectiveFaction, parseCompareSet, parseFaction, parseFlag, sheetsById, sizeBounds, toggleCompare, type CodexView } from "../lib/codex";
import { ContextSlot, PageHeader } from "../components/shell";
import { Empty, Icon, Popover } from "../components/ui";
import { CodexBrowser } from "../components/codex/CodexBrowser";
import { CodexLanding } from "../components/codex/CodexLanding";
import { DatasheetCard } from "../components/codex/DatasheetCard";
import { CompareGrid } from "../components/codex/CompareGrid";
import { factionName, sizeText } from "../components/codex/shared";
import { t } from "../i18n";

const NONE: Datasheet[] = [];

/**
 * The Codex: every datasheet of the active snapshot, one laid out as a codex page, several laid
 * side by side. The column browses, the header acts, the body reads.
 *
 * The open sheet is the route param (`#/codex/<datasheetId>`), so it can be linked to; the compare
 * set, the faction filter and the differences switch are remembered in settings; the tab is not.
 */
export function CodexPage({ id }: { id: string | undefined }) {
  const { snapshot, updateScenario, notify } = useApp();
  const [storedFaction, setStoredFaction, factionLoaded] = usePersistedSetting<string>(CODEX_FACTION_KEY, "", parseFaction);
  const [compare, setCompare] = usePersistedSetting<string[]>(CODEX_COMPARE_KEY, [], parseCompareSet);
  const [diffOnly, setDiffOnly] = usePersistedSetting<boolean>(CODEX_DIFF_KEY, false, parseFlag);
  const [view, setView] = useState<CodexView>("sheets");
  const [query, setQuery] = useState("");
  const [calcMenu, setCalcMenu] = useState(false);

  const datasheets = snapshot?.data.datasheets ?? NONE;
  const factions = useMemo(() => (snapshot ? codexFactions(snapshot) : []), [snapshot]);
  const selected = useMemo(() => (id ? datasheets.find((d) => d.id === id) : undefined), [datasheets, id]);
  const factionId = effectiveFaction(storedFaction, factions, selected);
  const groups = useMemo(() => codexGroups(datasheets, factionId, query), [datasheets, factionId, query]);
  const compared = useMemo(() => (snapshot ? sheetsById(snapshot, compare) : []), [snapshot, compare]);

  // A sheet opened from elsewhere (a link, the compare grid) pulls the column onto its faction —
  // once per sheet, so changing the filter while reading it is left alone.
  const followed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!factionLoaded || !selected || followed.current === selected.id) return;
    followed.current = selected.id;
    if (storedFaction !== ALL_FACTIONS && storedFaction !== selected.factionId) setStoredFaction(selected.factionId);
  }, [factionLoaded, selected, storedFaction, setStoredFaction]);

  // A link to a sheet lands on the sheet, whichever tab was open; and a newly opened sheet or a
  // change of view starts at the top of the region — it keeps its scroll position across hash
  // navigation otherwise, and a sheet is read from its name down.
  useEffect(() => {
    if (id) setView("sheets");
  }, [id]);
  useEffect(() => {
    document.querySelector(".main-region")?.scrollTo({ top: 0 });
  }, [id, view]);

  const showSheets = useCallback(() => setView("sheets"), []);
  const showCompare = useCallback(() => setView("compare"), []);
  const toggle = useCallback((dsId: string) => setCompare((set) => toggleCompare(set, dsId)), [setCompare]);
  const remove = useCallback((dsId: string) => setCompare((set) => set.filter((x) => x !== dsId)), [setCompare]);
  const closeCalc = useCallback(() => setCalcMenu(false), []);

  const openInCalculator = (side: "attacker" | "defender") => {
    setCalcMenu(false);
    if (!snapshot || !selected) return;
    try {
      const unit = gameApi().unitFromDatasheet(selected, snapshot);
      updateScenario((s) => ({ ...s, [side]: unit, snapshotId: snapshot.id }));
      navigate("calculator");
      notify(t(side === "attacker" ? "palette.unitAsAttacker" : "palette.unitAsDefender", { name: unit.name }), "success");
    } catch (err) {
      notify(t("palette.unitFailed", { name: selected.name }), "error", [err instanceof Error ? err.message : String(err)]);
    }
  };

  const inCompare = selected ? compare.includes(selected.id) : false;
  const full = compare.length >= COMPARE_CAP;
  const missing = Boolean(id && snapshot && !selected);

  // header: what it is titled, what it says beneath, what it can do — by view
  let title = t("codex.title");
  let subtitle = t("page.sub.codex", { n: datasheets.length });
  let actions: React.ReactNode = null;
  if (view === "compare") {
    title = t("codex.tab.compare");
    subtitle = compared.length ? t("page.sub.codexCompare", { n: compared.length }) : t("page.sub.codexCompareEmpty");
    actions = (
      <>
        <button type="button" className={diffOnly ? "primary" : ""} aria-pressed={diffOnly} onClick={() => setDiffOnly((v) => !v)}>
          {t("codex.cmp.diffOnly")}
        </button>
        <button type="button" className="ghost" disabled={!compare.length} onClick={() => setCompare([])}>
          {t("codex.cmp.clear")}
        </button>
      </>
    );
  } else if (selected && snapshot) {
    title = selected.name;
    subtitle = t("page.sub.codexSheet", { faction: factionName(snapshot, selected.factionId), role: selected.role ?? "—", size: sizeText(sizeBounds(selected)) });
    actions = (
      <>
        <button type="button" className={inCompare ? "primary" : ""} aria-pressed={inCompare} disabled={!inCompare && full} title={!inCompare && full ? t("codex.compareFull", { n: COMPARE_CAP }) : undefined} onClick={() => toggle(selected.id)}>
          {t(inCompare ? "codex.removeCompare" : "codex.addCompare")}
        </button>
        <Popover
          open={calcMenu}
          onClose={closeCalc}
          align="end"
          label={t("codex.openCalc")}
          trigger={
            <button type="button" aria-haspopup="menu" aria-expanded={calcMenu} onClick={() => setCalcMenu((v) => !v)}>
              <Icon name="calc" />
              {t("codex.openCalc")}
            </button>
          }
        >
          <div className="menu" role="menu">
            <button type="button" role="menuitem" onClick={() => openInCalculator("attacker")}>
              {t("codex.asAttacker")}
            </button>
            <button type="button" role="menuitem" onClick={() => openInCalculator("defender")}>
              {t("codex.asDefender")}
            </button>
          </div>
        </Popover>
      </>
    );
  }

  let body: React.ReactNode;
  if (!snapshot) {
    body = (
      <Empty>
        {t("codex.noSnapshot")} <a href={hrefFor("data")}>{t("nav.data")}</a>
      </Empty>
    );
  } else if (view === "compare") {
    body = <CompareGrid sheets={compared} snapshot={snapshot} diffOnly={diffOnly} onRemove={remove} onAdd={toggle} onOpen={showSheets} />;
  } else if (missing) {
    body = (
      <Empty>
        {t("codex.missing")} <a href={hrefFor("codex")}>{t("codex.backToList")}</a>
      </Empty>
    );
  } else if (selected) {
    body = <DatasheetCard ds={selected} snapshot={snapshot} />;
  } else {
    body = <CodexLanding snapshot={snapshot} factions={factions} factionId={factionId} onFaction={setStoredFaction} query={query} onQuery={setQuery} groups={groups} compare={compare} onToggleCompare={toggle} onPick={showSheets} />;
  }

  return (
    <>
      {snapshot ? (
        <ContextSlot>
          <CodexBrowser snapshot={snapshot} factions={factions} factionId={factionId} onFaction={setStoredFaction} query={query} onQuery={setQuery} groups={groups} selectedId={selected?.id} compare={compare} onOpenCompare={showCompare} onPick={showSheets} />
        </ContextSlot>
      ) : null}
      <PageHeader className="tabbed" title={title} subtitle={subtitle} actions={actions}>
        <div className="tabbar" role="tablist" aria-label={t("codex.tabs")}>
          <button type="button" role="tab" id="codex-tab-sheets" aria-selected={view === "sheets"} aria-controls="codex-panel" className={`tabbar-tab ${view === "sheets" ? "on" : ""}`.trim()} onClick={showSheets}>
            {t("codex.tab.sheets")}
          </button>
          <button type="button" role="tab" id="codex-tab-compare" aria-selected={view === "compare"} aria-controls="codex-panel" className={`tabbar-tab ${view === "compare" ? "on" : ""}`.trim()} onClick={showCompare}>
            {compared.length ? t("codex.tab.compareN", { n: compared.length }) : t("codex.tab.compare")}
          </button>
        </div>
      </PageHeader>
      <div className="page-body codex-body" role="tabpanel" id="codex-panel" aria-labelledby={`codex-tab-${view}`}>
        {body}
      </div>
    </>
  );
}
