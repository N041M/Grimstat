import { EffectRecord, Override, type Ability, type Condition, type EffectOp, type Side, type Snapshot, type Stage } from "@grimstat/schema";
import { applyOverrides } from "@grimstat/snapshot";
import { CHANNEL_INFO } from "./gameExtras";
import { t, type I18nKey } from "../i18n";

/** A stored rules override: the schema `Override` plus record bookkeeping. Keyed by `entity:id`. */
export interface OverrideRecord extends Override {
  /** `${entity}:${id}` — one override per entity. */
  key: string;
  ownerId: string;
  createdAt: string;
  updatedAt: string;
}

export function overrideKey(entity: Override["entity"], id: string): string {
  return `${entity}:${id}`;
}

/** Entity kinds an override can carry, plus the kinds a snapshot diff reports. */
const ENTITY_LABELS: Record<string, I18nKey> = {
  faction: "entity.faction",
  publication: "entity.publication",
  datasheet: "entity.datasheet",
  ability: "entity.ability",
  detachment: "entity.detachment",
  enhancement: "entity.enhancement",
  stratagem: "entity.stratagem",
  wargearPrice: "entity.wargearPrice",
  priceRule: "entity.priceRule",
};

/** The entity kind in words ("price rule"), for the overrides list and the snapshot diff. */
export function entityLabel(entity: string): string {
  const key = ENTITY_LABELS[entity];
  return key ? t(key) : entity;
}

// ---------- Effective snapshot ----------

export interface EffectiveSnapshot {
  snapshot: Snapshot;
  /** Overrides whose entity was found in the snapshot. */
  applied: number;
  /** Overrides whose entity id is not in this snapshot (kept, because they may apply to another snapshot). */
  missing: number;
}

/** FNV-1a over a string; used to make the worker cache key depend on the override set. */
export function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * A 128-bit hash of a string, as 32 hex characters.
 *
 * Four FNV-1a lanes run over the same characters, each with its own offset basis and prime, and
 * each lane takes the one beside it along on every character, so a pair of strings that collides
 * in one lane has to collide in all four to collide here. A closing round mixes the lanes again so
 * a change in the last character reaches every digit. It is used where a hash is a primary key and
 * a 32-bit one would collide. The corpus of published lists runs to six figures of records.
 */
export function fnv1a128(s: string): string {
  let a = 0x811c9dc5;
  let b = 0x9dc5811c;
  let c = 0xc59d1c81;
  let d = 0x1c81c59d;
  for (let i = 0; i < s.length; i++) {
    const k = s.charCodeAt(i);
    a = b ^ Math.imul(a ^ k, 0x01000193);
    b = c ^ Math.imul(b ^ k, 0x85ebca6b);
    c = d ^ Math.imul(c ^ k, 0xc2b2ae35);
    d = a ^ Math.imul(d ^ k, 0x27d4eb2f);
  }
  a = Math.imul(a ^ (c >>> 15), 0x01000193);
  b = Math.imul(b ^ (d >>> 13), 0x85ebca6b);
  c = Math.imul(c ^ (a >>> 16), 0xc2b2ae35);
  d = Math.imul(d ^ (b >>> 11), 0x27d4eb2f);
  return [a, b, c, d].map((h) => (h >>> 0).toString(16).padStart(8, "0")).join("");
}

/** Stable fingerprint of an override set (order-independent). */
export function overridesFingerprint(overrides: Override[]): string {
  const keys = overrides.map((o) => `${o.entity}:${o.id}:${JSON.stringify(o.patch)}`).sort();
  return fnv1a(keys.join("\n"));
}

/**
 * The snapshot the rest of the app should read: `raw.data` with every override applied. The checksum gains a
 * suffix so caches keyed by `id|checksum` (the simulation worker) never serve the un-patched data. With no
 * overrides the raw object is returned untouched.
 */
export function effectiveSnapshot(raw: Snapshot, overrides: Override[]): EffectiveSnapshot {
  if (!overrides.length) return { snapshot: raw, applied: 0, missing: 0 };
  const res = applyOverrides(raw.data, overrides);
  const stamp = overridesFingerprint(overrides);
  return { snapshot: { ...raw, checksum: `${raw.checksum}+ov${stamp}`, data: res.data }, applied: res.applied, missing: res.missing.length };
}

// ---------- Effect form → EffectRecord ----------

export const STAGES: Stage[] = ["attacks", "hit", "wound", "allocate", "save", "damage", "fnp", "mortal", "hazardous", "any"];
export const SIDES: Side[] = ["attacker", "defender"];
export const OPS: EffectOp[] = ["add", "set", "mul", "cap", "reroll", "flag", "substitute"];
export const REROLL_POLICIES = ["ones", "failed", "non-crit", "one-die"] as const;
export type RerollPolicy = (typeof REROLL_POLICIES)[number];
export type ValueKind = "number" | "reroll" | "boolean" | "string";
export const VALUE_KINDS: ValueKind[] = ["number", "reroll", "boolean", "string"];

export interface ConditionForm {
  targetKeyword: string;
  attackerKeyword: string;
  weaponKind: "" | "ranged" | "melee";
  weaponKeyword: string;
  rangeBand: "" | "half" | "full";
  charged: "" | "true" | "false";
  stationary: "" | "true" | "false";
  inCover: "" | "true" | "false";
  phase: "" | "shooting" | "fight";
}

export interface EffectForm {
  stage: Stage;
  side: Side;
  op: EffectOp;
  /** Channel id (from CHANNEL_INFO or free text). */
  target: string;
  valueKind: ValueKind;
  /** Raw text for number/string values. */
  value: string;
  reroll: RerollPolicy;
  bool: boolean;
  condition: ConditionForm;
}

export const EMPTY_CONDITION: ConditionForm = { targetKeyword: "", attackerKeyword: "", weaponKind: "", weaponKeyword: "", rangeBand: "", charged: "", stationary: "", inCover: "", phase: "" };

export function defaultEffectForm(): EffectForm {
  return { stage: "hit", side: "attacker", op: "add", target: "hit-roll", valueKind: "number", value: "1", reroll: "ones", bool: true, condition: { ...EMPTY_CONDITION } };
}

/** The value kind that fits an op / channel combination (reroll ops take a policy, flags a boolean, …). */
export function suggestedValueKind(op: EffectOp, target: string): ValueKind {
  if (op === "reroll") return "reroll";
  if (op === "flag") return "boolean";
  const info = CHANNEL_INFO.find((c) => c.channel === target);
  if (info?.kind === "flag") return "boolean";
  if (info?.kind === "reroll") return "reroll";
  return "number";
}

/** Stages that make sense for a channel, used to pre-select the stage when the target changes. */
export function suggestedStage(target: string): Stage | undefined {
  if (/^(attacks)$/.test(target)) return "attacks";
  if (/^(skill|hit-roll|crit-hit|reroll-hit|auto-hit|lethal|sustained|precision|ignores-cover|stealth|no-crit-hits|indirect|psychic)$/.test(target)) return "hit";
  if (/^(strength|toughness|wound-roll|crit-wound|reroll-wound|devastating)$/.test(target)) return "wound";
  if (/^(ap|save-roll|save|invuln|reroll-save)$/.test(target)) return "save";
  if (/^(damage)$/.test(target)) return "damage";
  if (/^(fnp)$/.test(target)) return "fnp";
  if (/^(hazardous)$/.test(target)) return "hazardous";
  return undefined;
}

export function conditionFromForm(c: ConditionForm): Condition | undefined {
  const out: Condition = {};
  const bool = (v: "" | "true" | "false"): boolean | undefined => (v === "" ? undefined : v === "true");
  if (c.targetKeyword.trim()) out.targetKeyword = c.targetKeyword.trim().toUpperCase();
  if (c.attackerKeyword.trim()) out.attackerKeyword = c.attackerKeyword.trim().toUpperCase();
  if (c.weaponKind) out.weaponKind = c.weaponKind;
  if (c.weaponKeyword.trim()) out.weaponKeyword = c.weaponKeyword.trim();
  if (c.rangeBand) out.rangeBand = c.rangeBand;
  const charged = bool(c.charged);
  if (charged !== undefined) out.charged = charged;
  const stationary = bool(c.stationary);
  if (stationary !== undefined) out.stationary = stationary;
  const inCover = bool(c.inCover);
  if (inCover !== undefined) out.inCover = inCover;
  if (c.phase) out.phase = c.phase;
  return Object.keys(out).length ? out : undefined;
}

export function conditionToForm(c: Condition | undefined): ConditionForm {
  const tri = (v: boolean | undefined): "" | "true" | "false" => (v === undefined ? "" : v ? "true" : "false");
  return {
    targetKeyword: c?.targetKeyword ?? "",
    attackerKeyword: c?.attackerKeyword ?? "",
    weaponKind: c?.weaponKind ?? "",
    weaponKeyword: c?.weaponKeyword ?? "",
    rangeBand: c?.rangeBand ?? "",
    charged: tri(c?.charged),
    stationary: tri(c?.stationary),
    inCover: tri(c?.inCover),
    phase: c?.phase === "shooting" || c?.phase === "fight" ? c.phase : "",
  };
}

export type BuildResult = { ok: true; effect: EffectRecord } | { ok: false; error: I18nKey };

/** Turn the editor form into a schema-valid EffectRecord (`source` = the ability name). */
export function buildEffect(form: EffectForm, source: string): BuildResult {
  const target = form.target.trim();
  if (!target) return { ok: false, error: "overrides.err.target" };
  let value: number | string | boolean;
  switch (form.valueKind) {
    case "number": {
      const n = Number(form.value.trim());
      if (form.value.trim() === "" || !Number.isFinite(n)) return { ok: false, error: "overrides.err.number" };
      value = n;
      break;
    }
    case "reroll":
      value = form.reroll;
      break;
    case "boolean":
      value = form.bool;
      break;
    case "string": {
      const s = form.value.trim();
      if (!s) return { ok: false, error: "overrides.err.string" };
      value = s;
      break;
    }
  }
  const cond = conditionFromForm(form.condition);
  const candidate = { when: { stage: form.stage, side: form.side }, ...(cond ? { if: cond } : {}), op: form.op, target, value, source };
  const parsed = EffectRecord.safeParse(candidate);
  if (!parsed.success) return { ok: false, error: "overrides.err.invalid" };
  return { ok: true, effect: parsed.data };
}

/** Load an existing record back into the form (for editing). */
export function effectToForm(e: EffectRecord): EffectForm {
  const base = defaultEffectForm();
  const valueKind: ValueKind = typeof e.value === "boolean" ? "boolean" : typeof e.value === "number" ? "number" : (REROLL_POLICIES as readonly string[]).includes(e.value) ? "reroll" : "string";
  return {
    ...base,
    stage: e.when.stage,
    side: e.when.side ?? "attacker",
    op: e.op,
    target: e.target,
    valueKind,
    value: typeof e.value === "boolean" ? "" : String(e.value),
    reroll: valueKind === "reroll" ? (e.value as RerollPolicy) : "ones",
    bool: typeof e.value === "boolean" ? e.value : true,
    condition: conditionToForm(e.if),
  };
}

/**
 * Which effect is being edited once the one at `removed` is taken out of the list.
 *
 * The editor holds the effect under edit as a position, so removing an effect above it slides it
 * down one. Removing the effect being edited closes the form.
 */
export function editingAfterRemove(editing: number | undefined, removed: number): number | undefined {
  if (editing === undefined || editing === removed) return undefined;
  return editing > removed ? editing - 1 : editing;
}

/** One-line description of an effect for lists. */
export function describeEffect(e: EffectRecord): string {
  const label = CHANNEL_INFO.find((c) => c.channel === e.target)?.label ?? e.target;
  const v = typeof e.value === "boolean" ? (e.value ? "on" : "off") : String(e.value);
  const prefix = e.op === "add" && typeof e.value === "number" && e.value > 0 ? "+" : "";
  return `${e.when.side ?? "attacker"} · ${e.when.stage} · ${e.op} ${label} ${prefix}${v}${e.if ? " (conditional)" : ""}`;
}

// ---------- Override records ----------

/**
 * The override the effect editor writes. The effect list replaces `effects`, and every other key of
 * the patch the editor loaded is carried over, so saving an ability whose patch sets a core keyword
 * keeps that keyword. An empty list is written only when the loaded patch already carried one,
 * because `effects: []` states that the ability has no effect on the attack sequence.
 */
export function abilityOverride(ability: Pick<Ability, "id" | "name">, effects: EffectRecord[], note: string | undefined, loaded: Record<string, unknown> = {}): Override {
  const ownsList = effects.length > 0 || Array.isArray(loaded["effects"]);
  const patch = ownsList ? { ...loaded, effects } : { ...loaded };
  return { entity: "ability", id: ability.id, patch, ...(note?.trim() ? { note: note.trim() } : {}) };
}

/** Feel No Pain X+ as a core keyword (Tier-1); clears any explicit effects. */
export function fnpOverride(ability: Pick<Ability, "id" | "name">, x: number, note?: string): Override {
  return { entity: "ability", id: ability.id, patch: { coreKeyword: "FEEL NO PAIN", coreValue: x, effects: null }, note: note?.trim() || t("overrides.note.fnp", { x }) };
}

/** Mark an ability as having no effect on the attack sequence so coverage stops listing it. */
export function noEffectOverride(ability: Pick<Ability, "id" | "name">, note?: string): Override {
  return { entity: "ability", id: ability.id, patch: { effects: [] }, note: note?.trim() || t("overrides.note.noEffect") };
}

/** True when the patch explicitly says "no combat effect" (`effects: []`). */
export function isNoEffectPatch(patch: Record<string, unknown>): boolean {
  return Array.isArray(patch["effects"]) && patch["effects"].length === 0;
}

/** The part of a patch the effect editor does not own, for the line that says what saving keeps. */
export function patchBeyondEffects(patch: Record<string, unknown>): Record<string, unknown> | undefined {
  const rest = { ...patch };
  delete rest["effects"];
  return Object.keys(rest).length ? rest : undefined;
}

/** Short summary of what a patch does, for the overrides list. */
export function summarisePatch(patch: Record<string, unknown>): { kind: "effects" | "none" | "fnp" | "fields"; n: number; keys: string[] } {
  const effects = patch["effects"];
  if (Array.isArray(effects)) return effects.length ? { kind: "effects", n: effects.length, keys: [] } : { kind: "none", n: 0, keys: [] };
  if (patch["coreKeyword"] === "FEEL NO PAIN") return { kind: "fnp", n: Number(patch["coreValue"]) || 0, keys: [] };
  return { kind: "fields", n: 0, keys: Object.keys(patch) };
}

export function toRecord(o: Override, now: string, existing?: OverrideRecord): OverrideRecord {
  return { ...o, key: overrideKey(o.entity, o.id), ownerId: existing?.ownerId ?? "local", createdAt: existing?.createdAt ?? now, updatedAt: now };
}

export interface MergeResult {
  merged: OverrideRecord[];
  added: number;
  updated: number;
  unchanged: number;
}

/** Merge an imported pack into the stored records by `entity + id`; later entries in `incoming` win. */
export function mergeOverrides(existing: OverrideRecord[], incoming: Override[], now: string): MergeResult {
  const byKey = new Map(existing.map((r) => [r.key, r] as const));
  let added = 0;
  let updated = 0;
  let unchanged = 0;
  for (const o of incoming) {
    const key = overrideKey(o.entity, o.id);
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, toRecord(o, now));
      added++;
      continue;
    }
    const samePatch = JSON.stringify(prev.patch) === JSON.stringify(o.patch) && (prev.note ?? "") === (o.note ?? "");
    if (samePatch) {
      unchanged++;
      continue;
    }
    byKey.set(key, toRecord(o, now, prev));
    updated++;
  }
  return { merged: [...byKey.values()], added, updated, unchanged };
}

/** Strip record bookkeeping: the export pack is a plain array of schema `Override`s. */
export function toPack(records: OverrideRecord[]): Override[] {
  return records.map(({ entity, id, patch, note }) => ({ entity, id, patch, ...(note ? { note } : {}) }));
}

export interface PackParse {
  overrides: Override[];
  errors: string[];
}

/** Accept a bare array of overrides or `{ overrides: [...] }`; every entry is validated against the schema. */
export function parseOverridePack(json: unknown): PackParse {
  const list = Array.isArray(json) ? json : json && typeof json === "object" && Array.isArray((json as { overrides?: unknown }).overrides) ? (json as { overrides: unknown[] }).overrides : undefined;
  if (!list) return { overrides: [], errors: ["not an array of overrides"] };
  const overrides: Override[] = [];
  const errors: string[] = [];
  list.forEach((item, i) => {
    const p = Override.safeParse(item);
    if (p.success) overrides.push(p.data);
    else errors.push(`#${i + 1}: ${p.error.issues[0]?.path.join(".") || "(root)"}: ${p.error.issues[0]?.message ?? "invalid"}`);
  });
  return { overrides, errors };
}

// ---------- Editor state ----------

/** The ability editor as the overrides page holds it. */
export interface EditorState {
  abilityId: string;
  abilityName: string;
  /** The stored patch the editor was loaded from. Saving keeps the keys the effect list does not own. */
  patch: Record<string, unknown>;
  effects: EffectRecord[];
  note: string;
  /** Index of the effect being edited in place. */
  editing: number | undefined;
}

/** The explicit effect list of a patch. A patch that carries none leaves the editor with an empty list. */
function effectsOf(patch: Record<string, unknown>): EffectRecord[] {
  return Array.isArray(patch["effects"]) ? (patch["effects"] as EffectRecord[]) : [];
}

/** Open the editor on an ability, with the stored override loaded whole. */
export function editorFor(ability: Pick<Ability, "id" | "name">, override: Pick<Override, "patch" | "note"> | undefined): EditorState {
  const patch = override?.patch ?? {};
  return { abilityId: ability.id, abilityName: ability.name, patch, effects: effectsOf(patch), note: override?.note ?? "", editing: undefined };
}

/** Take an effect from the form. It replaces the effect being edited, or joins the end of the list. */
export function withEffect(s: EditorState, e: EffectRecord): EditorState {
  const at = s.editing !== undefined && s.effects[s.editing] ? s.editing : undefined;
  return { ...s, effects: at !== undefined ? s.effects.map((x, i) => (i === at ? e : x)) : [...s.effects, e], editing: undefined };
}

/** Drop the effect at `i`. */
export function withoutEffect(s: EditorState, i: number): EditorState {
  return { ...s, effects: s.effects.filter((_, j) => j !== i), editing: editingAfterRemove(s.editing, i) };
}

/**
 * Show the patch the page has just stored or cleared (a quick action, a save, a deleted override).
 * The effect list follows the new patch, and the form closes because the index it was editing points
 * into the list that has just been replaced.
 */
export function withPatch(s: EditorState, patch: Record<string, unknown>, note: string): EditorState {
  return { ...s, patch, effects: effectsOf(patch), note, editing: undefined };
}
