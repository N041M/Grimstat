import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { UnitArt } from "../UnitArt";
import type { Datasheet, Roster, Snapshot } from "@grimstat/schema";
import { pointsFor } from "@grimstat/game-40k-11e";
import { compositionBounds, duplicateCap, PICKER_GROUP_ORDER, pickerGroupOf, type PickerGroup } from "../../lib/roster";
import { fmtInt } from "../../lib/format";
import { battleSizeKey } from "../../pages/ArmiesPage";
import { Icon } from "../ui";
import { t, type I18nKey } from "../../i18n";

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  /** `edit` = "Add & edit": the page selects the new unit and closes the picker. */
  onAdd: (ds: Datasheet, edit: boolean) => void;
  onClose: () => void;
}

const GROUP_KEY: Record<PickerGroup, I18nKey> = {
  character: "roster.section.character",
  battleline: "roster.section.battleline",
  transport: "roster.section.transport",
  other: "roster.section.other",
  legends: "roster.units.group.legends",
};

function sizeLabel(ds: Datasheet): string {
  const b = compositionBounds(ds);
  if (b.max === undefined) return b.min === 1 ? t("roster.units.models", { n: 1 }) : t("roster.units.modelsMin", { min: b.min });
  return b.min === b.max ? t("roster.units.models", { n: b.min }) : t("roster.units.modelsRange", { min: b.min, max: b.max });
}

interface Row {
  ds: Datasheet;
  size: string;
  points: number | undefined;
  copies: number;
  /** Set when the duplication cap is reached — the reason the row is disabled. */
  blocked: string | undefined;
}

/** Searchable, role-grouped datasheet picker with keyboard navigation and a duplication cap per battle size. */
export function AddUnitPanel({ roster, snapshot, onAdd, onClose }: Props) {
  const [search, setSearch] = useState("");
  const [hl, setHl] = useState(0);
  const [added, setAdded] = useState<string | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const copies = useMemo(() => {
    const m = new Map<string, number>();
    for (const u of roster.units) m.set(u.datasheetId, (m.get(u.datasheetId) ?? 0) + 1);
    return m;
  }, [roster.units]);

  const groups = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sizeName = t(battleSizeKey(roster.battleSize));
    const rows: Row[] = snapshot.data.datasheets
      .filter((d) => d.factionId === roster.factionId && (!q || d.name.toLowerCase().includes(q) || (d.role ?? "").toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((ds) => {
        const n = copies.get(ds.id) ?? 0;
        const cap = duplicateCap(ds, roster.battleSize);
        const blocked = n >= cap.cap ? (cap.kind === "epicHero" ? t("roster.units.capEpic") : cap.kind === "battleline" ? t("roster.units.capBattleline", { cap: cap.cap, size: sizeName }) : t("roster.units.capReached", { cap: cap.cap, size: sizeName })) : undefined;
        return { ds, size: sizeLabel(ds), points: pointsFor(ds, snapshot, compositionBounds(ds).min), copies: n, blocked };
      });
    return PICKER_GROUP_ORDER.map((group) => ({ group, rows: rows.filter((r) => pickerGroupOf(r.ds) === group) })).filter((g) => g.rows.length);
  }, [snapshot, roster.factionId, roster.battleSize, search, copies]);

  const flat = useMemo(() => groups.flatMap((g) => g.rows), [groups]);

  useEffect(() => {
    if (hl >= flat.length) setHl(Math.max(0, flat.length - 1));
  }, [flat.length, hl]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-i="${hl}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [hl]);

  const add = (row: Row, edit: boolean) => {
    if (row.blocked) return;
    onAdd(row.ds, edit);
    setAdded(row.ds.name);
    if (!edit) input.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setHl((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHl((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter" && e.target === input.current) {
      const row = flat[hl];
      if (row) {
        e.preventDefault();
        add(row, e.shiftKey);
      }
    }
  };

  let index = -1;
  return (
    <div className="add-unit" onKeyDown={onKey} role="region" aria-label={t("roster.units.pickerTitle")}>
      <div className="add-unit-head">
        <strong>{t("roster.units.pickerTitle")}</strong>
        <span className="small muted keys-hint">{t("roster.units.pickerKeys")}</span>
        <button type="button" className="ghost sm icon-btn" onClick={onClose} aria-label={t("roster.units.close")}>
          <Icon name="close" />
        </button>
      </div>
      <div className="search-wrap">
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          value={search}
          placeholder={t("roster.units.searchPlaceholder")}
          aria-label={t("roster.units.search")}
          onChange={(e) => {
            setSearch(e.target.value);
            setHl(0);
          }}
        />
      </div>
      <div className="small ok-text add-unit-live" role="status" aria-live="polite">
        {added ? (
          <>
            <Icon name="check" />
            {t("roster.units.added", { name: added })}
          </>
        ) : null}
      </div>
      <div className="datasheet-list" ref={listRef} aria-label={t("roster.units.list")}>
        {flat.length ? (
          groups.map((g) => (
            <div key={g.group} className={`ds-group ${g.group === "legends" ? "legends" : ""}`.trim()}>
              <div className="ds-group-head">{t(GROUP_KEY[g.group])}</div>
              <ul className="ds-rows" role="list">
                {g.rows.map((row) => {
                  index += 1;
                  const i = index;
                  return (
                    <li key={row.ds.id} className={`ds-row ${i === hl ? "hl" : ""} ${row.blocked ? "blocked" : ""}`.trim()} data-i={i} onMouseEnter={() => setHl(i)}>
                      <button type="button" className="ds-main" disabled={!!row.blocked} onClick={() => add(row, false)} aria-label={`${t("roster.units.addOne")} ${row.ds.name}`} title={row.blocked}>
                        <span className="ds-name">
                          <UnitArt of={row.ds} />
                          {row.ds.name}
                          {row.ds.isLegends ? <span className="badge">{t("roster.units.legendsTag")}</span> : null}
                          {row.copies ? <span className="badge">{t("roster.units.inList", { n: row.copies })}</span> : null}
                        </span>
                        <span className="ds-meta muted small">
                          {row.size}
                          {row.points !== undefined ? ` · ${t("roster.units.from", { v: fmtInt(row.points) })}` : ""}
                          {row.blocked ? <span className="danger-text"> · {row.blocked}</span> : null}
                        </span>
                      </button>
                      <span className="ds-actions">
                        <button type="button" className="sm ds-add" disabled={!!row.blocked} onClick={() => add(row, false)} tabIndex={-1} aria-hidden="true">
                          {t("roster.units.addOne")}
                        </button>
                        <button type="button" className="sm ds-add-edit" disabled={!!row.blocked} onClick={() => add(row, true)} aria-label={`${t("roster.units.addEdit")} ${row.ds.name}`}>
                          {t("roster.units.addEdit")}
                        </button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        ) : (
          <div className="empty small">{t("roster.units.none")}</div>
        )}
      </div>
    </div>
  );
}
