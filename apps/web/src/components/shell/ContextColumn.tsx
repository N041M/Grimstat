import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Roster, Scenario, Snapshot } from "@grimstat/schema";
import { rosterSummary } from "@grimstat/resolver";
import { useStoreVersion } from "../../hooks/useStoreVersion";
import { db } from "../../db";
import { useApp } from "../../state/AppContext";
import { useUnitSet } from "../../hooks/useUnitSet";
import { hrefFor, navigate, type Route } from "../../router";
import { fmtInt, fmtRelative } from "../../lib/format";
import { totalPoints } from "../../lib/unitSet";
import { useContextHostRef, useContextSlotFilled } from "./ContextSlot";
import { t, type I18nKey, tn } from "../../i18n";

/** Repository + documentation links shown in the About column. */
export const REPO_URL = "https://github.com/N041M/Grimstat";
const DOC_URL = `${REPO_URL}/blob/main/docs`;

// ---------- the generic list-row pattern (README §2) ----------

/**
 * One context-column row: 13px name + 11px mono value on the baseline, 10px mono meta beneath,
 * `11px 16px` padding. `selected` paints `--hover` with a 2px accent left border.
 *
 * Renders as an `<a>` when given `href`, otherwise a `<button>`; either way one row, one action.
 */
export function ContextRow({ name, value, meta, selected, href, onClick, title }: { name: ReactNode; value?: ReactNode; meta?: ReactNode; selected?: boolean; href?: string; onClick?: () => void; title?: string }) {
  const inner = (
    <>
      <span className="ctx-row-top">
        <span className="ctx-row-name">{name}</span>
        {value !== undefined && value !== null ? <span className="ctx-row-value">{value}</span> : null}
      </span>
      {meta ? <span className="ctx-row-meta">{meta}</span> : null}
    </>
  );
  const cls = `ctx-row ${selected ? "selected" : ""}`.trim();
  if (href) {
    return (
      <a className={cls} href={href} title={title} aria-current={selected ? "true" : undefined} onClick={onClick} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
        {inner}
      </a>
    );
  }
  return (
    <button type="button" className={cls} title={title} aria-current={selected ? "true" : undefined} onClick={onClick}>
      {inner}
    </button>
  );
}

export function ContextList({ children }: { children: ReactNode }) {
  return <div className="ctx-list">{children}</div>;
}

/** The dashed "+ New …" affordance that closes every context list. */
export function ContextNewRow({ label, onClick, href }: { label: string; onClick?: () => void; href?: string }) {
  return (
    <div className="ctx-new-wrap">
      {href ? (
        <a className="ctx-new" href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>
          {label}
        </a>
      ) : (
        <button type="button" className="ctx-new" onClick={onClick}>
          {label}
        </button>
      )}
    </div>
  );
}

export function ContextEmpty({ children }: { children: ReactNode }) {
  return <p className="ctx-empty">{children}</p>;
}

/**
 * Pages own their "new" dialogs, so the column asks for one by event instead of importing it:
 * the affordance navigates to the route and dispatches `CONTEXT_NEW_EVENT`; the page listens
 * with `useContextNewAction`. Routes with no listener simply land on their index page.
 */
export const CONTEXT_NEW_EVENT = "grimstat:context-new";

function requestNew(route: Route): void {
  navigate(route);
  // Let the route mount before it is asked to open its dialog.
  window.setTimeout(() => window.dispatchEvent(new CustomEvent(CONTEXT_NEW_EVENT, { detail: { route } })), 0);
}

/** Subscribe a page to the context column's "+ New …" affordance. */
export function useContextNewAction(route: Route, run: () => void): void {
  const latest = useRef(run);
  latest.current = run;
  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<{ route: Route }>).detail?.route === route) latest.current();
    };
    window.addEventListener(CONTEXT_NEW_EVENT, on);
    return () => window.removeEventListener(CONTEXT_NEW_EVENT, on);
  }, [route]);
}

// ---------- column frame ----------

/**
 * Header row (eyebrow + count/status), the body — which any page may take over through
 * `<ContextSlot>` — and the always-present Snapshot footer.
 */
function ContextFrame({ eyebrow, meta, inSheet, children }: { eyebrow: string; meta?: string; inSheet?: boolean; children: ReactNode }) {
  const { snapshot, activeSnapshotId } = useApp();
  const hostRef = useContextHostRef();
  const filled = useContextSlotFilled();
  return (
    <aside className={`ctx-col ${inSheet ? "in-sheet" : ""}`.trim()} aria-label={eyebrow}>
      <div className="ctx-head">
        <span className="ctx-head-eyebrow">{eyebrow}</span>
        <span className="ctx-head-meta">{meta}</span>
      </div>
      <div className="ctx-body">
        {/* Pages portal into this node. Exactly one copy of the column is ever mounted — the
            column on desktop, the sheet's copy on phones — so both may claim the host. */}
        <div ref={hostRef} />
        {filled ? null : children}
      </div>
      <div className="ctx-spacer" />
      <div className="ctx-foot">
        <div className="ctx-foot-eyebrow">{t("ctxcol.snapshot")}</div>
        <div className="ctx-foot-value" title={activeSnapshotId ?? t("shell.noSnapshot")}>
          {snapshot ? (snapshot.label ?? snapshot.id) : t("ctxcol.noSnapshot")}
        </div>
      </div>
    </aside>
  );
}

// ---------- per-route bodies ----------

type BodyProps = { param: string | undefined; inSheet?: boolean };

/** Placeholder until the Calculator screen fills the slot with its unit cards + Save/Share pair. */
function CalculatorBody({ inSheet }: BodyProps) {
  const { scenario } = useApp();
  const sides: Array<{ key: I18nKey; unit: Scenario["attacker"] }> = [
    { key: "side.attacker", unit: scenario.attacker },
    { key: "side.defender", unit: scenario.defender },
  ];
  return (
    <ContextFrame eyebrow={t("ctxcol.scenario")} meta={fmtRelative(scenario.updatedAt)} inSheet={inSheet}>
      <div className="ctx-lede">
        <div className="ctx-lede-name">{scenario.name}</div>
        <div className="ctx-lede-meta">{t("ctxcol.editedRel", { rel: fmtRelative(scenario.updatedAt) })}</div>
      </div>
      <ContextList>
        {sides.map((s) => (
          <ContextRow key={s.key} name={s.unit.name} value={s.unit.points === undefined ? undefined : t("ctxcol.pts", { n: fmtInt(s.unit.points) })} meta={t(s.key)} href={hrefFor("calculator")} />
        ))}
      </ContextList>
    </ContextFrame>
  );
}

/** Placeholder until the Scenarios screen fills the slot with its own filtered list. */
function ScenariosBody({ inSheet }: BodyProps) {
  const { scenario, replaceScenario } = useApp();
  const [items, setItems] = useState<Scenario[]>([]);
  useEffect(() => {
    let alive = true;
    void db.scenarios
      .toArray()
      .then((all) => {
        if (alive) setItems(all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  return (
    <ContextFrame eyebrow={t("ctxcol.scenarios")} meta={String(items.length)} inSheet={inSheet}>
      <ContextList>
        {items.length === 0 ? <ContextEmpty>{t("ctxcol.noScenarios")}</ContextEmpty> : null}
        {items.map((s) => (
          <ContextRow
            key={s.id}
            name={s.name}
            meta={fmtRelative(s.updatedAt)}
            selected={s.id === scenario.id}
            onClick={() => {
              void replaceScenario(s, s.snapshotId).then(() => navigate("calculator"));
            }}
          />
        ))}
      </ContextList>
      <ContextNewRow label={t("ctxcol.newScenario")} onClick={() => requestNew("scenarios")} />
    </ContextFrame>
  );
}

function ArmiesBody({ param, inSheet }: BodyProps) {
  const { snapshot, activeSnapshotId } = useApp();
  const [items, setItems] = useState<Roster[]>([]);
  // `param` changes when an army is opened or created; the version bumps on every save from the
  // editor, so points and unit counts here follow the roster the user is editing.
  const version = useStoreVersion("rosters");
  useEffect(() => {
    let alive = true;
    void db.rosters
      .toArray()
      .then((all) => {
        if (alive) setItems(all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [param, version]);
  const rows = useMemo(
    () =>
      items.map((r) => {
        // Points are only cheap for rosters built against the active snapshot; others show the limit alone.
        let points: number | undefined;
        if (snapshot && r.snapshotId === activeSnapshotId) {
          try {
            points = rosterSummary(r, snapshot).points;
          } catch {
            points = undefined;
          }
        }
        return { r, value: points === undefined ? t("ctxcol.pointsLimit", { limit: fmtInt(r.pointsLimit) }) : t("ctxcol.pointsOf", { points: fmtInt(points), limit: fmtInt(r.pointsLimit) }) };
      }),
    [items, snapshot, activeSnapshotId],
  );
  return (
    <ContextFrame eyebrow={t("ctxcol.armies")} meta={String(items.length)} inSheet={inSheet}>
      <ContextList>
        {rows.length === 0 ? <ContextEmpty>{t("ctxcol.noArmies")}</ContextEmpty> : null}
        {rows.map(({ r, value }) => (
          <ContextRow key={r.id} name={r.name} value={value} meta={tn(r.units.length, "ctxcol.unit", "ctxcol.units", { n: r.units.length })} selected={param === r.id} href={hrefFor("armies", r.id)} />
        ))}
      </ContextList>
      <ContextNewRow label={t("ctxcol.newArmy")} onClick={() => requestNew("armies")} />
    </ContextFrame>
  );
}

/** The Matrix attacker set is the analyses "unit set" the column mirrors. */
const MATRIX_ATTACKERS = "analyses.matrix.attackers";

function AnalysesBody({ inSheet }: BodyProps) {
  const { entries } = useUnitSet(MATRIX_ATTACKERS);
  const total = totalPoints(entries);
  return (
    <ContextFrame eyebrow={t("ctxcol.unitSet")} meta={total === undefined ? String(entries.length) : t("ctxcol.pts", { n: fmtInt(total) })} inSheet={inSheet}>
      <ContextList>
        {entries.length === 0 ? <ContextEmpty>{t("ctxcol.noUnits")}</ContextEmpty> : null}
        {entries.map((e) => (
          <ContextRow key={e.id} name={e.unit.name} value={e.unit.points === undefined ? undefined : t("ctxcol.pts", { n: fmtInt(e.unit.points) })} meta={e.origin} href={hrefFor("analyses")} />
        ))}
      </ContextList>
      <ContextNewRow label={t("ctxcol.addUnit")} href={hrefFor("analyses")} />
    </ContextFrame>
  );
}

function DataBody({ param, inSheet }: BodyProps) {
  const { snapshot, overrides } = useApp();
  const sources: Snapshot["sources"] = snapshot?.sources ?? [];
  return (
    <ContextFrame eyebrow={t("ctxcol.sources")} meta={String(sources.length)} inSheet={inSheet}>
      <ContextList>
        {sources.length === 0 ? <ContextEmpty>{t("ctxcol.noSources")}</ContextEmpty> : null}
        {sources.map((s, i) => (
          <ContextRow key={`${s.adapter}:${i}`} name={s.adapter} value={s.ref} meta={fmtRelative(s.fetchedAt)} title={s.url ?? s.adapter} href={hrefFor("data")} />
        ))}
        <ContextRow name={t("ctxcol.localOverrides")} value={String(overrides.length)} meta={t("ctxcol.overridesMeta")} selected={param === "overrides"} href={hrefFor("data", "overrides")} />
      </ContextList>
      <ContextNewRow label={t("ctxcol.addSource")} href={hrefFor("data")} />
    </ContextFrame>
  );
}

const DOCS: Array<{ key: I18nKey; file: string }> = [
  { key: "ctxcol.doc.design", file: "DESIGN.md" },
  { key: "ctxcol.doc.modelling", file: "MODELLING-NOTES.md" },
  { key: "ctxcol.doc.battleSim", file: "BATTLE-SIM.md" },
  { key: "ctxcol.doc.plugins", file: "PLUGINS.md" },
];

function AboutBody({ inSheet }: BodyProps) {
  return (
    <ContextFrame eyebrow={t("ctxcol.project")} inSheet={inSheet}>
      <ContextList>
        {DOCS.map((d) => (
          <ContextRow key={d.file} name={t(d.key)} value={t("ctxcol.doc.kind")} meta={d.file} href={`${DOC_URL}/${d.file}`} />
        ))}
        <ContextRow name={t("ctxcol.doc.licence")} value="MIT" meta="LICENSE" href={`${REPO_URL}/blob/main/LICENSE`} />
      </ContextList>
      <ContextNewRow label={t("ctxcol.openRepo")} href={REPO_URL} />
    </ContextFrame>
  );
}

/** The 240–264px context column. On phones the same component is rendered inside a sheet. */
export function ContextColumn({ route, param, inSheet }: { route: Route; param?: string | undefined; inSheet?: boolean }) {
  const props: BodyProps = { param, ...(inSheet === undefined ? {} : { inSheet }) };
  switch (route) {
    case "calculator":
      return <CalculatorBody {...props} />;
    case "scenarios":
      return <ScenariosBody {...props} />;
    case "armies":
      return <ArmiesBody {...props} />;
    case "analyses":
      return <AnalysesBody {...props} />;
    case "data":
      return <DataBody {...props} />;
    case "about":
      return <AboutBody {...props} />;
  }
}

/** The eyebrow the column shows for a route — reused by the phone sheet's trigger button. */
export function contextEyebrow(route: Route): string {
  switch (route) {
    case "calculator":
      return t("ctxcol.scenario");
    case "scenarios":
      return t("ctxcol.scenarios");
    case "armies":
      return t("ctxcol.armies");
    case "analyses":
      return t("ctxcol.unitSet");
    case "data":
      return t("ctxcol.sources");
    case "about":
      return t("ctxcol.project");
  }
}
