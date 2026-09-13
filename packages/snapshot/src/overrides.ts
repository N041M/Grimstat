import { Ability, Datasheet, Detachment, Enhancement, Faction, PriceRule, Stratagem, type Override, type SnapshotData } from "@grimstat/schema";

/** Structural copy of arrays and plain objects. Anything else (numbers, strings, null) is returned as it is. */
function copy<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => copy(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) out[key] = copy(v);
    return out as T;
  }
  return value;
}

/**
 * RFC 7396 JSON merge patch. `null` in the patch removes a key; objects merge recursively; anything else
 * replaces. Values taken from the patch are copied, so one override applied to several entities gives each
 * of them its own arrays and objects and the caller's patch stays detached from the result.
 */
export function mergePatch<T>(target: T, patch: unknown): T {
  if (patch === null || typeof patch !== "object" || Array.isArray(patch)) return copy(patch) as T;
  const base: Record<string, unknown> = target && typeof target === "object" && !Array.isArray(target) ? { ...(target as Record<string, unknown>) } : {};
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === null) delete base[key];
    else base[key] = mergePatch(base[key], value);
  }
  return base as T;
}

const COLLECTIONS: Record<Override["entity"], keyof SnapshotData> = {
  datasheet: "datasheets",
  ability: "abilities",
  detachment: "detachments",
  enhancement: "enhancements",
  stratagem: "stratagems",
  priceRule: "priceRules",
  faction: "factions",
};

/** The schema a record has to satisfy once the patch has been applied to it. */
const SCHEMAS = {
  datasheet: Datasheet,
  ability: Ability,
  detachment: Detachment,
  enhancement: Enhancement,
  stratagem: Stratagem,
  priceRule: PriceRule,
  faction: Faction,
} satisfies Record<Override["entity"], { safeParse: (value: unknown) => { success: boolean } }>;

export interface ApplyOverridesResult {
  data: SnapshotData;
  /** Overrides whose entity id was not found (index into the input array + a description). */
  missing: { index: number; entity: string; id: string }[];
  /** Overrides that would leave a record the schema rejects. The record keeps the value it had. */
  rejected: { index: number; entity: string; id: string; error: string }[];
  /** How many overrides patched at least one record. */
  applied: number;
}

/**
 * Apply hand-authored overrides on top of imported data. Each override is a JSON merge patch keyed by
 * entity kind + id. Price rules are addressed by datasheet id (the patch applies to every rule of that
 * datasheet). The input is not mutated.
 *
 * A patch is free-form JSON, so an imported pack can carry one that turns a record into something the
 * schema no longer accepts. Each patched record is checked here and an override that fails the check
 * is dropped whole and listed in `rejected`, which keeps the rest of the pack usable and names the
 * entity the caller has to fix.
 */
export function applyOverrides(data: SnapshotData, overrides: Override[]): ApplyOverridesResult {
  const out: SnapshotData = { ...data };
  const missing: ApplyOverridesResult["missing"] = [];
  const rejected: ApplyOverridesResult["rejected"] = [];
  let applied = 0;
  overrides.forEach((ov, index) => {
    const key = COLLECTIONS[ov.entity];
    const list = (out[key] as unknown[]).slice();
    let hit = false;
    let error: string | undefined;
    for (let i = 0; i < list.length; i++) {
      const item = list[i] as Record<string, unknown>;
      const id = ov.entity === "priceRule" ? item["datasheetId"] : item["id"];
      if (id !== ov.id) continue;
      const patched = mergePatch(item, ov.patch);
      const parsed = SCHEMAS[ov.entity].safeParse(patched);
      if (!parsed.success) {
        error = describeIssue(parsed.error);
        break;
      }
      list[i] = patched;
      hit = true;
    }
    if (error !== undefined) {
      rejected.push({ index, entity: ov.entity, id: ov.id, error });
      return;
    }
    if (!hit) missing.push({ index, entity: ov.entity, id: ov.id });
    else applied++;
    (out as unknown as Record<string, unknown>)[key] = list;
  });
  return { data: out, missing, rejected, applied };
}

/** The first thing the schema objected to, as "field: reason". */
function describeIssue(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  const issue = error.issues[0];
  if (!issue) return "invalid";
  return `${issue.path.join(".") || "(root)"}: ${issue.message}`;
}
