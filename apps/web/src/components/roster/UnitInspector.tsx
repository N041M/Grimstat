import { useEffect, useMemo, useState } from "react";
import type { Datasheet, Diagnostic, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { headOf, isSplit, type UnitCost } from "@grimstat/resolver";
import { groupBounds, hasWargear, isCharacterSheet, mergeGroup, modelCountOf, printedCopies, splitGroup, toggleWargear, unitDisplayName, wargearChoices, type ModelGroup } from "../../lib/roster";
import { canEmbark, loadsByTransport, transportCandidates } from "../../lib/transport";
import { fmtInt } from "../../lib/format";
import { DiagnosticItem } from "./DiagnosticItem";
import { UnitDatasheet } from "./UnitDatasheet";
import { Field, Icon, Switch } from "../ui";
import { t, tn } from "../../i18n";
import { useOwnedModels } from "../../hooks/useOwnedModels";

interface Props {
  unit: RosterUnit;
  roster: Roster;
  snapshot: Snapshot;
  datasheets: Map<string, Datasheet>;
  cost: UnitCost | undefined;
  /** Diagnostics whose path points at this unit. */
  issues: Diagnostic[];
  onChange: (unit: RosterUnit) => void;
  onOpenInCalculator: (side: "attacker" | "defender") => void;
  onDuplicate: () => void;
  onRemove: () => void;
  onClose: () => void;
}

interface WargearItem {
  name: string;
  price: number | undefined;
  /** How many of it the datasheet gives one model, where that is more than one. */
  copies: number;
}

interface GroupEditorProps {
  group: ModelGroup;
  profileName: string;
  bounds: { min: number; max: number | undefined };
  items: WargearItem[];
  onChange: (g: ModelGroup) => void;
  /** Take some of the models into a group of their own, to give them other wargear. */
  onSplit: (count: number) => void;
  /** Whether an earlier group holds the same profile, so this one can go back into it. */
  canMerge: boolean;
  onMerge: () => void;
}

function GroupEditor({ group, profileName, bounds, items, onChange, onSplit, canMerge, onMerge }: GroupEditorProps) {
  const [other, setOther] = useState("");
  const [splitCount, setSplitCount] = useState(1);
  const splitMax = group.count - 1;
  const canSplit = splitMax >= 1;
  const known = new Set(items.map((i) => i.name.toLowerCase()));
  const extras = group.wargear.filter((w) => !known.has(w.toLowerCase()));
  /*
   * The count field holds what is typed and commits it when the box is left or Enter is pressed.
   *
   * Clamping each keystroke against the unit's smallest legal size rejected the first digit of any
   * larger number, and a rejected keystroke changed nothing, so React re-rendered nothing and the
   * box went on showing a figure the unit did not have. Selecting the 5 of a five-model squad and
   * typing 1 left the field reading 1 beside five models.
   */
  const [text, setText] = useState(String(group.count));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(group.count));
  }, [group.count, editing]);
  const setCount = (raw: number) => {
    const n = Math.min(bounds.max ?? Number.POSITIVE_INFINITY, Math.max(bounds.min, Math.floor(raw) || bounds.min));
    setText(String(n));
    if (n !== group.count) onChange({ ...group, count: n });
  };
  const commitCount = () => {
    const n = Number(text);
    setCount(text.trim() === "" || !Number.isFinite(n) ? group.count : n);
  };
  const addOther = () => {
    const v = other.trim();
    if (!v) return;
    if (!hasWargear(group, v)) onChange({ ...group, wargear: [...group.wargear, v] });
    setOther("");
  };
  const fixed = bounds.max !== undefined && bounds.max === bounds.min;
  const hint = bounds.max !== undefined ? t("roster.inspector.modelsHint", { min: bounds.min, max: bounds.max }) : t("roster.inspector.modelsHintMin", { min: bounds.min });
  return (
    <fieldset className="wargear-group">
      <legend className="sr-only">{t("roster.inspector.group", { count: group.count, name: profileName })}</legend>
      <div className="group-head">
        <span className="group-name">
          <strong>{profileName}</strong>
          <span className="small muted"> {hint}</span>
        </span>
        <span className="stepper" aria-label={t("roster.inspector.count", { name: profileName })}>
          <button type="button" className="sm" onClick={() => setCount(group.count - 1)} disabled={fixed || group.count <= bounds.min} aria-label={t("roster.inspector.fewer")}>
            −
          </button>
          <input
            type="number"
            min={bounds.min}
            max={bounds.max}
            value={text}
            readOnly={fixed}
            aria-label={t("roster.inspector.count", { name: profileName })}
            onFocus={() => setEditing(true)}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => {
              commitCount();
              setEditing(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitCount();
            }}
          />
          <button type="button" className="sm" onClick={() => setCount(group.count + 1)} disabled={fixed || (bounds.max !== undefined && group.count >= bounds.max)} aria-label={t("roster.inspector.more")}>
            +
          </button>
        </span>
      </div>
      {canSplit || canMerge ? (
        <div className="group-split">
          {canSplit ? (
            <>
              <label className="group-split-count">
                <span className="sr-only">{t("roster.inspector.splitCount")}</span>
                <input type="number" min={1} max={splitMax} value={Math.min(splitCount, splitMax)} onChange={(e) => setSplitCount(Math.max(1, Math.min(splitMax, Math.floor(Number(e.target.value)) || 1)))} />
              </label>
              <button type="button" className="sm" onClick={() => onSplit(Math.min(splitCount, splitMax))}>
                {t("roster.inspector.split")}
              </button>
            </>
          ) : null}
          {canMerge ? (
            <button type="button" className="sm ghost" onClick={onMerge}>
              {t("roster.inspector.merge")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="check-list wargear-list">
        {items.map((it) => (
          <label key={it.name} className="inline">
            <input type="checkbox" checked={hasWargear(group, it.name)} onChange={(e) => onChange(toggleWargear(group, it.name, e.target.checked, it.copies))} />
            <span className="grow">
              {it.name}
              {it.copies > 1 ? <span className="muted small"> {t("roster.inspector.copies", { n: it.copies })}</span> : null}
            </span>
            {it.price ? <span className="muted small tabular">{t("roster.inspector.priced", { v: fmtInt(it.price) })}</span> : null}
          </label>
        ))}
      </div>
      <div className="other-wargear">
        {extras.length ? (
          <div className="chips">
            {extras.map((w) => (
              <span key={w} className="chip">
                {w}{" "}
                <button type="button" className="chip-x" aria-label={t("roster.inspector.removeOther", { name: w })} onClick={() => onChange(toggleWargear(group, w, false))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="other-row">
          <input
            type="text"
            value={other}
            placeholder={t("roster.inspector.otherPlaceholder")}
            aria-label={t("roster.inspector.otherWargear")}
            onChange={(e) => setOther(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addOther();
              }
            }}
          />
          <button type="button" className="sm" onClick={addOther} disabled={!other.trim()}>
            {t("roster.inspector.addOther")}
          </button>
        </div>
      </div>
    </fieldset>
  );
}

/** Focused side panel for one unit: sticky title + cost, sections, footer actions. */
export function UnitInspector({ unit, roster, snapshot, datasheets, cost, issues, onChange, onOpenInCalculator, onDuplicate, onRemove, onClose }: Props) {
  const ds = datasheets.get(unit.datasheetId);
  const owned = useOwnedModels().get(unit.datasheetId) ?? 0;
  const isCharacter = ds ? isCharacterSheet(ds) : false;

  const items = useMemo<WargearItem[]>(() => {
    if (!ds) return [];
    // A priced item with an Enhancement's name is that Enhancement, which the Enhancement field
    // offers when its detachment is in the army. Listed here it read as wargear any unit could take.
    const enhancementNames = new Set(snapshot.data.enhancements.map((e) => e.name.toLowerCase().replace(/\s*\((?:upgrade|aura)\)$/, "")));
    const isEnhancement = (item: string) => enhancementNames.has(item.toLowerCase().replace(/\s*\((?:upgrade|aura)\)$/, ""));
    const prices = snapshot.data.wargearPrices.filter((w) => w.datasheetId === ds.id && !isEnhancement(w.item));
    const out: WargearItem[] = wargearChoices(ds).map((name) => ({ name, price: prices.find((p) => p.item.toLowerCase() === name.toLowerCase())?.points, copies: printedCopies(ds, name) }));
    for (const p of prices) if (!out.some((i) => i.name.toLowerCase() === p.item.toLowerCase())) out.push({ name: p.item, price: p.points, copies: 1 });
    return out;
  }, [ds, snapshot]);

  // Attach candidates: units this character can lead or support. Excluded are the character itself, any unit
  // that is already attached, and any host that already has another character in the same role (one Leader / one Support per unit).
  const hosts = useMemo(() => {
    if (!ds || !isCharacter) return [];
    const can = new Set([...ds.leaderTo, ...ds.supportTo]);
    const taken = new Set(roster.units.filter((u) => u.id !== unit.id && u.attachedTo).map((u) => `${u.attachedTo!.unitId}:${u.attachedTo!.role}`));
    return roster.units
      .filter((u) => u.id !== unit.id && !u.attachedTo && can.has(u.datasheetId))
      .map((u) => ({ unit: u, role: (ds.leaderTo.includes(u.datasheetId) ? "leader" : "support") as "leader" | "support", name: unitDisplayName(u, datasheets.get(u.datasheetId)) }))
      .filter((h) => !taken.has(`${h.unit.id}:${h.role}`));
  }, [ds, isCharacter, roster.units, unit.id, datasheets]);
  /** Transports in this army, and whether this unit is the sort of thing that can ride in one. */
  const rides = useMemo(() => transportCandidates(unit, roster, datasheets).map((u) => ({ unit: u, name: unitDisplayName(u, datasheets.get(u.datasheetId)) })), [unit, roster, datasheets]);
  const embarkable = canEmbark(unit, datasheets);
  /** Units riding in this one, when it is the transport. */
  const carrying = useMemo(() => loadsByTransport(roster).get(unit.id) ?? [], [roster, unit.id]);
  /** The capacity line the datasheet prints, shown as written rather than interpreted. */
  const capacityText = useMemo(() => {
    const ride = unit.embarkedIn ? roster.units.find((u) => u.id === unit.embarkedIn) : undefined;
    return ride ? datasheets.get(ride.datasheetId)?.transportCapacity?.trim() : undefined;
  }, [unit.embarkedIn, roster.units, datasheets]);

  const nameOf = (id: string) => datasheets.get(id)?.name ?? id;
  const canLead = ds?.leaderTo.map(nameOf) ?? [];
  const canSupport = ds?.supportTo.map(nameOf) ?? [];

  const enhancements = useMemo(() => {
    const detIds = new Set(roster.detachments.map((d) => d.detachmentId));
    const seen = new Set<string>();
    return snapshot.data.enhancements.filter((e) => detIds.has(e.detachmentId) && !seen.has(e.id) && seen.add(e.id)).sort((a, b) => a.name.localeCompare(b.name));
  }, [roster.detachments, snapshot]);

  const setGroup = (i: number, g: ModelGroup) => onChange({ ...unit, models: unit.models.map((m, j) => (j === i ? g : m)) });
  const split = (i: number, count: number) => onChange({ ...unit, models: splitGroup(unit.models, i, count) });
  const merge = (i: number) => onChange({ ...unit, models: mergeGroup(unit.models, i) });
  const canMerge = (i: number) => unit.models.slice(0, i).some((g) => g.modelProfileId === unit.models[i]?.modelProfileId);
  const setAttach = (hostId: string) => {
    const { attachedTo: _a, ...rest } = unit;
    const h = hosts.find((x) => x.unit.id === hostId);
    onChange(h ? { ...rest, attachedTo: { unitId: h.unit.id, role: h.role } } : rest);
  };
  const setEmbark = (transportId: string) => {
    const { embarkedIn: _t, ...rest } = unit;
    onChange(transportId ? { ...rest, embarkedIn: transportId } : rest);
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

  return (
    <div className="inspector">
      <div className="insp-head">
        <div className="insp-title-row">
          <input type="text" className="insp-name" value={unit.customName ?? ""} placeholder={ds?.name ?? unit.datasheetId} aria-label={t("roster.inspector.name")} onChange={(e) => setCustomName(e.target.value)} />
          <button type="button" className="ghost sm icon-btn" onClick={onClose} aria-label={t("roster.inspector.close")}>
            <Icon name="close" />
          </button>
        </div>
        <div className="small muted insp-sheet">
          {ds?.name ?? unit.datasheetId}
          {ds?.role ? ` · ${ds.role}` : ""}
          {` · ${tn(modelCountOf(unit), "roster.units.model", "roster.units.models", { n: modelCountOf(unit) })}`}
          {/* What the shelf holds of this datasheet, so a list can be read against the models that
              exist without leaving the page it is being written on. */}
          {owned > 0 ? <span className={owned < modelCountOf(unit) ? "insp-owned short" : "insp-owned"}>{` · ${t("roster.inspector.owned", { n: owned })}`}</span> : null}
          {cost && cost.copyIndex > 1 ? ` · ${t("roster.inspector.copy", { n: cost.copyIndex })}` : ""}
        </div>
        {isSplit(roster, unit) ? <p className="small muted insp-note">{unit.halfOf ? `${t("roster.badge.halfOf", { name: unitDisplayName(headOf(roster, unit), datasheets.get(headOf(roster, unit).datasheetId)) })}. ` : ""}{t("roster.inspector.splitNote")}</p> : null}
        {cost ? (
          <div className="insp-cost">
            <strong className="tabular">{t("unit.points", { v: fmtInt(cost.total) })}</strong>
            <span className="small muted tabular"> {t("roster.inspector.costLine", { base: fmtInt(cost.base), wargear: fmtInt(cost.wargear), enhancement: fmtInt(cost.enhancement) })}</span>
          </div>
        ) : null}
        {!ds ? <p className="small danger-text">{t("roster.inspector.unknownSheet", { id: unit.datasheetId })}</p> : null}
      </div>

      <div className="insp-body">
        {/* The datasheet the unit was built from, so a list can be read without leaving the page it
            is being written on. Everything under it edits this unit; this part only reports. */}
        {ds ? (
          <section className="insp-section">
            <h4 className="inspector-h">{t("roster.inspector.datasheet")}</h4>
            <UnitDatasheet ds={ds} snapshot={snapshot} />
          </section>
        ) : null}

        <section className="insp-section">
          <h4 className="inspector-h">{t("roster.inspector.modelsWargear")}</h4>
          {unit.models.map((g, i) => (
            <GroupEditor key={`${g.modelProfileId}-${i}`} group={g} profileName={ds?.models.find((m) => m.id === g.modelProfileId)?.name ?? ds?.name ?? g.modelProfileId} bounds={isSplit(roster, unit) ? { min: g.count, max: g.count } : groupBounds(ds, unit.models, i)} items={items} onChange={(ng) => setGroup(i, ng)} onSplit={(n) => split(i, n)} canMerge={canMerge(i)} onMerge={() => merge(i)} />
          ))}
          <p className="small muted insp-note">{t("roster.inspector.splitHint")}</p>
        </section>

        {isCharacter ? (
          <section className="insp-section">
            <h4 className="inspector-h">{t("roster.inspector.leaderSupport")}</h4>
            {hosts.length || unit.attachedTo ? (
              <select value={unit.attachedTo?.unitId ?? ""} aria-label={t("roster.inspector.attach")} onChange={(e) => setAttach(e.target.value)}>
                <option value="">{t("roster.inspector.notAttached")}</option>
                {unit.attachedTo && !hosts.some((h) => h.unit.id === unit.attachedTo?.unitId) ? <option value={unit.attachedTo.unitId}>{unit.attachedTo.unitId}</option> : null}
                {hosts.map((h) => (
                  <option key={h.unit.id} value={h.unit.id}>
                    {h.name} · {t(h.role === "leader" ? "picker.leader" : "picker.support")}
                  </option>
                ))}
              </select>
            ) : (
              <p className="small muted insp-note">{canLead.length || canSupport.length ? t("roster.inspector.attachNone") : t("roster.inspector.cannotAttach")}</p>
            )}
            {canLead.length ? <p className="small muted insp-note">{t("roster.inspector.canLead", { list: canLead.join(", ") })}</p> : null}
            {canSupport.length ? <p className="small muted insp-note">{t("roster.inspector.canSupport", { list: canSupport.join(", ") })}</p> : null}
            {!hosts.length && !unit.attachedTo && (canLead.length || canSupport.length) ? <p className="small muted insp-note">{t("roster.inspector.attachHint")}</p> : null}
          </section>
        ) : null}

        {/*
          Riding in a transport. Offered to anything that is not itself a transport and is not
          attached to another unit — an attached character travels with its host, so its own
          embarkation would be ignored. Whether it actually fits is the rules plugin's answer, and
          it gives it in the army checks against the list as built.
        */}
        {embarkable && (rides.length || unit.embarkedIn) ? (
          <section className="insp-section">
            <h4 className="inspector-h">{t("roster.inspector.transport")}</h4>
            <select value={unit.embarkedIn ?? ""} aria-label={t("roster.inspector.embark")} onChange={(e) => setEmbark(e.target.value)}>
              <option value="">{t("roster.inspector.notEmbarked")}</option>
              {unit.embarkedIn && !rides.some((r) => r.unit.id === unit.embarkedIn) ? <option value={unit.embarkedIn}>{unit.embarkedIn}</option> : null}
              {rides.map((r) => (
                <option key={r.unit.id} value={r.unit.id}>
                  {r.name}
                </option>
              ))}
            </select>
            {capacityText ? <p className="small muted insp-note">{capacityText}</p> : null}
          </section>
        ) : null}

        {carrying.length ? (
          <section className="insp-section">
            <h4 className="inspector-h">{t("roster.inspector.carrying")}</h4>
            <ul className="insp-carrying">
              {carrying.map((c) => (
                <li key={c.id}>{unitDisplayName(c, datasheets.get(c.datasheetId))}</li>
              ))}
            </ul>
            <p className="small muted insp-note">{t("roster.inspector.carryingNote")}</p>
          </section>
        ) : null}

        {isCharacter ? (
          <section className="insp-section">
            <h4 className="inspector-h">{t("roster.inspector.enhancement")}</h4>
            <select value={unit.enhancementId ?? ""} aria-label={t("roster.inspector.enhancement")} onChange={(e) => setEnhancement(e.target.value)} disabled={!enhancements.length && !unit.enhancementId}>
              <option value="">{t("roster.inspector.noEnhancement")}</option>
              {unit.enhancementId && !enhancements.some((e) => e.id === unit.enhancementId) ? <option value={unit.enhancementId}>{snapshot.data.enhancements.find((e) => e.id === unit.enhancementId)?.name ?? unit.enhancementId}</option> : null}
              {enhancements.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name} ({t("roster.inspector.priced", { v: fmtInt(e.cost) })})
                </option>
              ))}
            </select>
            {!roster.detachments.length ? <p className="small muted insp-note">{t("roster.inspector.enhancementNeedsDetachment")}</p> : null}
          </section>
        ) : null}

        {isCharacter || unit.isWarlord ? (
          <section className="insp-section">
            <Switch checked={unit.isWarlord} onChange={(v) => onChange({ ...unit, isWarlord: v })} label={t("roster.inspector.warlord")} description={t("roster.inspector.warlordDesc")} />
          </section>
        ) : null}

        <section className="insp-section">
          <Field label={t("roster.inspector.notes")}>
            <textarea rows={2} value={unit.notes ?? ""} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </section>

        <section className="insp-section">
          <h4 className="inspector-h">{t("roster.inspector.issues")}</h4>
          {issues.length ? (
            // Every issue here already points at this unit (the page filters by its index), so a
            // "show the unit" button would only re-select it; the rows stay static on purpose.
            <ul className="diag-list">
              {issues.map((d, i) => (
                <DiagnosticItem key={`${d.code}-${i}`} d={d} />
              ))}
            </ul>
          ) : (
            <p className="small ok-text insp-note">
              <Icon name="check" /> {t("roster.inspector.noIssues")}
            </p>
          )}
        </section>
      </div>

      <div className="insp-foot">
        <button type="button" className="sm" disabled={!ds} onClick={() => onOpenInCalculator("attacker")} title={t("roster.units.openAttacker")}>
          <Icon name="calc" />
          {t("roster.inspector.asAttackerShort")}
        </button>
        <button type="button" className="sm" disabled={!ds} onClick={() => onOpenInCalculator("defender")} title={t("roster.units.openDefender")}>
          <Icon name="calc" />
          {t("roster.inspector.asDefenderShort")}
        </button>
        <span className="grow" />
        <button type="button" className="sm" onClick={onDuplicate}>
          <Icon name="copy" />
          {t("armies.duplicate")}
        </button>
        <button type="button" className="sm danger" onClick={onRemove}>
          <Icon name="trash" />
          {t("roster.inspector.removeUnit")}
        </button>
      </div>
    </div>
  );
}
