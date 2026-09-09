import { useMemo, useState } from "react";
import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import type { UnitCost } from "@grimstat/resolver";
import { compositionBounds, distributeModelCount, hasWargear, isCharacterSheet, modelCountOf, toggleWargear, weaponBaseNames, type ModelGroup } from "../../lib/roster";
import { fmtInt } from "../../lib/format";
import { unitDisplayName } from "./UnitsBlock";
import { Field, Switch } from "../ui";
import { t } from "../../i18n";

interface Props {
  unit: RosterUnit;
  roster: Roster;
  snapshot: Snapshot;
  datasheets: Map<string, Datasheet>;
  cost: UnitCost | undefined;
  onChange: (unit: RosterUnit) => void;
  onOpenInCalculator: (side: "attacker" | "defender") => void;
}

interface WargearItem {
  name: string;
  price: number | undefined;
}

function GroupWargear({ group, profileName, items, onChange }: { group: ModelGroup; profileName: string; items: WargearItem[]; onChange: (g: ModelGroup) => void }) {
  const [other, setOther] = useState("");
  const known = new Set(items.map((i) => i.name.toLowerCase()));
  const extras = group.wargear.filter((w) => !known.has(w.toLowerCase()));
  const addOther = () => {
    const v = other.trim();
    if (!v) return;
    if (!hasWargear(group, v)) onChange({ ...group, wargear: [...group.wargear, v] });
    setOther("");
  };
  return (
    <fieldset className="wargear-group">
      <legend>{t("roster.inspector.group", { count: group.count, name: profileName })}</legend>
      <div className="check-list" style={{ maxHeight: "none" }}>
        {items.map((it) => (
          <label key={it.name} className="inline">
            <input type="checkbox" checked={hasWargear(group, it.name)} onChange={(e) => onChange(toggleWargear(group, it.name, e.target.checked))} />
            <span>
              {it.name}
              {it.price ? <span className="muted small"> {t("roster.inspector.priced", { v: fmtInt(it.price) })}</span> : null}
            </span>
          </label>
        ))}
      </div>
      <div className="chips" style={{ marginTop: 6 }}>
        {extras.map((w) => (
          <span key={w} className="chip">
            {w}{" "}
            <button type="button" className="chip-x" aria-label={t("roster.inspector.removeOther", { name: w })} onClick={() => onChange(toggleWargear(group, w, false))}>
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="field-row" style={{ marginTop: 6 }}>
        <Field label={t("roster.inspector.otherWargear")} className="grow">
          <input
            type="text"
            value={other}
            placeholder={t("roster.inspector.otherPlaceholder")}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOther();
              }
            }}
          />
        </Field>
        <button type="button" className="sm" onClick={addOther} disabled={!other.trim()}>
          {t("roster.inspector.addOther")}
        </button>
      </div>
    </fieldset>
  );
}

export function UnitInspector({ unit, roster, snapshot, datasheets, cost, onChange, onOpenInCalculator }: Props) {
  const ds = datasheets.get(unit.datasheetId);
  const isCharacter = ds ? isCharacterSheet(ds) : false;
  const bounds = useMemo(() => (ds ? compositionBounds(ds) : { min: 1, max: undefined }), [ds]);
  const count = modelCountOf(unit);

  const items = useMemo<WargearItem[]>(() => {
    if (!ds) return [];
    const prices = snapshot.data.wargearPrices.filter((w) => w.datasheetId === ds.id);
    const out: WargearItem[] = weaponBaseNames(ds).map((name) => ({ name, price: prices.find((p) => p.item.toLowerCase() === name.toLowerCase())?.points }));
    for (const p of prices) if (!out.some((i) => i.name.toLowerCase() === p.item.toLowerCase())) out.push({ name: p.item, price: p.points });
    return out;
  }, [ds, snapshot]);

  // Attach candidates: units in the roster this character can lead or support (never itself, never an attached unit).
  const hosts = useMemo(() => {
    if (!ds || !isCharacter) return [];
    const can = new Set([...ds.leaderTo, ...ds.supportTo]);
    return roster.units
      .filter((u) => u.id !== unit.id && !u.attachedTo && can.has(u.datasheetId))
      .map((u) => ({ unit: u, role: (ds.leaderTo.includes(u.datasheetId) ? "leader" : "support") as "leader" | "support", name: unitDisplayName(u, datasheets.get(u.datasheetId)) }));
  }, [ds, isCharacter, roster.units, unit.id, datasheets]);

  const enhancements = useMemo(() => {
    const detIds = new Set(roster.detachments.map((d) => d.detachmentId));
    const seen = new Set<string>();
    return snapshot.data.enhancements.filter((e) => detIds.has(e.detachmentId) && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [roster.detachments, snapshot]);

  const setCount = (raw: number) => {
    const floor = Math.max(bounds.min, unit.models.length);
    const n = Math.min(bounds.max ?? Number.POSITIVE_INFINITY, Math.max(floor, Math.floor(raw) || floor));
    if (n !== count) onChange({ ...unit, models: distributeModelCount(unit.models, n) });
  };
  const setGroup = (i: number, g: ModelGroup) => onChange({ ...unit, models: unit.models.map((m, j) => (j === i ? g : m)) });
  const setAttach = (hostId: string) => {
    const { attachedTo: _a, ...rest } = unit;
    const h = hosts.find((x) => x.unit.id === hostId);
    onChange(h ? { ...rest, attachedTo: { unitId: h.unit.id, role: h.role } } : rest);
  };
  const setEnhancement = (id: string) => {
    const { enhancementId: _e, ...rest } = unit;
    onChange(id ? { ...rest, enhancementId: id } : rest);
  };
  const setCustomName = (v: string) => {
    const { customName: _c, ...rest } = unit;
    onChange(v ? { ...rest, customName: v } : rest);
  };
  const setNotes = (v: string) => {
    const { notes: _n, ...rest } = unit;
    onChange(v ? { ...rest, notes: v } : rest);
  };

  const modelsHint = bounds.max !== undefined ? t("roster.inspector.modelsHint", { min: bounds.min, max: bounds.max }) : t("roster.inspector.modelsHintMin", { min: bounds.min });
  const maxReached = bounds.max !== undefined && count >= bounds.max;
  const minReached = count <= Math.max(bounds.min, unit.models.length);

  return (
    <div className="stack inspector" aria-live="polite">
      <div>
        <h3 style={{ marginBottom: 2 }}>{unitDisplayName(unit, ds)}</h3>
        <div className="small muted">
          {ds?.name ?? unit.datasheetId}
          {ds?.role ? ` · ${ds.role}` : ""}
          {cost && cost.copyIndex > 1 ? ` · ${t("roster.inspector.copy", { n: cost.copyIndex })}` : ""}
        </div>
        {cost ? (
          <div className="small muted">
            <strong className="mono">{t("unit.points", { v: fmtInt(cost.total) })}</strong> · {t("roster.inspector.cost", { base: fmtInt(cost.base), wargear: fmtInt(cost.wargear), enhancement: fmtInt(cost.enhancement) })}
          </div>
        ) : null}
        {!ds ? <p className="small" style={{ color: "var(--danger)" }}>{t("roster.inspector.unknownSheet", { id: unit.datasheetId })}</p> : null}
      </div>

      <Field label={t("roster.inspector.customName")}>
        <input type="text" value={unit.customName ?? ""} placeholder={t("roster.inspector.customNamePlaceholder")} onChange={(e) => setCustomName(e.target.value)} />
      </Field>

      <div className="field-row">
        <Field label={t("roster.inspector.models")} hint={modelsHint}>
          <span className="stepper">
            <button type="button" className="sm" onClick={() => setCount(count - 1)} disabled={minReached} aria-label={t("roster.inspector.fewer")}>
              −
            </button>
            <input type="number" min={Math.max(bounds.min, unit.models.length)} max={bounds.max} value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label={t("roster.inspector.models")} />
            <button type="button" className="sm" onClick={() => setCount(count + 1)} disabled={maxReached} aria-label={t("roster.inspector.more")}>
              +
            </button>
          </span>
        </Field>
      </div>

      <div>
        <h4 className="inspector-h">{t("roster.inspector.wargear")}</h4>
        {unit.models.map((g, i) => (
          <GroupWargear key={`${g.modelProfileId}-${i}`} group={g} profileName={ds?.models.find((m) => m.id === g.modelProfileId)?.name ?? ds?.name ?? g.modelProfileId} items={items} onChange={(ng) => setGroup(i, ng)} />
        ))}
      </div>

      {isCharacter ? (
        <>
          <Field label={t("roster.inspector.attach")} hint={hosts.length ? undefined : t("roster.inspector.attachNone")}>
            <select value={unit.attachedTo?.unitId ?? ""} onChange={(e) => setAttach(e.target.value)} disabled={!hosts.length && !unit.attachedTo}>
              <option value="">{t("roster.inspector.notAttached")}</option>
              {unit.attachedTo && !hosts.some((h) => h.unit.id === unit.attachedTo?.unitId) ? <option value={unit.attachedTo.unitId}>{unit.attachedTo.unitId}</option> : null}
              {hosts.map((h) => (
                <option key={h.unit.id} value={h.unit.id}>
                  {h.name} · {t(h.role === "leader" ? "picker.leader" : "picker.support")}
                </option>
              ))}
            </select>
          </Field>
          <Field label={t("roster.inspector.enhancement")} hint={roster.detachments.length ? undefined : t("roster.inspector.enhancementNeedsDetachment")}>
            <select value={unit.enhancementId ?? ""} onChange={(e) => setEnhancement(e.target.value)}>
              <option value="">{t("roster.inspector.noEnhancement")}</option>
              {unit.enhancementId && !enhancements.some((e) => e.id === unit.enhancementId) ? <option value={unit.enhancementId}>{snapshot.data.enhancements.find((e) => e.id === unit.enhancementId)?.name ?? unit.enhancementId}</option> : null}
              {enhancements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({t("roster.inspector.priced", { v: fmtInt(e.cost) })})
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : null}

      {isCharacter || unit.isWarlord ? <Switch checked={unit.isWarlord} onChange={(v) => onChange({ ...unit, isWarlord: v })} label={t("roster.inspector.warlord")} description={t("roster.inspector.warlordDesc")} /> : null}

      <Field label={t("roster.inspector.notes")}>
        <textarea rows={3} value={unit.notes ?? ""} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <div>
        <h4 className="inspector-h">{t("roster.inspector.calculator")}</h4>
        <div className="row">
          <button type="button" className="sm" disabled={!ds} onClick={() => onOpenInCalculator("attacker")}>
            {t("roster.inspector.asAttacker")}
          </button>
          <button type="button" className="sm" disabled={!ds} onClick={() => onOpenInCalculator("defender")}>
            {t("roster.inspector.asDefender")}
          </button>
        </div>
      </div>
    </div>
  );
}
