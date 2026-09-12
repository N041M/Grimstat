import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { UnitArt } from "../UnitArt";
import type { Datasheet, Diagnostic, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import type { UnitCost } from "@grimstat/resolver";
import type { PointsBarModel } from "../../lib/pointsBar";
import { diagnosticsForUnit, modelCountOf, sectionOf, unitDisplayName, wargearSummary, type UnitSection } from "../../lib/roster";
import { fmtInt } from "../../lib/format";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable } from "../kit";
import { AddUnitPanel } from "./AddUnitPanel";
import { Icon, Popover } from "../ui";
import { t, tn, type I18nKey } from "../../i18n";

export { unitDisplayName };

export type CalcSide = "attacker" | "defender";

/** Unit | Role | Models | Points | Status. */
const COLUMNS = "minmax(200px,2.2fr) 130px 90px 80px 92px";
/** The same with a checkbox column in front, in selection mode. */
const SELECT_COLUMNS = `28px ${COLUMNS}`;

const SECTION_KEY: Record<UnitSection, I18nKey> = {
  character: "roster.section.character",
  battleline: "roster.section.battleline",
  transport: "roster.section.transport",
  other: "roster.section.other",
  allied: "roster.section.allied",
};

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  datasheets: Map<string, Datasheet>;
  costById: Map<string, UnitCost>;
  diagnostics: Diagnostic[];
  /** Points spent and spare, for the add-unit panel's head. */
  points: PointsBarModel;
  selectedId: string | undefined;
  adding: boolean;
  onAdding: (open: boolean) => void;
  onSelect: (id: string) => void;
  onAdd: (ds: Datasheet, edit: boolean) => void;
  onDuplicate: (unit: RosterUnit) => void;
  onRemove: (unit: RosterUnit) => void;
  onRemoveMany: (units: RosterUnit[]) => void;
  /** Move a unit `delta` places in `roster.units`. */
  onMove: (unit: RosterUnit, delta: number) => void;
  onOpenInCalculator: (unit: RosterUnit, side: CalcSide) => void;
  /** Empty-state guide hooks. */
  onOpenDetachmentPicker: () => void;
  onExport: () => void;
}

interface RowMenuProps {
  name: string;
  canUp: boolean;
  canDown: boolean;
  onMove: (dir: -1 | 1) => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onCalc: (side: CalcSide) => void;
}

function RowMenu({ name, canUp, canDown, onMove, onDuplicate, onRemove, onCalc }: RowMenuProps) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const run = (fn: () => void) => () => {
    close();
    fn();
  };
  return (
    <Popover
      open={open}
      onClose={close}
      align="end"
      label={t("roster.units.menu", { name })}
      trigger={
        <button type="button" className="ut-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t("roster.units.menu", { name })} onClick={() => setOpen((v) => !v)}>
          <Icon name="more" />
        </button>
      }
    >
      <div className="menu" role="menu">
        <button type="button" role="menuitem" onClick={run(() => onCalc("attacker"))}>
          <Icon name="calc" />
          {t("roster.units.openAttacker")}
        </button>
        <button type="button" role="menuitem" onClick={run(() => onCalc("defender"))}>
          <Icon name="calc" />
          {t("roster.units.openDefender")}
        </button>
        <button type="button" role="menuitem" disabled={!canUp} onClick={run(() => onMove(-1))}>
          <span className="ut-menu-glyph" aria-hidden="true">
            ↑
          </span>
          {t("roster.units.moveUp")}
        </button>
        <button type="button" role="menuitem" disabled={!canDown} onClick={run(() => onMove(1))}>
          <span className="ut-menu-glyph" aria-hidden="true">
            ↓
          </span>
          {t("roster.units.moveDown")}
        </button>
        <button type="button" role="menuitem" onClick={run(onDuplicate)}>
          <Icon name="copy" />
          {t("armies.duplicate")}
        </button>
        <button type="button" role="menuitem" className="danger" onClick={run(onRemove)}>
          <Icon name="trash" />
          {t("roster.inspector.removeUnit")}
        </button>
      </div>
    </Popover>
  );
}

function Guide({ hasDetachment, onDetachment, onUnits, onExport }: { hasDetachment: boolean; onDetachment: () => void; onUnits: () => void; onExport: () => void }) {
  return (
    <div className="guide" aria-label={t("roster.guide.title")}>
      <ol>
        <li className={hasDetachment ? "done" : ""}>
          <span className="guide-n" aria-hidden="true">
            {hasDetachment ? <Icon name="check" /> : "1"}
          </span>
          <div className="guide-body">
            <button type="button" className={`sm ${hasDetachment ? "ghost" : ""}`.trim()} onClick={onDetachment}>
              {hasDetachment ? t("roster.guide.step1.done") : t("roster.guide.step1")}
            </button>
            <span className="small muted">{t("roster.guide.step1.desc")}</span>
          </div>
        </li>
        <li>
          <span className="guide-n" aria-hidden="true">
            2
          </span>
          <div className="guide-body">
            <button type="button" className={`sm ${hasDetachment ? "primary" : ""}`.trim()} onClick={onUnits}>
              {t("roster.guide.step2")}
            </button>
            <span className="small muted">{t("roster.guide.step2.desc")}</span>
          </div>
        </li>
        <li>
          <span className="guide-n" aria-hidden="true">
            3
          </span>
          <div className="guide-body">
            <button type="button" className="sm" onClick={onExport}>
              {t("roster.guide.step3")}
            </button>
            <span className="small muted">{t("roster.guide.step3.desc")}</span>
          </div>
        </li>
      </ol>
    </div>
  );
}

/**
 * The Status cell: the severity that matters most and how many of it ("1 error", "2 warnings",
 * "ok"). Every message, with its fix, goes in the title so hovering reads the whole list.
 */
function statusOf(issues: Diagnostic[]): { label: string; title: string; bad: boolean } {
  const errors = issues.filter((d) => d.severity === "error");
  const warns = issues.filter((d) => d.severity === "warn");
  if (!errors.length && !warns.length) return { label: t("roster.status.legal"), title: t("roster.status.legalTitle"), bad: false };
  const label = errors.length ? tn(errors.length, "roster.issues.error.one", "roster.issues.error.many") : tn(warns.length, "roster.issues.warn.one", "roster.issues.warn.many");
  const title = [...errors, ...warns].map((d) => (d.fix ? `${d.message} ${d.fix}` : d.message)).join("\n");
  return { label, title, bad: true };
}

interface DisplayRow {
  unit: RosterUnit;
  nested: boolean;
  /** Rows can be reordered within this group: the section for top-level units, the host id for attached characters. */
  group: string;
}

/**
 * The army list as the redesign's grid table: one row per unit, attached characters nested under
 * their host, hover actions on the right, ↑/↓ to walk the rows, Alt+↑/↓ to reorder and Delete to
 * remove one. A filter box narrows the rows by name, role or wargear; selection mode adds
 * checkboxes and a "Remove selected" action.
 */
export function UnitTable({ roster, snapshot, datasheets, costById, diagnostics, points, selectedId, adding, onAdding, onSelect, onAdd, onDuplicate, onRemove, onRemoveMany, onMove, onOpenInCalculator, onOpenDetachmentPicker, onExport }: Props) {
  const enhancements = useMemo(() => new Map(snapshot.data.enhancements.map((e) => [e.id, e] as const)), [snapshot]);
  const [query, setQuery] = useState("");
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set());

  /** Top-level units in section order, each followed by the characters attached to it. */
  const rows = useMemo(() => {
    const byId = new Map(roster.units.map((u) => [u.id, u] as const));
    const attachedByHost = new Map<string, RosterUnit[]>();
    const top: RosterUnit[] = [];
    for (const u of roster.units) {
      const hostId = u.attachedTo?.unitId;
      if (hostId && byId.has(hostId) && hostId !== u.id) attachedByHost.set(hostId, [...(attachedByHost.get(hostId) ?? []), u]);
      else top.push(u);
    }
    const order: UnitSection[] = ["character", "battleline", "transport", "other", "allied"];
    const out: DisplayRow[] = [];
    for (const section of order) {
      for (const u of top) {
        if (sectionOf(datasheets.get(u.datasheetId), roster) !== section) continue;
        out.push({ unit: u, nested: false, group: section });
        for (const c of attachedByHost.get(u.id) ?? []) out.push({ unit: c, nested: true, group: u.id });
      }
    }
    return out;
  }, [roster, datasheets]);

  /** Role text: the datasheet's own role when the data has one, else the section it is filed under. */
  const roleOf = (u: RosterUnit): string => {
    const ds = datasheets.get(u.datasheetId);
    const role = ds?.role?.trim();
    return role || t(SECTION_KEY[sectionOf(ds, roster)]);
  };

  /** Sub-line: what the unit is attached to, or its wargear. */
  const subOf = (u: RosterUnit): string => {
    if (u.attachedTo) {
      const host = roster.units.find((h) => h.id === u.attachedTo?.unitId);
      const hostName = host ? unitDisplayName(host, datasheets.get(host.datasheetId)) : t("roster.badge.attached");
      return t(u.attachedTo.role === "leader" ? "roster.badge.leaderOf" : "roster.badge.supportOf", { name: hostName });
    }
    const enh = u.enhancementId ? enhancements.get(u.enhancementId) : undefined;
    const gear = wargearSummary(u, datasheets.get(u.datasheetId));
    return [enh?.name, gear || t("roster.units.gearNone")].filter(Boolean).join(" · ");
  };

  // The filter reads the name, the datasheet name, the role and the wargear line.
  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    if (!q) return rows;
    const hit = (u: RosterUnit) => {
      const ds = datasheets.get(u.datasheetId);
      return [unitDisplayName(u, ds), ds?.name ?? "", roleOf(u), wargearSummary(u, ds), u.enhancementId ? (enhancements.get(u.enhancementId)?.name ?? "") : ""].some((s) => s.toLowerCase().includes(q));
    };
    const kept = rows.filter((r) => hit(r.unit));
    const shown = new Set(kept.map((r) => r.unit.id));
    // An attached character whose host is filtered out is shown flush, not indented under nothing.
    return kept.map((r) => (r.nested && !shown.has(r.unit.attachedTo?.unitId ?? "") ? { ...r, nested: false } : r));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, datasheets, enhancements, roster]);

  /** The row above or below within the same group, which is what "move up / down" swaps places with. */
  const neighbour = (unit: RosterUnit, dir: -1 | 1): RosterUnit | undefined => {
    const i = rows.findIndex((r) => r.unit.id === unit.id);
    if (i < 0) return undefined;
    const group = rows[i]!.group;
    for (let j = i + dir; j >= 0 && j < rows.length; j += dir) if (rows[j]!.group === group) return rows[j]!.unit;
    return undefined;
  };
  const move = (unit: RosterUnit, dir: -1 | 1) => {
    const n = neighbour(unit, dir);
    if (!n) return;
    onMove(unit, roster.units.indexOf(n) - roster.units.indexOf(unit));
  };

  const pickedUnits = useMemo(() => roster.units.filter((u) => picked.has(u.id)), [roster.units, picked]);
  const togglePick = (id: string) =>
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const exitSelect = () => {
    setSelecting(false);
    setPicked(new Set());
  };
  const removePicked = () => {
    if (!pickedUnits.length) return;
    onRemoveMany(pickedUnits);
    setPicked(new Set());
  };

  // ↑/↓ walk the name buttons; Alt+↑/↓ reorder; Delete/Backspace removes the focused unit (the page offers Undo).
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("ut-name")) return;
    const id = target.closest<HTMLElement>("[data-unit-id]")?.dataset.unitId;
    const unit = roster.units.find((u) => u.id === id);
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.altKey) {
      if (!unit) return;
      e.preventDefault();
      move(unit, e.key === "ArrowDown" ? 1 : -1);
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const all = [...e.currentTarget.querySelectorAll<HTMLElement>(".ut-name")];
      const i = all.indexOf(target);
      all[e.key === "ArrowDown" ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (!unit) return;
      e.preventDefault();
      onRemove(unit);
    }
  };

  const tools = (
    <div className="ut-tools">
      <label className="ut-filter">
        <Icon name="search" />
        <span className="sr-only">{t("roster.units.filter")}</span>
        <input type="search" value={query} placeholder={t("roster.units.filterPlaceholder")} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {selecting ? (
        <>
          <span className="ut-tools-count" role="status" aria-live="polite">
            {t("roster.units.selected", { n: pickedUnits.length })}
          </span>
          <button type="button" className="sm ghost" onClick={() => setPicked(new Set(visible.map((r) => r.unit.id)))}>
            {t("roster.units.selectAll")}
          </button>
          <button type="button" className="sm danger" disabled={!pickedUnits.length} onClick={removePicked}>
            <Icon name="trash" />
            {t("roster.units.removeSelected")}
          </button>
          <button type="button" className="sm" onClick={exitSelect}>
            {t("roster.units.selectDone")}
          </button>
        </>
      ) : (
        <button type="button" className="sm ghost" onClick={() => setSelecting(true)}>
          {t("roster.units.selectMode")}
        </button>
      )}
    </div>
  );

  return (
    <div className="unit-table-wrap">
      {adding ? (
        <div className="ut-add">
          <AddUnitPanel roster={roster} snapshot={snapshot} points={points} onClose={() => onAdding(false)} onAdd={onAdd} />
        </div>
      ) : null}
      {roster.units.length === 0 ? (
        <div className="ut-guide">
          <Guide hasDetachment={roster.detachments.length > 0} onDetachment={onOpenDetachmentPicker} onUnits={() => onAdding(true)} onExport={onExport} />
        </div>
      ) : (
        <div onKeyDown={onKey}>
          {tools}
          {visible.length === 0 ? (
            <p className="ut-empty small muted">{t("roster.units.noMatch", { q: query.trim() })}</p>
          ) : (
            <GridTable columns={selecting ? SELECT_COLUMNS : COLUMNS} label={t("roster.units")} className={`ut-table ${selecting ? "selecting" : ""}`.trim()}>
              <GridHead>
                {selecting ? (
                  <GridHeadCell>
                    <span className="sr-only">{t("roster.col.select")}</span>
                  </GridHeadCell>
                ) : null}
                <GridHeadCell>{t("roster.col.unit")}</GridHeadCell>
                <GridHeadCell>{t("roster.col.role")}</GridHeadCell>
                <GridHeadCell align="end">{t("roster.col.models")}</GridHeadCell>
                <GridHeadCell align="end">{t("roster.col.points")}</GridHeadCell>
                <GridHeadCell align="end">{t("roster.col.status")}</GridHeadCell>
              </GridHead>
              {visible.map(({ unit, nested }) => {
                const ds = datasheets.get(unit.datasheetId);
                const name = unitDisplayName(unit, ds);
                const cost = costById.get(unit.id);
                const issues = diagnosticsForUnit(diagnostics, roster.units.indexOf(unit));
                const status = statusOf(issues);
                const models = modelCountOf(unit);
                const isPicked = picked.has(unit.id);
                const badges: ReactNode = unit.isWarlord ? <span className="ut-badge">{t("roster.badge.warlord")}</span> : null;
                const activate = () => (selecting ? togglePick(unit.id) : onSelect(unit.id));
                return (
                  <GridRow key={unit.id} className={`ut-row ${unit.id === selectedId ? "current" : ""} ${nested ? "nested" : ""} ${isPicked ? "picked" : ""}`.trim()} onClick={activate}>
                    {selecting ? (
                      <GridCell className="ut-check">
                        <input type="checkbox" checked={isPicked} aria-label={t("roster.units.select", { name })} onClick={(e) => e.stopPropagation()} onChange={() => togglePick(unit.id)} />
                      </GridCell>
                    ) : null}
                    <GridCell className="ut-unit">
                      <button
                        type="button"
                        className="ut-name"
                        data-unit-id={unit.id}
                        aria-pressed={selecting ? isPicked : unit.id === selectedId}
                        onClick={(e) => {
                          e.stopPropagation();
                          activate();
                        }}
                      >
                        <span className="ut-name-line">
                          {nested ? (
                            <span className="ut-nest" aria-hidden="true">
                              ↳
                            </span>
                          ) : null}
                          <UnitArt of={ds} className="ut-art" />
                          <span className="ut-name-text">{name}</span>
                          {badges}
                        </span>
                        <span className="ut-sub" title={subOf(unit)}>
                          {subOf(unit)}
                        </span>
                      </button>
                    </GridCell>
                    <GridCell tone="muted" className="ut-role">
                      {roleOf(unit)}
                    </GridCell>
                    <GridCell align="end" mono className="ut-models">
                      <span className="ut-num">{fmtInt(models)}</span>
                      <span className="ut-phrase">{tn(models, "roster.units.model", "roster.units.models")}</span>
                    </GridCell>
                    <GridCell align="end" mono className="ut-points">
                      <span className="ut-num">{cost ? fmtInt(cost.total) : "–"}</span>
                      <span className="ut-phrase">{cost ? t("unit.points", { v: fmtInt(cost.total) }) : "–"}</span>
                    </GridCell>
                    <GridCell align="end" mono tone={status.bad ? "accent" : "faint"} className="ut-status">
                      <span title={status.title}>{status.label}</span>
                    </GridCell>
                    <span className="ut-actions">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenInCalculator(unit, "attacker");
                        }}
                        title={t("roster.units.openAttacker")}
                        aria-label={`${t("roster.units.openAttacker")}: ${name}`}
                      >
                        <Icon name="calc" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDuplicate(unit);
                        }}
                        title={t("armies.duplicate")}
                        aria-label={t("roster.units.duplicate", { name })}
                      >
                        <Icon name="copy" />
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove(unit);
                        }}
                        title={t("roster.inspector.removeUnit")}
                        aria-label={t("roster.units.remove", { name })}
                      >
                        <Icon name="trash" />
                      </button>
                      <span onClick={(e) => e.stopPropagation()}>
                        <RowMenu
                          name={name}
                          canUp={neighbour(unit, -1) !== undefined}
                          canDown={neighbour(unit, 1) !== undefined}
                          onMove={(dir) => move(unit, dir)}
                          onDuplicate={() => onDuplicate(unit)}
                          onRemove={() => onRemove(unit)}
                          onCalc={(side) => onOpenInCalculator(unit, side)}
                        />
                      </span>
                    </span>
                  </GridRow>
                );
              })}
            </GridTable>
          )}
          <p className="ut-keys">{t("roster.units.listKeys")}</p>
        </div>
      )}
    </div>
  );
}
