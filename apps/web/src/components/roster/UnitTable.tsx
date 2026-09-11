import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import { UnitArt } from "../UnitArt";
import type { Datasheet, Diagnostic, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import type { UnitCost } from "@grimstat/resolver";
import { diagnosticsForUnit, modelCountOf, sectionOf, unitDisplayName, wargearSummary, type UnitSection } from "../../lib/roster";
import { fmtInt } from "../../lib/format";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable } from "../kit";
import { AddUnitPanel } from "./AddUnitPanel";
import { Icon, Popover } from "../ui";
import { t, type I18nKey } from "../../i18n";

export { unitDisplayName };

export type CalcSide = "attacker" | "defender";

/** Unit | Role | Models | Points | Status. */
const COLUMNS = "minmax(200px,2.2fr) 130px 90px 80px 92px";

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
  selectedId: string | undefined;
  adding: boolean;
  onAdding: (open: boolean) => void;
  onSelect: (id: string) => void;
  onAdd: (ds: Datasheet, edit: boolean) => void;
  onDuplicate: (unit: RosterUnit) => void;
  onRemove: (unit: RosterUnit) => void;
  onOpenInCalculator: (unit: RosterUnit, side: CalcSide) => void;
  /** Empty-state guide hooks. */
  onOpenDetachmentPicker: () => void;
  onExport: () => void;
}

function RowMenu({ name, onDuplicate, onRemove, onCalc }: { name: string; onDuplicate: () => void; onRemove: () => void; onCalc: (side: CalcSide) => void }) {
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

/** "characters.legality" → "legality": the specific problem, with the full message as the title. */
function statusOf(issues: Diagnostic[]): { label: string; title: string; bad: boolean } {
  const worst = issues.find((d) => d.severity === "error") ?? issues.find((d) => d.severity === "warn");
  if (!worst) return { label: t("roster.status.legal"), title: t("roster.status.legalTitle"), bad: false };
  const short = worst.code.split(".").pop() ?? worst.code;
  return { label: short, title: worst.fix ? `${worst.message} — ${worst.fix}` : worst.message, bad: true };
}

/**
 * The army list as the redesign's grid table: one row per unit, attached characters nested under
 * their host, hover actions on the right, ↑/↓ to walk the rows and Delete to remove one.
 */
export function UnitTable({ roster, snapshot, datasheets, costById, diagnostics, selectedId, adding, onAdding, onSelect, onAdd, onDuplicate, onRemove, onOpenInCalculator, onOpenDetachmentPicker, onExport }: Props) {
  const enhancements = useMemo(() => new Map(snapshot.data.enhancements.map((e) => [e.id, e] as const)), [snapshot]);

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
    const out: Array<{ unit: RosterUnit; nested: boolean }> = [];
    for (const section of order) {
      for (const u of top) {
        if (sectionOf(datasheets.get(u.datasheetId), roster) !== section) continue;
        out.push({ unit: u, nested: false });
        for (const c of attachedByHost.get(u.id) ?? []) out.push({ unit: c, nested: true });
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

  // ↑/↓ walk the name buttons; Delete/Backspace removes the focused unit after a confirm.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("ut-name")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const all = [...e.currentTarget.querySelectorAll<HTMLElement>(".ut-name")];
      const i = all.indexOf(target);
      all[e.key === "ArrowDown" ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1)]?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const id = target.closest<HTMLElement>("[data-unit-id]")?.dataset.unitId;
      const unit = roster.units.find((u) => u.id === id);
      if (!unit) return;
      e.preventDefault();
      const name = unitDisplayName(unit, datasheets.get(unit.datasheetId));
      if (window.confirm(t("roster.units.confirmRemove", { name }))) onRemove(unit);
    }
  };

  return (
    <div className="unit-table-wrap">
      {adding ? (
        <div className="ut-add">
          <AddUnitPanel roster={roster} snapshot={snapshot} onClose={() => onAdding(false)} onAdd={onAdd} />
        </div>
      ) : null}
      {roster.units.length === 0 ? (
        <div className="ut-guide">
          <Guide hasDetachment={roster.detachments.length > 0} onDetachment={onOpenDetachmentPicker} onUnits={() => onAdding(true)} onExport={onExport} />
        </div>
      ) : (
        <div onKeyDown={onKey}>
          <GridTable columns={COLUMNS} label={t("roster.units")} className="ut-table">
            <GridHead>
              <GridHeadCell>{t("roster.col.unit")}</GridHeadCell>
              <GridHeadCell>{t("roster.col.role")}</GridHeadCell>
              <GridHeadCell align="end">{t("roster.col.models")}</GridHeadCell>
              <GridHeadCell align="end">{t("roster.col.points")}</GridHeadCell>
              <GridHeadCell align="end">{t("roster.col.status")}</GridHeadCell>
            </GridHead>
            {rows.map(({ unit, nested }) => {
              const ds = datasheets.get(unit.datasheetId);
              const name = unitDisplayName(unit, ds);
              const cost = costById.get(unit.id);
              const issues = diagnosticsForUnit(diagnostics, roster.units.indexOf(unit));
              const status = statusOf(issues);
              const badges: ReactNode = unit.isWarlord ? <span className="ut-badge">{t("roster.badge.warlord")}</span> : null;
              return (
                <GridRow key={unit.id} className={`ut-row ${unit.id === selectedId ? "current" : ""} ${nested ? "nested" : ""}`.trim()} onClick={() => onSelect(unit.id)}>
                  <GridCell className="ut-unit">
                    <button
                      type="button"
                      className="ut-name"
                      data-unit-id={unit.id}
                      aria-pressed={unit.id === selectedId}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelect(unit.id);
                      }}
                    >
                      <span className="ut-name-line">
                        {nested ? (
                          <span className="ut-nest" aria-hidden="true">
                            ↳
                          </span>
                        ) : null}
                        <UnitArt keywords={ds?.keywords ?? []} className="ut-art" />
                        <span className="ut-name-text">{name}</span>
                        {badges}
                      </span>
                      <span className="ut-sub" title={subOf(unit)}>
                        {subOf(unit)}
                      </span>
                    </button>
                  </GridCell>
                  <GridCell tone="muted">{roleOf(unit)}</GridCell>
                  <GridCell align="end" mono>
                    {fmtInt(modelCountOf(unit))}
                  </GridCell>
                  <GridCell align="end" mono>
                    {cost ? fmtInt(cost.total) : "–"}
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
                      <RowMenu name={name} onDuplicate={() => onDuplicate(unit)} onRemove={() => onRemove(unit)} onCalc={(side) => onOpenInCalculator(unit, side)} />
                    </span>
                  </span>
                </GridRow>
              );
            })}
          </GridTable>
          <p className="ut-keys">{t("roster.units.listKeys")}</p>
        </div>
      )}
    </div>
  );
}
