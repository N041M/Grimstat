import type { ScenarioContext } from "@grimstat/schema";
import { Field, num } from "./ui";
import { t } from "../i18n";

export function ContextControls({ context, onChange }: { context: ScenarioContext; onChange: (patch: Partial<ScenarioContext>) => void }) {
  const set = <K extends keyof ScenarioContext>(k: K, v: ScenarioContext[K]) => onChange({ [k]: v } as Partial<ScenarioContext>);
  return (
    <div className="stack">
      <div className="grid-3">
        <Field label={t("ctx.rangeBand")}>
          <select value={context.rangeBand} onChange={(e) => set("rangeBand", e.target.value as ScenarioContext["rangeBand"])}>
            <option value="full">{t("ctx.rangeBand.full")}</option>
            <option value="half">{t("ctx.rangeBand.half")}</option>
          </select>
        </Field>
        <Field label={t("ctx.phase")}>
          <select value={context.phase} onChange={(e) => set("phase", e.target.value as ScenarioContext["phase"])}>
            <option value="shooting">{t("ctx.phase.shooting")}</option>
            <option value="fight">{t("ctx.phase.fight")}</option>
          </select>
        </Field>
        <Field label={t("ctx.allocation")}>
          <select value={context.allocationPolicy} onChange={(e) => set("allocationPolicy", e.target.value as ScenarioContext["allocationPolicy"])}>
            <option value="protect-character">{t("ctx.allocation.protect")}</option>
            <option value="in-order">{t("ctx.allocation.inOrder")}</option>
          </select>
        </Field>
        <Field label={t("ctx.lethal")}>
          <select value={context.lethalChoice} onChange={(e) => set("lethalChoice", e.target.value as ScenarioContext["lethalChoice"])}>
            <option value="auto">{t("ctx.lethal.auto")}</option>
            <option value="always">{t("ctx.lethal.always")}</option>
            <option value="never">{t("ctx.lethal.never")}</option>
          </select>
        </Field>
        <Field label={t("ctx.weaponOrder")}>
          <select value={context.weaponOrder} onChange={(e) => set("weaponOrder", e.target.value as ScenarioContext["weaponOrder"])}>
            <option value="heuristic">{t("ctx.weaponOrder.heuristic")}</option>
            <option value="listed">{t("ctx.weaponOrder.listed")}</option>
          </select>
        </Field>
        <Field label={t("ctx.backend")}>
          <select value={context.backend} onChange={(e) => set("backend", e.target.value as ScenarioContext["backend"])}>
            <option value="auto">{t("ctx.backend.auto")}</option>
            <option value="exact">{t("ctx.backend.exact")}</option>
            <option value="mc">{t("ctx.backend.mc")}</option>
          </select>
        </Field>
        <Field label={t("ctx.mcIterations")}>
          <input type="number" min={1000} step={1000} value={context.mcIterations} onChange={(e) => set("mcIterations", Math.max(1000, Math.floor(num(e.target.value, context.mcIterations))))} />
        </Field>
      </div>
      <div className="row" style={{ gap: "1rem" }}>
        <label className="inline">
          <input type="checkbox" checked={context.charged} onChange={(e) => set("charged", e.target.checked)} />
          <span>{t("ctx.charged")}</span>
        </label>
        <label className="inline">
          <input type="checkbox" checked={context.stationary} onChange={(e) => set("stationary", e.target.checked)} />
          <span>{t("ctx.stationary")}</span>
        </label>
        <label className="inline">
          <input type="checkbox" checked={context.inCover} onChange={(e) => set("inCover", e.target.checked)} />
          <span>{t("ctx.inCover")}</span>
        </label>
        <label className="inline">
          <input type="checkbox" checked={context.snapShooting} onChange={(e) => set("snapShooting", e.target.checked)} />
          <span>{t("ctx.snapShooting")}</span>
        </label>
      </div>
    </div>
  );
}
