import { useEffect, useMemo, useRef, useState } from "react";
import type { Datasheet, Roster, Snapshot } from "@grimstat/schema";
import { pointsFor } from "@grimstat/game-40k-11e";
import { compositionBounds } from "../../lib/roster";
import { fmtInt } from "../../lib/format";
import { Field } from "../ui";
import { t } from "../../i18n";

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  onAdd: (ds: Datasheet) => void;
  onClose: () => void;
}

function sizeLabel(ds: Datasheet): string {
  const b = compositionBounds(ds);
  if (b.max === undefined) return b.min === 1 ? t("roster.units.models", { n: 1 }) : t("roster.units.modelsMin", { min: b.min });
  return b.min === b.max ? t("roster.units.models", { n: b.min }) : t("roster.units.modelsRange", { min: b.min, max: b.max });
}

/** Searchable datasheet picker for the roster's faction. */
export function AddUnitPanel({ roster, snapshot, onAdd, onClose }: Props) {
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    input.current?.focus();
  }, []);

  const sheets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return snapshot.data.datasheets
      .filter((d) => d.factionId === roster.factionId && (!q || d.name.toLowerCase().includes(q) || (d.role ?? "").toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((ds) => ({ ds, size: sizeLabel(ds), points: pointsFor(ds, snapshot, compositionBounds(ds).min) }));
  }, [snapshot, roster.factionId, search]);

  return (
    <div className="add-unit" onKeyDown={(e) => (e.key === "Escape" ? onClose() : undefined)}>
      <div className="field-row">
        <Field label={t("roster.units.search")} className="grow">
          <input ref={input} type="search" value={search} placeholder={t("roster.units.searchPlaceholder")} onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <button type="button" className="ghost sm" onClick={onClose} aria-label={t("roster.units.close")}>
          ×
        </button>
      </div>
      <div className="datasheet-list" role="listbox" aria-label={t("roster.units.list")}>
        {sheets.length ? (
          sheets.map(({ ds, size, points }) => (
            <button key={ds.id} type="button" role="option" aria-selected={false} onClick={() => onAdd(ds)}>
              <span>
                {ds.name}
                <span className="muted small"> · {ds.role ?? ""}</span>
              </span>
              <span className="muted small">
                {size}
                {points !== undefined ? ` · ${t("roster.units.from", { v: fmtInt(points) })}` : ""}
              </span>
            </button>
          ))
        ) : (
          <div className="empty">{t("roster.units.none")}</div>
        )}
      </div>
    </div>
  );
}
