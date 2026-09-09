import { useMemo, useState } from "react";
import type { Roster, Snapshot } from "@grimstat/schema";
import { detachmentPointsFor } from "../../lib/roster";
import { newId } from "../../lib/ids";
import { Field } from "../ui";
import { t } from "../../i18n";

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  onChange: (fn: (r: Roster) => Roster) => void;
}

export function DetachmentsBlock({ roster, snapshot, onChange }: Props) {
  const [pick, setPick] = useState("");
  const byId = useMemo(() => new Map(snapshot.data.detachments.map((d) => [d.id, d] as const)), [snapshot]);
  const available = useMemo(() => snapshot.data.detachments.filter((d) => d.factionId === roster.factionId).sort((a, b) => a.name.localeCompare(b.name)), [snapshot, roster.factionId]);
  const spent = roster.detachments.reduce((s, d) => s + (byId.get(d.detachmentId)?.dp ?? 0), 0);
  const limit = detachmentPointsFor(roster.battleSize);

  const add = () => {
    if (!pick) return;
    const detachmentId = pick;
    onChange((r) => ({ ...r, detachments: [...r.detachments, { id: newId("d"), detachmentId }] }));
    setPick("");
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

  return (
    <section className="panel" aria-labelledby="detachments-h">
      <div className="panel-head">
        <h2 id="detachments-h">{t("roster.detachments")}</h2>
        <span className={`badge ${spent > limit ? "danger" : "ok"}`}>{t("roster.dpOf", { spent, limit })}</span>
      </div>
      {roster.detachments.length === 0 ? <p className="muted small">{t("roster.detachments.empty")}</p> : null}
      <ul className="det-list" aria-label={t("roster.detachments")}>
        {roster.detachments.map((d) => {
          const det = byId.get(d.detachmentId);
          const name = det?.name ?? d.detachmentId;
          return (
            <li key={d.id} className="det-row">
              <div className="grow">
                <div className="row">
                  <strong>{name}</strong>
                  <span className="badge">{t("roster.detachments.dp", { n: det?.dp ?? 0 })}</span>
                  {det?.uniqueTag ? <span className="badge">{t("roster.detachments.unique", { tag: det.uniqueTag })}</span> : null}
                </div>
                {det?.forceDispositions.length ? (
                  <label className="field" style={{ marginTop: 6 }}>
                    <span>{t("roster.detachments.disposition")}</span>
                    <select value={d.forceDisposition ?? ""} onChange={(e) => setDisposition(d.id, e.target.value)}>
                      <option value="">{t("roster.detachments.noDisposition")}</option>
                      {det.forceDispositions.map((fd) => (
                        <option key={fd} value={fd}>
                          {fd}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
              </div>
              <button type="button" className="ghost sm" onClick={() => remove(d.id)} aria-label={t("roster.detachments.remove", { name })}>
                ×
              </button>
            </li>
          );
        })}
      </ul>
      {available.length ? (
        <div className="field-row" style={{ marginTop: 8 }}>
          <Field label={t("roster.detachments.add")} className="grow">
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{t("roster.detachments.pick")}</option>
              {available.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {t("roster.detachments.dp", { n: d.dp })}
                  {d.uniqueTag ? ` · ${d.uniqueTag}` : ""}
                </option>
              ))}
            </select>
          </Field>
          <button type="button" className="sm" disabled={!pick} onClick={add}>
            {t("roster.detachments.add")}
          </button>
        </div>
      ) : (
        <p className="muted small">{t("roster.detachments.none")}</p>
      )}
    </section>
  );
}
