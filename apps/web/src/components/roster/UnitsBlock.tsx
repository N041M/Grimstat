import { useMemo, useState, type ReactNode } from "react";
import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import type { UnitCost } from "@grimstat/resolver";
import { modelCountOf, SECTION_ORDER, sectionOf, type UnitSection } from "../../lib/roster";
import { fmtInt } from "../../lib/format";
import { AddUnitPanel } from "./AddUnitPanel";
import { t } from "../../i18n";

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  datasheets: Map<string, Datasheet>;
  costById: Map<string, UnitCost>;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onAdd: (ds: Datasheet) => void;
  onDuplicate: (unit: RosterUnit) => void;
  onRemove: (unit: RosterUnit) => void;
}

const SECTION_KEY: Record<UnitSection, "roster.section.character" | "roster.section.battleline" | "roster.section.transport" | "roster.section.other" | "roster.section.allied"> = {
  character: "roster.section.character",
  battleline: "roster.section.battleline",
  transport: "roster.section.transport",
  other: "roster.section.other",
  allied: "roster.section.allied",
};

export function unitDisplayName(unit: RosterUnit, ds: Datasheet | undefined): string {
  return unit.customName?.trim() || ds?.name || unit.datasheetId;
}

function UnitRow({ unit, ds, cost, selected, nested, badges, onSelect, onDuplicate, onRemove }: { unit: RosterUnit; ds: Datasheet | undefined; cost: UnitCost | undefined; selected: boolean; nested: boolean; badges: ReactNode; onSelect: () => void; onDuplicate: () => void; onRemove: () => void }) {
  const name = unitDisplayName(unit, ds);
  return (
    <li className={`unit-row ${selected ? "selected" : ""} ${nested ? "nested" : ""}`.trim()}>
      <button type="button" className="unit-main" aria-pressed={selected} aria-label={t("roster.units.select", { name })} onClick={onSelect}>
        <span className="unit-name">
          {nested ? <span className="muted" aria-hidden="true">↳ </span> : null}
          <strong>{name}</strong>
          {unit.customName?.trim() && ds ? <span className="muted small"> · {ds.name}</span> : null}
        </span>
        <span className="unit-badges">{badges}</span>
        <span className="unit-meta muted small">{t("roster.units.models", { n: modelCountOf(unit) })}</span>
        <span className="unit-pts">{cost ? t("unit.points", { v: fmtInt(cost.total) }) : "–"}</span>
      </button>
      <span className="unit-actions">
        <button type="button" className="ghost sm" onClick={onDuplicate} aria-label={t("roster.units.duplicate", { name })} title={t("armies.duplicate")}>
          ⧉
        </button>
        <button type="button" className="ghost sm danger" onClick={onRemove} aria-label={t("roster.units.remove", { name })} title={t("armies.delete")}>
          ×
        </button>
      </span>
    </li>
  );
}

export function UnitsBlock({ roster, snapshot, datasheets, costById, selectedId, onSelect, onAdd, onDuplicate, onRemove }: Props) {
  const [adding, setAdding] = useState(false);
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
    const sections = SECTION_ORDER.map((section) => ({ section, units: top.filter((u) => sectionOf(datasheets.get(u.datasheetId), roster) === section) })).filter((s) => s.units.length);
    return { sections, attachedByHost };
  }, [roster, datasheets]);

  const badgesFor = (u: RosterUnit): ReactNode => {
    const host = u.attachedTo ? roster.units.find((h) => h.id === u.attachedTo?.unitId) : undefined;
    const enh = u.enhancementId ? enhancements.get(u.enhancementId) : undefined;
    return (
      <>
        {u.isWarlord ? <span className="badge accent">{t("roster.badge.warlord")}</span> : null}
        {u.attachedTo ? <span className="badge">{host ? t(u.attachedTo.role === "leader" ? "roster.badge.leaderOf" : "roster.badge.supportOf", { name: unitDisplayName(host, datasheets.get(host.datasheetId)) }) : t("roster.badge.attached")}</span> : null}
        {u.enhancementId ? <span className="badge warn">{enh?.name ?? u.enhancementId}</span> : null}
      </>
    );
  };

  const row = (u: RosterUnit, nested: boolean) => (
    <UnitRow key={u.id} unit={u} ds={datasheets.get(u.datasheetId)} cost={costById.get(u.id)} selected={u.id === selectedId} nested={nested} badges={badgesFor(u)} onSelect={() => onSelect(u.id)} onDuplicate={() => onDuplicate(u)} onRemove={() => onRemove(u)} />
  );

  return (
    <section className="panel" aria-labelledby="units-h">
      <div className="panel-head">
        <h2 id="units-h">{t("roster.units")}</h2>
        <button type="button" className="primary sm" onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          {t("roster.units.add")}
        </button>
      </div>
      {adding ? (
        <AddUnitPanel
          roster={roster}
          snapshot={snapshot}
          onClose={() => setAdding(false)}
          onAdd={(ds) => {
            onAdd(ds);
            setAdding(false);
          }}
        />
      ) : null}
      {roster.units.length === 0 && !adding ? <div className="empty">{t("roster.units.empty")}</div> : null}
      {sections.map((s) => (
        <div key={s.section} className="unit-section">
          <h3 className="unit-section-title">{t(SECTION_KEY[s.section])}</h3>
          <ul className="unit-list">
            {s.units.map((u) => (
              <li key={u.id} className="unit-group">
                <ul className="unit-list">
                  {row(u, false)}
                  {(attachedByHost.get(u.id) ?? []).map((c) => row(c, true))}
                </ul>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}
