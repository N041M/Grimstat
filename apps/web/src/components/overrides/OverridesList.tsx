import { useState } from "react";
import type { Override } from "@grimstat/schema";
import type { OverrideRecord } from "../../db";
import { summarisePatch } from "../../lib/overrides";
import { Badge, Empty, Field } from "../ui";
import { t } from "../../i18n";

function patchSummary(patch: Record<string, unknown>): string {
  const s = summarisePatch(patch);
  switch (s.kind) {
    case "effects":
      return t("overrides.patch.effects", { n: s.n });
    case "none":
      return t("overrides.patch.none");
    case "fnp":
      return t("overrides.patch.fnp", { n: s.n });
    case "fields":
      return t("overrides.patch.fields", { keys: s.keys.join(", ") });
  }
}

/** Inline JSON editor for a patch (entities without a dedicated editor, or abilities missing from the snapshot). */
export function RawPatchEditor({ record, onSave, onCancel }: { record: OverrideRecord; onSave: (patch: Record<string, unknown>, note: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(() => JSON.stringify(record.patch, null, 2));
  const [note, setNote] = useState(record.note ?? "");
  const [error, setError] = useState<string | undefined>(undefined);
  const save = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(t("overrides.rawInvalid"));
      onSave(parsed as Record<string, unknown>, note);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <div className="stack diff-box" style={{ marginTop: "0.4rem" }}>
      <Field label={t("overrides.rawPatch")}>
        <textarea rows={6} className="mono" value={text} onChange={(e) => setText(e.target.value)} />
      </Field>
      <Field label={t("overrides.note")}>
        <input type="text" value={note} placeholder={t("overrides.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
      </Field>
      {error ? (
        <span className="small" role="alert" style={{ color: "var(--accent)" }}>
          {error}
        </span>
      ) : null}
      <div className="row">
        <button type="button" className="sm primary" onClick={save}>
          {t("overrides.save")}
        </button>
        <button type="button" className="sm ghost" onClick={onCancel}>
          {t("overrides.cancelEdit")}
        </button>
      </div>
    </div>
  );
}

export function OverridesList({ records, nameOf, inSnapshot, onEdit, onDelete }: { records: OverrideRecord[]; nameOf: (entity: Override["entity"], id: string) => string | undefined; inSnapshot: (entity: Override["entity"], id: string) => boolean; onEdit: (r: OverrideRecord) => void; onDelete: (r: OverrideRecord) => void }) {
  if (!records.length) return <Empty>{t("overrides.listEmpty")}</Empty>;
  return (
    <div className="table-wrap">
      <table className="data overrides-table">
        <thead>
          <tr>
            <th>{t("overrides.col.entity")}</th>
            <th>{t("overrides.col.name")}</th>
            <th>{t("overrides.col.patch")}</th>
            <th>{t("overrides.col.note")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {records.map((r) => {
            const name = nameOf(r.entity, r.id);
            const present = inSnapshot(r.entity, r.id);
            return (
              <tr key={r.key}>
                <td>
                  <Badge>{r.entity}</Badge>
                </td>
                <td className="wrap">
                  {name ?? <span className="mono">{r.id}</span>}
                  {name ? (
                    <>
                      {" "}
                      <span className="mono muted small">{r.id}</span>
                    </>
                  ) : null}
                  {!present ? (
                    <>
                      {" "}
                      <Badge tone="warn">{t("overrides.notInSnapshot")}</Badge>
                    </>
                  ) : null}
                </td>
                <td className="wrap">{patchSummary(r.patch)}</td>
                <td className="wrap muted">{r.note ?? ""}</td>
                <td>
                  <span className="row" style={{ gap: "0.3rem", flexWrap: "nowrap" }}>
                    <button type="button" className="sm" onClick={() => onEdit(r)}>
                      {t("overrides.edit")}
                    </button>
                    <button type="button" className="sm danger" onClick={() => onDelete(r)}>
                      {t("overrides.delete")}
                    </button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
