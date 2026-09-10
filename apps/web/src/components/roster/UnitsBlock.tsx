import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from "react";
import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import type { UnitCost } from "@grimstat/resolver";
import { modelCountOf, SECTION_ORDER, sectionOf, unitDisplayName, wargearSummary, type UnitSection } from "../../lib/roster";
import { fmtInt } from "../../lib/format";
import { AddUnitPanel } from "./AddUnitPanel";
import { Icon, Popover } from "../ui";
import { t, type I18nKey, tn } from "../../i18n";

export { unitDisplayName };

export type CalcSide = "attacker" | "defender";

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  datasheets: Map<string, Datasheet>;
  costById: Map<string, UnitCost>;
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

const SECTION_KEY: Record<UnitSection, I18nKey> = {
  character: "roster.section.character",
  battleline: "roster.section.battleline",
  transport: "roster.section.transport",
  other: "roster.section.other",
  allied: "roster.section.allied",
};

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
        <button type="button" className="ghost sm icon-btn unit-menu-btn" aria-haspopup="menu" aria-expanded={open} aria-label={t("roster.units.menu", { name })} onClick={() => setOpen((v) => !v)}>
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

function UnitRow({ unit, ds, cost, selected, nested, badges, onSelect, onDuplicate, onRemove, onCalc }: { unit: RosterUnit; ds: Datasheet | undefined; cost: UnitCost | undefined; selected: boolean; nested: boolean; badges: ReactNode; onSelect: () => void; onDuplicate: () => void; onRemove: () => void; onCalc: (side: CalcSide) => void }) {
  const name = unitDisplayName(unit, ds);
  const custom = !!unit.customName?.trim() && !!ds;
  const gear = wargearSummary(unit, ds);
  const models = modelCountOf(unit);
  return (
    <li className={`unit-row ${selected ? "selected" : ""} ${nested ? "nested" : ""}`.trim()} data-unit-id={unit.id}>
      <button type="button" className="unit-main" aria-pressed={selected} aria-label={t("roster.units.select", { name })} onClick={onSelect}>
        <span className="unit-line">
          <span className="unit-title">
            <span className="unit-name">
              <strong>{name}</strong>
              {custom ? <span className="muted small unit-sheet"> {ds!.name}</span> : null}
            </span>
            <span className="unit-badges">{badges}</span>
          </span>
          <span className="unit-pts">{cost ? t("unit.points", { v: fmtInt(cost.total) }) : "–"}</span>
        </span>
        <span className="unit-gear muted small" title={gear || undefined}>
          <span className="unit-models">{tn(models, "roster.units.model", "roster.units.models", { n: models })}</span>
          <span className="unit-gear-text">{gear || t("roster.units.gearNone")}</span>
        </span>
      </button>
      <span className="unit-actions">
        <span className="unit-quick">
          <button type="button" className="ghost sm icon-btn" onClick={() => onCalc("attacker")} aria-label={`${t("roster.units.openAttacker")}: ${name}`} title={t("roster.units.openAttacker")}>
            <Icon name="calc" />
          </button>
          <button type="button" className="ghost sm icon-btn" onClick={onDuplicate} aria-label={t("roster.units.duplicate", { name })} title={t("armies.duplicate")}>
            <Icon name="copy" />
          </button>
          <button type="button" className="ghost sm icon-btn danger" onClick={onRemove} aria-label={t("roster.units.remove", { name })} title={t("roster.inspector.removeUnit")}>
            <Icon name="trash" />
          </button>
        </span>
        <RowMenu name={name} onDuplicate={onDuplicate} onRemove={onRemove} onCalc={onCalc} />
      </span>
    </li>
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

/** The army list: role sections with counts and points, rows with wargear summaries, nested attached characters. */
export function UnitsBlock({ roster, snapshot, datasheets, costById, selectedId, adding, onAdding, onSelect, onAdd, onDuplicate, onRemove, onOpenInCalculator, onOpenDetachmentPicker, onExport }: Props) {
  const enhancements = useMemo(() => new Map(snapshot.data.enhancements.map((e) => [e.id, e] as const)), [snapshot]);

  const { sections, attachedByHost } = useMemo(() => {
    const byId = new Map(roster.units.map((u) => [u.id, u] as const));
    const attachedByHost = new Map<string, RosterUnit[]>();
    const top: RosterUnit[] = [];
    for (const u of roster.units) {
      const hostId = u.attachedTo?.unitId;
      if (hostId && byId.has(hostId) && hostId !== u.id) attachedByHost.set(hostId, [...(attachedByHost.get(hostId) ?? []), u]);
      else top.push(u);
    }
    const cost = (u: RosterUnit) => costById.get(u.id)?.total ?? 0;
    const sections = SECTION_ORDER.map((section) => {
      const units = top.filter((u) => sectionOf(datasheets.get(u.datasheetId), roster) === section);
      const rows = units.length + units.reduce((s, u) => s + (attachedByHost.get(u.id)?.length ?? 0), 0);
      const points = units.reduce((s, u) => s + cost(u) + (attachedByHost.get(u.id) ?? []).reduce((x, c) => x + cost(c), 0), 0);
      return { section, units, rows, points };
    }).filter((s) => s.units.length);
    return { sections, attachedByHost };
  }, [roster, datasheets, costById]);

  const badgesFor = (u: RosterUnit): ReactNode => {
    const host = u.attachedTo ? roster.units.find((h) => h.id === u.attachedTo?.unitId) : undefined;
    const enh = u.enhancementId ? enhancements.get(u.enhancementId) : undefined;
    return (
      <>
        {u.isWarlord ? <span className="badge accent">{t("roster.badge.warlord")}</span> : null}
        {u.attachedTo ? <span className="badge">{host ? t(u.attachedTo.role === "leader" ? "roster.badge.leaderOf" : "roster.badge.supportOf", { name: unitDisplayName(host, datasheets.get(host.datasheetId)) }) : t("roster.badge.attached")}</span> : null}
        {u.enhancementId ? <span className="badge brass">{enh?.name ?? u.enhancementId}</span> : null}
      </>
    );
  };

  const row = (u: RosterUnit, nested: boolean) => (
    <UnitRow key={u.id} unit={u} ds={datasheets.get(u.datasheetId)} cost={costById.get(u.id)} selected={u.id === selectedId} nested={nested} badges={badgesFor(u)} onSelect={() => onSelect(u.id)} onDuplicate={() => onDuplicate(u)} onRemove={() => onRemove(u)} onCalc={(side) => onOpenInCalculator(u, side)} />
  );

  // Keyboard navigation over the row buttons: ↑/↓ move focus, Enter selects (native), Delete removes with a confirm.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (!target.classList.contains("unit-main")) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const all = [...e.currentTarget.querySelectorAll<HTMLElement>(".unit-main")];
      const i = all.indexOf(target);
      const next = all[e.key === "ArrowDown" ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1)];
      next?.focus();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      const id = target.closest<HTMLElement>("[data-unit-id]")?.dataset.unitId;
      const unit = roster.units.find((u) => u.id === id);
      if (!unit) return;
      e.preventDefault();
      const name = unitDisplayName(unit, datasheets.get(unit.datasheetId));
      if (window.confirm(t("roster.units.confirmRemove", { name }))) onRemove(unit);
    }
  };

  const total = roster.units.length;
  return (
    <section className="panel units-panel" aria-labelledby="units-h">
      <div className="panel-head">
        <h2 id="units-h">
          {t("roster.units")} {total ? <span className="count muted">{total}</span> : null}
        </h2>
        <span className="row">
          {total ? <span className="small muted keys-hint">{t("roster.units.listKeys")}</span> : null}
          <button type="button" className="primary sm" onClick={() => onAdding(!adding)} aria-expanded={adding}>
            <Icon name="plus" />
            {t("roster.units.add")}
          </button>
        </span>
      </div>
      {adding ? <AddUnitPanel roster={roster} snapshot={snapshot} onClose={() => onAdding(false)} onAdd={onAdd} /> : null}
      {total === 0 ? <Guide hasDetachment={roster.detachments.length > 0} onDetachment={onOpenDetachmentPicker} onUnits={() => onAdding(true)} onExport={onExport} /> : null}
      <div className="unit-lists" onKeyDown={onKey}>
        {sections.map((s) => (
          <div key={s.section} className="unit-section">
            <div className="unit-section-head">
              <h3 className="unit-section-title">{t(SECTION_KEY[s.section])}</h3>
              <span className="unit-section-count">{s.rows}</span>
              <span className="unit-section-pts">{t("unit.points", { v: fmtInt(s.points) })}</span>
            </div>
            <ul className="unit-list" role="list">
              {s.units.map((u) => (
                <li key={u.id} className="unit-group">
                  <ul className="unit-list" role="list">
                    {row(u, false)}
                    {(attachedByHost.get(u.id) ?? []).map((c) => row(c, true))}
                  </ul>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
