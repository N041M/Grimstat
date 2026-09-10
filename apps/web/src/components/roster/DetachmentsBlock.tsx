import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { Detachment, Roster, Snapshot } from "@grimstat/schema";
import { detachmentPointsFor } from "../../lib/roster";
import { newId } from "../../lib/ids";
import { Icon, Popover } from "../ui";
import { t } from "../../i18n";

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  onChange: (fn: (r: Roster) => Roster) => void;
  /** The "+ Detachment" picker is controlled by the page so the empty-state guide can open it. */
  pickerOpen: boolean;
  onPickerOpen: (open: boolean) => void;
}

function DetachmentChip({ det, id, disposition, onDisposition, onRemove }: { det: Detachment | undefined; id: string; disposition: string | undefined; onDisposition: (v: string) => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const name = det?.name ?? id;
  return (
    <Popover
      open={open}
      onClose={close}
      label={t("roster.detachments.options", { name })}
      trigger={
        <button type="button" className={`det-chip ${det ? "" : "danger"}`.trim()} aria-expanded={open} aria-label={t("roster.detachments.chipAria", { name, dp: det?.dp ?? 0 })} onClick={() => setOpen((v) => !v)}>
          <span className="det-chip-name">{name}</span>
          <span className="det-chip-dp">{t("roster.detachments.dp", { n: det?.dp ?? 0 })}</span>
          {disposition ? <span className="det-chip-fd">{disposition}</span> : null}
          <Icon name="chevron" className="det-chip-caret" />
        </button>
      }
    >
      <div className="stack det-pop">
        <div className="row between">
          <strong>{name}</strong>
          <span className="row">
            <span className="badge">{t("roster.detachments.dp", { n: det?.dp ?? 0 })}</span>
            {det?.uniqueTag ? <span className="badge">{t("roster.detachments.unique", { tag: det.uniqueTag })}</span> : null}
          </span>
        </div>
        {det?.forceDispositions.length ? (
          <label className="field">
            <span>{t("roster.detachments.disposition")}</span>
            <select value={disposition ?? ""} onChange={(e) => onDisposition(e.target.value)}>
              <option value="">{t("roster.detachments.noDisposition")}</option>
              {det.forceDispositions.map((fd) => (
                <option key={fd} value={fd}>
                  {fd}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="small muted" style={{ margin: 0 }}>
            {t("roster.detachments.noDispositions")}
          </p>
        )}
        <div className="row">
          <button
            type="button"
            className="sm danger"
            onClick={() => {
              close();
              onRemove();
            }}
            aria-label={t("roster.detachments.remove", { name })}
          >
            <Icon name="trash" />
            {t("armies.delete")}
          </button>
        </div>
      </div>
    </Popover>
  );
}

/** Detachments as a chip row under the header, with a compact searchable picker. */
export function DetachmentStrip({ roster, snapshot, onChange, pickerOpen, onPickerOpen }: Props) {
  const [search, setSearch] = useState("");
  const [hl, setHl] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(snapshot.data.detachments.map((d) => [d.id, d] as const)), [snapshot]);
  const available = useMemo(() => snapshot.data.detachments.filter((d) => d.factionId === roster.factionId).sort((a, b) => a.name.localeCompare(b.name)), [snapshot, roster.factionId]);
  const spent = roster.detachments.reduce((s, d) => s + (byId.get(d.detachmentId)?.dp ?? 0), 0);
  const limit = detachmentPointsFor(roster.battleSize);
  const takenTags = useMemo(() => new Set(roster.detachments.map((d) => byId.get(d.detachmentId)?.uniqueTag).filter((x): x is string => !!x)), [roster.detachments, byId]);
  const included = useMemo(() => new Set(roster.detachments.map((d) => d.detachmentId)), [roster.detachments]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return available
      .filter((d) => !q || d.name.toLowerCase().includes(q) || (d.uniqueTag ?? "").toLowerCase().includes(q))
      .map((d) => {
        const reason = included.has(d.id) ? t("roster.detachments.already") : d.uniqueTag && takenTags.has(d.uniqueTag) ? t("roster.detachments.taken", { tag: d.uniqueTag }) : undefined;
        const overDp = !reason && spent + d.dp > limit ? t("roster.detachments.overDp", { limit }) : undefined;
        return { d, reason, overDp };
      });
  }, [available, search, included, takenTags, spent, limit]);

  useEffect(() => {
    if (hl >= rows.length) setHl(Math.max(0, rows.length - 1));
  }, [rows.length, hl]);

  const closePicker = useCallback(() => {
    onPickerOpen(false);
    setSearch("");
    setHl(0);
  }, [onPickerOpen]);

  const add = (d: Detachment) => {
    onChange((r) => ({ ...r, detachments: [...r.detachments, { id: newId("d"), detachmentId: d.id }] }));
    closePicker();
  };
  const remove = (id: string) => onChange((r) => ({ ...r, detachments: r.detachments.filter((d) => d.id !== id) }));
  const setDisposition = (id: string, v: string) =>
    onChange((r) => ({
      ...r,
      detachments: r.detachments.map((d) => {
        if (d.id !== id) return d;
        const { forceDisposition: _fd, ...rest } = d;
        return v ? { ...rest, forceDisposition: v } : rest;
      }),
    }));

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHl((i) => Math.min(rows.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHl((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      const row = rows[hl];
      if (row && !row.reason) {
        e.preventDefault();
        add(row.d);
      }
    }
  };

  return (
    <div className="det-strip" aria-label={t("roster.detachments")}>
      <span className="det-strip-label">{t("roster.detachments")}</span>
      {roster.detachments.length === 0 ? <span className="small muted det-strip-empty">{t("roster.detachments.empty")}</span> : null}
      {roster.detachments.map((d) => (
        <DetachmentChip key={d.id} det={byId.get(d.detachmentId)} id={d.detachmentId} disposition={d.forceDisposition} onDisposition={(v) => setDisposition(d.id, v)} onRemove={() => remove(d.id)} />
      ))}
      {available.length ? (
        <Popover
          open={pickerOpen}
          onClose={closePicker}
          label={t("roster.detachments.pickerTitle")}
          className="det-add"
          trigger={
            <button type="button" className={`sm ${roster.detachments.length ? "ghost" : "primary"}`} aria-expanded={pickerOpen} onClick={() => (pickerOpen ? closePicker() : onPickerOpen(true))}>
              <Icon name="plus" />
              {t("roster.detachments.addChip")}
            </button>
          }
        >
          <div className="det-picker" onKeyDown={onKey}>
            <div className="row between">
              <strong>{t("roster.detachments.pickerTitle")}</strong>
              <span className={`small ${spent > limit ? "danger-text" : "muted"}`}>{t("roster.dpOf", { spent, limit })}</span>
            </div>
            <div className="search-wrap">
              <Icon name="search" />
              <input ref={input} type="search" value={search} placeholder={t("roster.detachments.search")} aria-label={t("roster.detachments.search")} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <ul className="det-options" role="list">
              {rows.length ? (
                rows.map(({ d, reason, overDp }, i) => (
                  <li key={d.id}>
                    <button type="button" className={`det-option ${i === hl ? "hl" : ""}`.trim()} disabled={!!reason} onMouseEnter={() => setHl(i)} onClick={() => add(d)} title={reason}>
                      <span className="det-option-main">
                        <span className="det-option-name">{d.name}</span>
                        <span className="row">
                          <span className="badge">{t("roster.detachments.dp", { n: d.dp })}</span>
                          {d.uniqueTag ? <span className="badge">{t("roster.detachments.unique", { tag: d.uniqueTag })}</span> : null}
                        </span>
                      </span>
                      {d.forceDispositions.length ? <span className="small muted">{t("roster.detachments.dispositions", { list: d.forceDispositions.join(", ") })}</span> : null}
                      {reason ? <span className="small danger-text">{reason}</span> : overDp ? <span className="small warn-text">{overDp}</span> : null}
                    </button>
                  </li>
                ))
              ) : (
                <li className="empty small">{t("roster.detachments.noMatch")}</li>
              )}
            </ul>
            <div className="small muted keys-hint">{t("roster.detachments.keys")}</div>
          </div>
        </Popover>
      ) : (
        <span className="small muted">{t("roster.detachments.none")}</span>
      )}
    </div>
  );
}
