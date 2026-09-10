import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import type { EffectRecord, Override } from "@grimstat/schema";
import { abilityEffects } from "@grimstat/game-40k-11e";
import { db, listOverrides, type OverrideRecord } from "../db";
import { useApp } from "../state/AppContext";
import { hrefFor, useRouteInfo } from "../router";
import { download } from "../lib/download";
import { nowIso } from "../lib/ids";
import { abilityOverride, describeEffect, effectToForm, fnpOverride, mergeOverrides, noEffectOverride, overrideKey, parseOverridePack, toPack, toRecord, type EffectForm as EffectFormState } from "../lib/overrides";
import { AbilitySearch, useAbilitySearch, tierLabel, type AbilityHit } from "../components/overrides/AbilitySearch";
import { EffectForm } from "../components/overrides/EffectForm";
import { OverridesList, RawPatchEditor } from "../components/overrides/OverridesList";
import { Badge, Empty, Field } from "../components/ui";
import { PageHeader } from "../components/shell";
import { t } from "../i18n";

export function OverridesPill({ compact }: { compact?: boolean }) {
  const { overrides, overrideStatus } = useApp();
  if (!overrides.length) return compact ? null : <Badge>{t("overrides.nonePill")}</Badge>;
  return (
    <span className="row" style={{ gap: "0.3rem" }}>
      <Badge tone="accent">{t("overrides.appliedPill", { n: overrideStatus.applied })}</Badge>
      {overrideStatus.missing ? <Badge tone="warn">{t("overrides.missingPill", { n: overrideStatus.missing })}</Badge> : null}
    </span>
  );
}

interface EditorState {
  abilityId: string;
  abilityName: string;
  effects: EffectRecord[];
  note: string;
  /** Index of the effect being edited in place. */
  editing: number | undefined;
}

export function OverridesPage() {
  const { rawSnapshot, snapshot, overrides, refreshOverrides, notify } = useApp();
  const { query: routeQuery } = useRouteInfo();
  const [query, setQuery] = useState(() => routeQuery.get("q") ?? "");
  const [editor, setEditor] = useState<EditorState | undefined>(undefined);
  const [rawEdit, setRawEdit] = useState<OverrideRecord | undefined>(undefined);
  const [fnpX, setFnpX] = useState(5);
  const packInput = useRef<HTMLInputElement>(null);
  const hits = useAbilitySearch(rawSnapshot, snapshot, overrides, query);

  // A `?q=` from the coverage widget pre-selects the exact match.
  useEffect(() => {
    const q = routeQuery.get("q");
    if (!q || editor) return;
    const exact = hits.find((h) => h.ability.name.toLowerCase() === q.toLowerCase());
    if (exact) select(exact);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hits]);

  const selectedHit = useMemo(() => hits.find((h) => h.ability.id === editor?.abilityId), [hits, editor?.abilityId]);
  const rawAbility = useMemo(() => rawSnapshot?.data.abilities.find((a) => a.id === editor?.abilityId), [rawSnapshot, editor?.abilityId]);
  const effectiveAbility = useMemo(() => snapshot?.data.abilities.find((a) => a.id === editor?.abilityId), [snapshot, editor?.abilityId]);
  const derived = useMemo(() => (rawAbility ? abilityEffects(rawAbility) : undefined), [rawAbility]);

  function select(hit: AbilityHit) {
    const patch = hit.override?.patch;
    const effects = patch && Array.isArray(patch["effects"]) ? (patch["effects"] as EffectRecord[]) : [];
    setEditor({ abilityId: hit.ability.id, abilityName: hit.ability.name, effects, note: hit.override?.note ?? "", editing: undefined });
    setRawEdit(undefined);
  }

  const persist = async (o: Override, label: string) => {
    const existing = await db.overrides.get(overrideKey(o.entity, o.id));
    await db.overrides.put(toRecord(o, nowIso(), existing));
    await refreshOverrides();
    notify(t("overrides.saved", { name: label }), "success");
  };

  const saveEditor = async () => {
    if (!editor) return;
    await persist(abilityOverride({ id: editor.abilityId, name: editor.abilityName }, editor.effects, editor.note), editor.abilityName);
  };
  const quickFnp = async () => {
    if (!editor) return;
    await persist(fnpOverride({ id: editor.abilityId, name: editor.abilityName }, fnpX), editor.abilityName);
    setEditor({ ...editor, effects: [], note: `Feel No Pain ${fnpX}+` });
  };
  const quickNone = async () => {
    if (!editor) return;
    await persist(noEffectOverride({ id: editor.abilityId, name: editor.abilityName }, editor.note), editor.abilityName);
    setEditor({ ...editor, effects: [] });
  };

  const addEffect = (e: EffectRecord) =>
    setEditor((s) => {
      if (!s) return s;
      if (s.editing !== undefined) return { ...s, effects: s.effects.map((x, i) => (i === s.editing ? e : x)), editing: undefined };
      return { ...s, effects: [...s.effects, e] };
    });
  const removeEffect = (i: number) => setEditor((s) => (s ? { ...s, effects: s.effects.filter((_, j) => j !== i), editing: s.editing === i ? undefined : s.editing } : s));

  const nameOf = (entity: Override["entity"], id: string): string | undefined => {
    if (!rawSnapshot) return undefined;
    const d = rawSnapshot.data;
    switch (entity) {
      case "ability":
        return d.abilities.find((x) => x.id === id)?.name;
      case "datasheet":
      case "priceRule":
        return d.datasheets.find((x) => x.id === id)?.name;
      case "detachment":
        return d.detachments.find((x) => x.id === id)?.name;
      case "enhancement":
        return d.enhancements.find((x) => x.id === id)?.name;
      case "stratagem":
        return d.stratagems.find((x) => x.id === id)?.name;
      case "faction":
        return d.factions.find((x) => x.id === id)?.name;
    }
  };
  const inSnapshot = (entity: Override["entity"], id: string) => nameOf(entity, id) !== undefined;

  const edit = (r: OverrideRecord) => {
    const hit = r.entity === "ability" ? hitFor(r.id) : undefined;
    if (hit) {
      select(hit);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    setRawEdit(r);
  };
  const hitFor = (abilityId: string): AbilityHit | undefined => {
    const a = rawSnapshot?.data.abilities.find((x) => x.id === abilityId);
    if (!a) return undefined;
    const carriers = rawSnapshot!.data.datasheets.filter((d) => d.abilityIds.includes(abilityId)).map((d) => d.name);
    const override = overrides.find((o) => o.key === overrideKey("ability", abilityId));
    const eff = snapshot?.data.abilities.find((x) => x.id === abilityId) ?? a;
    return { ability: a, carriers, override, tier: abilityEffects(eff).tier };
  };

  const saveRaw = async (patch: Record<string, unknown>, note: string) => {
    if (!rawEdit) return;
    await persist({ entity: rawEdit.entity, id: rawEdit.id, patch, ...(note.trim() ? { note: note.trim() } : {}) }, nameOf(rawEdit.entity, rawEdit.id) ?? rawEdit.id);
    setRawEdit(undefined);
  };

  const remove = async (r: OverrideRecord) => {
    const label = nameOf(r.entity, r.id) ?? r.id;
    if (!window.confirm(t("overrides.confirmDelete", { name: label }))) return;
    await db.overrides.delete(r.key);
    await refreshOverrides();
    if (editor?.abilityId === r.id && r.entity === "ability") setEditor({ ...editor, effects: [], note: "" });
    notify(t("overrides.deleted", { name: label }), "success");
  };

  const exportPack = () => download(`grimstat-overrides-${new Date().toISOString().slice(0, 10)}.json`, toPack(overrides));

  const importPack = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    let json: unknown;
    try {
      json = JSON.parse(await f.text());
    } catch (err) {
      notify(t("data.notJson", { name: f.name }), "error", [err instanceof Error ? err.message : String(err)]);
      return;
    }
    const parsed = parseOverridePack(json);
    if (!parsed.overrides.length) {
      notify(t("overrides.importInvalid", { name: f.name }), "error", parsed.errors.slice(0, 15));
      return;
    }
    const merged = mergeOverrides(await listOverrides(), parsed.overrides, nowIso());
    await db.overrides.bulkPut(merged.merged);
    await refreshOverrides();
    notify(t("overrides.imported", { added: merged.added, updated: merged.updated, unchanged: merged.unchanged }), parsed.errors.length ? "error" : "success", parsed.errors.length ? parsed.errors.slice(0, 15) : undefined);
  };

  const editingForm: EffectFormState | undefined = editor && editor.editing !== undefined && editor.effects[editor.editing] ? effectToForm(editor.effects[editor.editing]!) : undefined;

  return (
    <>
      <PageHeader
        title={t("overrides.title")}
        subtitle={t("page.sub.overrides", { n: overrides.length })}
        actions={
          <>
            <OverridesPill />
            <a className="btn" href={hrefFor("data")}>
              {t("overrides.back")}
            </a>
          </>
        }
      />
      <div className="page-body stack">
      <p className="page-lede">{t("overrides.intro")}</p>

      <div className="analysis overrides-layout">
        <aside className="analysis-controls stack">
          <section className="panel">{rawSnapshot ? <AbilitySearch query={query} onQuery={setQuery} hits={hits} selectedId={editor?.abilityId} onSelect={select} /> : <Empty>{t("overrides.noSnapshot")}</Empty>}</section>
        </aside>
        <section className="analysis-results stack">
          <section className="panel stack" aria-labelledby="ov-editor-h">
            <div className="panel-head">
              <h2 id="ov-editor-h">{t("overrides.editor")}</h2>
              {editor ? <span className="unit-summary">{editor.abilityName}</span> : null}
            </div>
            {!editor ? (
              <Empty>{t("overrides.pickAbility")}</Empty>
            ) : (
              <>
                <div className="row">
                  {selectedHit ? <Badge tone={selectedHit.tier === "tier3" ? "danger" : selectedHit.tier === "tier2" ? "warn" : "ok"}>{tierLabel(selectedHit.tier)}</Badge> : null}
                  {rawAbility?.scope ? <Badge>{rawAbility.scope}</Badge> : null}
                  {rawAbility?.coreKeyword ? <Badge>{`${rawAbility.coreKeyword}${rawAbility.coreValue !== undefined ? ` ${rawAbility.coreValue}` : ""}`}</Badge> : null}
                  <span className="mono muted small">{editor.abilityId}</span>
                </div>
                {rawAbility ? (
                  <div>
                    <div className="inspector-h">{t("overrides.abilityText")}</div>
                    <p className="small ability-text">{rawAbility.text || "–"}</p>
                    {selectedHit?.carriers.length ? <p className="small muted">{t("overrides.carriedBy", { names: selectedHit.carriers.join(", ") })}</p> : null}
                  </div>
                ) : (
                  <p className="small muted">{t("overrides.unknownAbility")}</p>
                )}
                <div>
                  <div className="inspector-h">{t("overrides.currentEffects")}</div>
                  {editor.effects.length ? (
                    <ol className="effect-list">
                      {editor.effects.map((e, i) => (
                        <li key={i} className={editor.editing === i ? "editing" : undefined}>
                          <span className="grow">{describeEffect(e)}</span>
                          <button type="button" className="ghost sm" aria-label={t("overrides.editEffect", { n: i + 1 })} onClick={() => setEditor({ ...editor, editing: i })}>
                            {t("overrides.edit")}
                          </button>
                          <button type="button" className="chip-x" aria-label={t("overrides.removeEffect", { n: i + 1 })} onClick={() => removeEffect(i)}>
                            ×
                          </button>
                        </li>
                      ))}
                    </ol>
                  ) : (
                    <p className="small muted">{t("overrides.noEffects")}</p>
                  )}
                  {derived && !effectiveAbility?.effects?.length ? <p className="small muted">{t("overrides.derived", { n: derived.effects.length })}</p> : null}
                </div>
                <EffectForm key={`${editor.abilityId}:${editor.editing ?? "new"}`} source={editor.abilityName} initial={editingForm} onSubmit={addEffect} onCancel={editor.editing !== undefined ? () => setEditor({ ...editor, editing: undefined }) : undefined} />
                <Field label={t("overrides.note")}>
                  <input type="text" value={editor.note} placeholder={t("overrides.notePlaceholder")} onChange={(e) => setEditor({ ...editor, note: e.target.value })} />
                </Field>
                <div className="row">
                  <button type="button" className="primary" onClick={() => void saveEditor()}>
                    {t("overrides.save")}
                  </button>
                </div>
                <div className="diff-box stack" style={{ gap: "0.4rem" }}>
                  <div className="inspector-h" style={{ margin: 0 }}>
                    {t("overrides.quick")}
                  </div>
                  <div className="row">
                    <label className="field inline-field">
                      <span>{t("overrides.quickFnp")}</span>
                      <select value={fnpX} onChange={(e) => setFnpX(Number(e.target.value) || 5)}>
                        {[4, 5, 6].map((x) => (
                          <option key={x} value={x}>
                            {x}+
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="sm" onClick={() => void quickFnp()}>
                      {t("overrides.quickFnpApply", { x: fnpX })}
                    </button>
                  </div>
                  <div className="row">
                    <button type="button" className="sm" onClick={() => void quickNone()}>
                      {t("overrides.quickNone")}
                    </button>
                    <span className="small muted">{t("overrides.quickNoneHint")}</span>
                  </div>
                </div>
              </>
            )}
          </section>

          <section className="panel stack" aria-labelledby="ov-list-h">
            <div className="panel-head">
              <h2 id="ov-list-h">{t("overrides.list")}</h2>
              <div className="row">
                <button type="button" className="sm" disabled={!overrides.length} onClick={exportPack}>
                  {t("overrides.export")}
                </button>
                <button type="button" className="sm" onClick={() => packInput.current?.click()}>
                  {t("overrides.import")}
                </button>
                <input ref={packInput} type="file" accept="application/json,.json" className="sr-only" aria-label={t("overrides.import")} onChange={(e) => void importPack(e)} />
              </div>
            </div>
            <OverridesList records={overrides} nameOf={nameOf} inSnapshot={inSnapshot} onEdit={edit} onDelete={(r) => void remove(r)} />
            {rawEdit ? <RawPatchEditor key={rawEdit.key} record={rawEdit} onSave={(p, n) => void saveRaw(p, n)} onCancel={() => setRawEdit(undefined)} /> : null}
          </section>
        </section>
      </div>
      </div>
    </>
  );
}
