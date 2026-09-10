import { useState } from "react";
import type { EffectRecord } from "@grimstat/schema";
import { CHANNEL_INFO } from "../../lib/gameExtras";
import { OPS, REROLL_POLICIES, SIDES, STAGES, VALUE_KINDS, buildEffect, defaultEffectForm, suggestedStage, suggestedValueKind, type ConditionForm, type EffectForm as EffectFormState, type RerollPolicy, type ValueKind } from "../../lib/overrides";
import { Field } from "../ui";
import { t } from "../../i18n";

const CUSTOM = "__custom__";

function rerollLabel(p: RerollPolicy): string {
  switch (p) {
    case "ones":
      return t("overrides.reroll.ones");
    case "failed":
      return t("overrides.reroll.failed");
    case "non-crit":
      return t("overrides.reroll.non-crit");
    case "one-die":
      return t("overrides.reroll.one-die");
  }
}

function valueKindLabel(k: ValueKind): string {
  switch (k) {
    case "number":
      return t("overrides.valueKind.number");
    case "reroll":
      return t("overrides.valueKind.reroll");
    case "boolean":
      return t("overrides.valueKind.boolean");
    case "string":
      return t("overrides.valueKind.string");
  }
}

function TriSelect({ label, value, onChange }: { label: string; value: "" | "true" | "false"; onChange: (v: "" | "true" | "false") => void }) {
  return (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value === "true" ? "true" : e.target.value === "false" ? "false" : "")}>
        <option value="">{t("overrides.form.any")}</option>
        <option value="true">{t("overrides.form.yes")}</option>
        <option value="false">{t("overrides.form.no")}</option>
      </select>
    </Field>
  );
}

/**
 * One effect record as a form. `initial` prefills (edit mode); submit hands back a validated EffectRecord
 * and resets the form to defaults.
 */
export function EffectForm({ source, initial, onSubmit, onCancel }: { source: string; initial?: EffectFormState; onSubmit: (e: EffectRecord) => void; onCancel?: () => void }) {
  const [form, setForm] = useState<EffectFormState>(() => initial ?? defaultEffectForm());
  const [error, setError] = useState<string | undefined>(undefined);
  const known = CHANNEL_INFO.some((c) => c.channel === form.target);
  const [custom, setCustom] = useState(!known && form.target !== "");

  const patch = (p: Partial<EffectFormState>) => setForm((f) => ({ ...f, ...p }));
  const cond = (p: Partial<ConditionForm>) => setForm((f) => ({ ...f, condition: { ...f.condition, ...p } }));

  const setTarget = (target: string) => {
    if (target === CUSTOM) {
      setCustom(true);
      patch({ target: "" });
      return;
    }
    setCustom(false);
    const stage = suggestedStage(target);
    patch({ target, valueKind: suggestedValueKind(form.op, target), ...(stage ? { stage } : {}) });
  };
  const setOp = (op: EffectFormState["op"]) => patch({ op, valueKind: suggestedValueKind(op, form.target) });

  const submit = () => {
    const r = buildEffect(form, source);
    if (!r.ok) {
      setError(t(r.error));
      return;
    }
    setError(undefined);
    onSubmit(r.effect);
    setForm(defaultEffectForm());
    setCustom(false);
  };

  return (
    <form
      className="stack effect-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="grid-3">
        <Field label={t("overrides.form.stage")}>
          <select value={form.stage} onChange={(e) => patch({ stage: STAGES.find((s) => s === e.target.value) ?? "hit" })}>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("overrides.form.side")}>
          <select value={form.side} onChange={(e) => patch({ side: e.target.value === "defender" ? "defender" : "attacker" })}>
            {SIDES.map((s) => (
              <option key={s} value={s}>
                {s === "attacker" ? t("side.attacker") : t("side.defender")}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("overrides.form.op")}>
          <select value={form.op} onChange={(e) => setOp(OPS.find((o) => o === e.target.value) ?? "add")}>
            {OPS.map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("overrides.form.target")}>
          <select value={custom ? CUSTOM : form.target} onChange={(e) => setTarget(e.target.value)}>
            {CHANNEL_INFO.map((c) => (
              <option key={c.channel} value={c.channel}>
                {c.label} ({c.channel})
              </option>
            ))}
            <option value={CUSTOM}>{t("overrides.form.targetCustom")}</option>
          </select>
        </Field>
        {custom ? (
          <Field label={t("overrides.form.targetFree")}>
            <input type="text" value={form.target} className="mono" onChange={(e) => patch({ target: e.target.value })} />
          </Field>
        ) : null}
        <Field label={t("overrides.form.valueKind")}>
          <select value={form.valueKind} onChange={(e) => patch({ valueKind: VALUE_KINDS.find((k) => k === e.target.value) ?? "number" })}>
            {VALUE_KINDS.map((k) => (
              <option key={k} value={k}>
                {valueKindLabel(k)}
              </option>
            ))}
          </select>
        </Field>
        {form.valueKind === "number" ? (
          <Field label={t("overrides.form.value")}>
            <input type="number" step="any" value={form.value} onChange={(e) => patch({ value: e.target.value })} />
          </Field>
        ) : form.valueKind === "string" ? (
          <Field label={t("overrides.form.value")}>
            <input type="text" value={form.value} placeholder={t("overrides.form.valueDice")} onChange={(e) => patch({ value: e.target.value })} />
          </Field>
        ) : form.valueKind === "reroll" ? (
          <Field label={t("overrides.form.reroll")}>
            <select value={form.reroll} onChange={(e) => patch({ reroll: REROLL_POLICIES.find((p) => p === e.target.value) ?? "ones" })}>
              {REROLL_POLICIES.map((p) => (
                <option key={p} value={p}>
                  {rerollLabel(p)}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <label className="inline" style={{ alignSelf: "end", paddingBottom: "0.4rem" }}>
            <input type="checkbox" checked={form.bool} onChange={(e) => patch({ bool: e.target.checked })} />
            <span>{t("overrides.form.bool")}</span>
          </label>
        )}
      </div>
      <details className="cond-details">
        <summary>{t("overrides.form.condition")}</summary>
        <div className="grid-3" style={{ marginTop: "0.5rem" }}>
          <Field label={t("overrides.form.cond.targetKeyword")}>
            <input type="text" value={form.condition.targetKeyword} onChange={(e) => cond({ targetKeyword: e.target.value })} />
          </Field>
          <Field label={t("overrides.form.cond.attackerKeyword")}>
            <input type="text" value={form.condition.attackerKeyword} onChange={(e) => cond({ attackerKeyword: e.target.value })} />
          </Field>
          <Field label={t("overrides.form.cond.weaponKind")}>
            <select value={form.condition.weaponKind} onChange={(e) => cond({ weaponKind: e.target.value === "ranged" ? "ranged" : e.target.value === "melee" ? "melee" : "" })}>
              <option value="">{t("overrides.form.any")}</option>
              <option value="ranged">{t("weapon.ranged")}</option>
              <option value="melee">{t("weapon.melee")}</option>
            </select>
          </Field>
          <Field label={t("overrides.form.cond.weaponKeyword")}>
            <input type="text" value={form.condition.weaponKeyword} onChange={(e) => cond({ weaponKeyword: e.target.value })} />
          </Field>
          <Field label={t("overrides.form.cond.rangeBand")}>
            <select value={form.condition.rangeBand} onChange={(e) => cond({ rangeBand: e.target.value === "half" ? "half" : e.target.value === "full" ? "full" : "" })}>
              <option value="">{t("overrides.form.any")}</option>
              <option value="half">{t("ctx.rangeBand.half")}</option>
              <option value="full">{t("ctx.rangeBand.full")}</option>
            </select>
          </Field>
          <Field label={t("overrides.form.cond.phase")}>
            <select value={form.condition.phase} onChange={(e) => cond({ phase: e.target.value === "shooting" ? "shooting" : e.target.value === "fight" ? "fight" : "" })}>
              <option value="">{t("overrides.form.any")}</option>
              <option value="shooting">{t("ctx.phase.shooting")}</option>
              <option value="fight">{t("ctx.phase.fight")}</option>
            </select>
          </Field>
          <TriSelect label={t("overrides.form.cond.charged")} value={form.condition.charged} onChange={(charged) => cond({ charged })} />
          <TriSelect label={t("overrides.form.cond.stationary")} value={form.condition.stationary} onChange={(stationary) => cond({ stationary })} />
          <TriSelect label={t("overrides.form.cond.inCover")} value={form.condition.inCover} onChange={(inCover) => cond({ inCover })} />
        </div>
      </details>
      <div className="row">
        <span className="small muted">
          {t("overrides.form.source")}: <strong>{source}</strong>
        </span>
        {error ? (
          <span className="small" role="alert" style={{ color: "var(--accent)" }}>
            {error}
          </span>
        ) : null}
      </div>
      <div className="row">
        <button type="submit" className="sm primary">
          {initial ? t("overrides.updateEffect") : t("overrides.addEffect")}
        </button>
        {onCancel ? (
          <button type="button" className="sm ghost" onClick={onCancel}>
            {t("overrides.cancelEdit")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
