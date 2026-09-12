import type { Ability, Conflict, Datasheet, Detachment, Enhancement, Faction, GameSystem, ModelProfile, PriceRule, Publication, SnapshotData, SourceRef, Stratagem, WargearPrice, WeaponProfile } from "@grimstat/schema";
import { canonicalJson } from "./checksum";
import { factionKey, normaliseName, slugToNameKey } from "./normalise";

/** A datasheet as emitted by a single adapter; points-only sources cannot supply model profiles. */
export type PartialDatasheet = Pick<Datasheet, "id" | "gameSystemId" | "factionId" | "name"> & Partial<Datasheet>;

/** What every importer hands to the merge (the adapters' `AdapterOutput` is assignable to this). */
export interface MergePart extends Omit<Partial<SnapshotData>, "datasheets"> {
  datasheets?: PartialDatasheet[];
  sourceRef: SourceRef;
  warnings?: string[];
}

export interface MergePolicy {
  /** Adapter ids in order of authority for points, Detachment Points, unique tags and leader/support lists. */
  pointsPrecedence: string[];
  /** Adapter ids in order of authority for stats, weapons, abilities, keywords and rules text. */
  textPrecedence: string[];
  /** Per adapter, fields whose values are placeholders (used only when nobody else has a value, and not reported as conflicts). */
  untrusted?: Record<string, string[]>;
  /** Also join datasheets by name across unrelated factions when the name is globally unique (default false). */
  matchAcrossFactions?: boolean;
  /** Drop datasheets that end up without a model profile (default true). */
  dropStubs?: boolean;
  gameSystem?: GameSystem;
}

export const DEFAULT_MERGE_POLICY: MergePolicy = {
  pointsPrecedence: ["mfm-yaml", "bsdata-json", "wahapedia-csv"],
  textPrecedence: ["wahapedia-csv", "bsdata-json", "mfm-yaml"],
  untrusted: { "wahapedia-csv": ["detachment.dp"] },
  matchAcrossFactions: false,
  dropStubs: true,
};

export interface Unmatched {
  adapter: string;
  entity: string;
  id: string;
  name: string;
  reason: string;
}

export interface MergeResult {
  data: SnapshotData;
  conflicts: Conflict[];
  warnings: string[];
  /** Entities present in a single source that could not be completed (e.g. MFM price stubs without a datasheet). */
  unmatched: Unmatched[];
}

// ---- clustering ---------------------------------------------------------------------------------

interface Member<T> {
  adapter: string;
  item: T;
}
interface Cluster<T> {
  id: string;
  members: Member<T>[];
}

/** Groups equivalent entities across sources. Keys are tried in order; a name key joins only when it is unambiguous. */
class ClusterIndex<T extends { id: string }> {
  clusters: Cluster<T>[] = [];
  private byKey = new Map<string, Set<number>>();
  private usedIds = new Set<string>();

  add(adapter: string, item: T, keys: string[]): Cluster<T> {
    for (const key of keys) {
      const candidates = [...(this.byKey.get(key) ?? [])].filter((i) => !this.clusters[i]!.members.some((m) => m.adapter === adapter));
      if (candidates.length === 1 || (key.startsWith("id|") && candidates.length > 0)) {
        const c = this.clusters[candidates[0]!]!;
        c.members.push({ adapter, item });
        this.register(candidates[0]!, keys);
        return c;
      }
    }
    let id = item.id;
    for (let n = 2; this.usedIds.has(id); n++) id = `${item.id}-${n}`;
    this.usedIds.add(id);
    const c: Cluster<T> = { id, members: [{ adapter, item }] };
    this.clusters.push(c);
    this.register(this.clusters.length - 1, keys);
    return c;
  }

  /**
   * Collapse clusters that describe the same thing under different sub-factions of one family
   * (e.g. a shared parent-faction detachment repeated on every chapter page) into the parent's cluster.
   */
  dedupeWithinFamily(groupKey: (item: T) => string, isRoot: (item: T) => boolean): void {
    const groups = new Map<string, Cluster<T>[]>();
    for (const c of this.clusters) {
      const key = groupKey(c.members[0]!.item);
      groups.set(key, [...(groups.get(key) ?? []), c]);
    }
    const drop = new Set<Cluster<T>>();
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const root = list.find((c) => isRoot(c.members[0]!.item));
      if (!root) continue;
      for (const c of list) {
        if (c === root) continue;
        root.members.push(...c.members);
        drop.add(c);
      }
    }
    if (!drop.size) return;
    const kept = this.clusters.filter((c) => !drop.has(c));
    const remap = new Map<number, number>();
    this.clusters.forEach((c, i) => {
      const j = kept.indexOf(c);
      remap.set(i, j >= 0 ? j : kept.indexOf([...drop].find((d) => d === c) ? kept.find((k) => k.members.some((m) => c.members.includes(m)))! : c));
    });
    for (const [key, set] of this.byKey) this.byKey.set(key, new Set([...set].map((i) => remap.get(i)!).filter((i) => i >= 0)));
    this.clusters = kept;
  }

  find(keys: string[]): Cluster<T> | undefined {
    for (const key of keys) {
      const hits = this.byKey.get(key);
      if (hits && hits.size === 1) return this.clusters[[...hits][0]!];
    }
    return undefined;
  }

  private register(index: number, keys: string[]): void {
    for (const key of keys) {
      const set = this.byKey.get(key) ?? new Set<number>();
      set.add(index);
      this.byKey.set(key, set);
    }
  }
}

function rankIn(list: string[], adapter: string): number {
  const i = list.indexOf(adapter);
  return i < 0 ? list.length : i;
}

function sortMembers<T>(members: Member<T>[], order: string[]): Member<T>[] {
  return [...members].sort((a, b) => rankIn(order, a.adapter) - rankIn(order, b.adapter));
}

function nonEmpty(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

function fmt(v: unknown): string {
  if (typeof v === "string") return v;
  return canonicalJson(v);
}

// ---- the merge ----------------------------------------------------------------------------------

export function mergeSources(parts: MergePart[], policyIn: Partial<MergePolicy> = {}): MergeResult {
  const policy: MergePolicy = { ...DEFAULT_MERGE_POLICY, ...policyIn };
  const conflicts: Conflict[] = [];
  const warnings: string[] = [];
  const unmatched: Unmatched[] = [];
  const P = policy.pointsPrecedence;
  const T = policy.textPrecedence;
  const untrusted = (adapter: string, field: string): boolean => (policy.untrusted?.[adapter] ?? []).includes(field);

  const ordered = [...parts].sort((a, b) => rankIn(P, a.sourceRef.adapter) - rankIn(P, b.sourceRef.adapter));
  const adapterOf = (p: MergePart): string => p.sourceRef.adapter;

  const conflict = (entity: string, id: string, field: string, chosen: unknown, candidates: { adapter: string; value: unknown }[]): void => {
    const distinct = new Set(candidates.map((c) => canonicalJson(c.value)));
    if (distinct.size <= 1) return;
    conflicts.push({ entity, id, field, chosen: fmt(chosen), candidates: candidates.map((c) => ({ adapter: c.adapter, value: fmt(c.value) })) });
  };

  /** Pick a field from the members in `order`, skipping empty values and untrusted placeholders; log a conflict when trusted values disagree. */
  const pick = <R>(entity: string, id: string, field: string, members: Member<Record<string, unknown>>[], order: string[], get: (item: Record<string, unknown>) => R, opts: { compare?: (v: R) => unknown; silent?: boolean } = {}): R | undefined => {
    const sorted = sortMembers(members, order);
    const trusted = sorted.filter((m) => !untrusted(m.adapter, `${entity}.${field}`) && nonEmpty(get(m.item)));
    const fallback = sorted.filter((m) => nonEmpty(get(m.item)));
    const winner = trusted[0] ?? fallback[0];
    if (!winner) return undefined;
    const value = get(winner.item);
    if (!opts.silent && trusted.length > 1) {
      const cmp = opts.compare ?? ((v: R): unknown => v);
      conflict(entity, id, field, cmp(value), trusted.map((m) => ({ adapter: m.adapter, value: cmp(get(m.item)) })));
    }
    return value;
  };

  // ---- factions -------------------------------------------------------------------------------
  const factionParent = new Map<string, string>();
  const factionSources = new Map<string, Set<string>>();
  const factionClusters = new ClusterIndex<Faction>();
  for (const part of ordered) {
    for (const f of part.factions ?? []) {
      const key = factionKey(f.id);
      factionClusters.add(adapterOf(part), { ...f, id: `faction:${key}` }, [`id|faction:${key}`, `name|${normaliseName(f.name)}`]);
      if (f.parentFactionId) factionParent.set(`faction:${key}`, `faction:${factionKey(f.parentFactionId)}`);
      factionSources.set(`faction:${key}`, new Set([...(factionSources.get(`faction:${key}`) ?? []), adapterOf(part)]));
    }
  }
  const factionIdMap = new Map<string, string>(); // any source faction id -> canonical
  const factions: Faction[] = [];
  for (const c of factionClusters.clusters) {
    const members = c.members as unknown as Member<Record<string, unknown>>[];
    const name = pick("faction", c.id, "name", members, T, (i) => i["name"] as string, { silent: true }) ?? c.id;
    const parent = c.members.map((m) => m.item.parentFactionId).find((p) => p);
    const gameSystemId = (c.members[0]?.item.gameSystemId as string) ?? policy.gameSystem?.id ?? "wh40k-11e";
    const keywords = [...new Set(c.members.flatMap((m) => m.item.keywords ?? []))];
    const f: Faction = { id: c.id, gameSystemId, name, keywords };
    if (parent) f.parentFactionId = `faction:${factionKey(parent)}`;
    factions.push(f);
    for (const m of c.members) factionIdMap.set(m.item.id, c.id);
    if (parts.length > 1 && c.members.length === 1) warnings.push(`faction ${c.id} ("${name}") only present in ${c.members[0]!.adapter}`);
  }
  const canonFaction = (id: string | undefined): string | undefined => (id ? factionIdMap.get(id) ?? `faction:${factionKey(id)}` : undefined);
  const familyOf = (factionId: string): string => {
    let cur = `faction:${factionKey(factionId)}`;
    const seen = new Set<string>();
    while (factionParent.has(cur) && !seen.has(cur)) {
      seen.add(cur);
      cur = factionParent.get(cur)!;
    }
    return cur;
  };

  // ---- datasheets: cluster --------------------------------------------------------------------
  const dsClusters = new ClusterIndex<PartialDatasheet>();
  const singular = (n: string): string => n.replace(/(\w{3,})s$/, "$1");
  const dsKeys = (d: { id: string; name: string; factionId: string }): string[] => {
    const n = normaliseName(d.name);
    const keys = [`id|${d.id}`, `fn|${factionKey(d.factionId)}|${n}`, `fam|${familyOf(d.factionId)}|${n}`, `famp|${familyOf(d.factionId)}|${singular(n)}`];
    if (policy.matchAcrossFactions) keys.push(`name|${n}`);
    return keys;
  };
  for (const part of ordered) for (const d of part.datasheets ?? []) dsClusters.add(adapterOf(part), d, dsKeys(d));

  const dsIdMap = new Map<string, string>(); // source datasheet id -> canonical
  for (const c of dsClusters.clusters) for (const m of c.members) dsIdMap.set(m.item.id, c.id);
  /** Resolve a datasheet reference that may come from a source that never emitted that id (e.g. an MFM leaderTo guess). */
  const resolveDsRef = (ref: string): string | undefined => {
    const hit = dsIdMap.get(ref);
    if (hit) return hit;
    const m = /^ds:([^:]+):(.+)$/.exec(ref);
    if (!m) return undefined;
    const nameKey = slugToNameKey(m[2] as string);
    const fid = `faction:${m[1] as string}`;
    return dsClusters.find([`fn|${factionKey(fid)}|${nameKey}`, `fam|${familyOf(fid)}|${nameKey}`, `famp|${familyOf(fid)}|${singular(nameKey)}`, ...(policy.matchAcrossFactions ? [`name|${nameKey}`] : [])])?.id;
  };

  const rulesByPart = new Map<string, Map<string, PriceRule[]>>();
  const wargearByPart = new Map<string, Map<string, WargearPrice[]>>();
  for (const part of ordered) {
    const r = new Map<string, PriceRule[]>();
    for (const rule of part.priceRules ?? []) r.set(rule.datasheetId, [...(r.get(rule.datasheetId) ?? []), rule]);
    rulesByPart.set(adapterOf(part), r);
    const w = new Map<string, WargearPrice[]>();
    for (const wp of part.wargearPrices ?? []) w.set(wp.datasheetId, [...(w.get(wp.datasheetId) ?? []), wp]);
    wargearByPart.set(adapterOf(part), w);
  }

  // ---- abilities: union with id re-keying ----------------------------------------------------
  const abilityById = new Map<string, { adapter: string; ability: Ability }>();
  const rekeyPrefix = (adapter: string, id: string, kind: "ab" | "mp" | "wp"): string => {
    // ids embed the datasheet suffix: "ab:<faction>:<unit>:<name>" -> follow the datasheet's canonical id
    const m = new RegExp(`^${kind}:(.+)$`).exec(id);
    if (!m) return id;
    const rest = m[1] as string;
    for (const [oldId, newId] of dsIdMap) {
      if (oldId === newId) continue;
      const oldSuffix = oldId.replace(/^ds:/, "");
      if (rest.startsWith(oldSuffix + ":")) return `${kind}:${newId.replace(/^ds:/, "")}${rest.slice(oldSuffix.length)}`;
    }
    void adapter;
    return id;
  };
  const rekeyCache = new Map<string, string>();
  const rekey = (adapter: string, id: string, kind: "ab" | "mp" | "wp"): string => {
    const k = `${kind}|${id}`;
    let v = rekeyCache.get(k);
    if (v === undefined) {
      v = rekeyPrefix(adapter, id, kind);
      rekeyCache.set(k, v);
    }
    return v;
  };
  for (const part of sortMembers(ordered.map((p) => ({ adapter: adapterOf(p), item: p })), T).map((m) => m.item)) {
    for (const a of part.abilities ?? []) {
      const id = rekey(adapterOf(part), a.id, "ab");
      if (abilityById.has(id)) continue;
      const ab: Ability = { ...a, id };
      if (ab.factionId) ab.factionId = canonFaction(ab.factionId) ?? ab.factionId;
      abilityById.set(id, { adapter: adapterOf(part), ability: ab });
    }
  }

  // ---- datasheets: merge ----------------------------------------------------------------------
  const datasheets: Datasheet[] = [];
  /**
   * Datasheet id -> the stratagem ids its members named. Stratagems are merged further down, so the
   * refs are kept here and resolved once their id map exists (the same two-step the detachments use).
   */
  const dsStratRefs = new Map<string, string[]>();
  const priceRules: PriceRule[] = [];
  const wargearPrices: WargearPrice[] = [];
  const statFields: (keyof ModelProfile)[] = ["M", "T", "Sv", "InvSv", "W", "Ld", "OC"];
  const weaponFields: (keyof WeaponProfile)[] = ["range", "A", "skill", "S", "AP", "D"];

  for (const c of dsClusters.clusters) {
    const id = c.id;
    const members = c.members as unknown as Member<Record<string, unknown>>[];
    const withModels = sortMembers(c.members, T).filter((m) => nonEmpty(m.item.models));
    const stats = withModels[0];
    if (!stats) {
      if (policy.dropStubs !== false) {
        for (const m of c.members) unmatched.push({ adapter: m.adapter, entity: "datasheet", id: m.item.id, name: m.item.name, reason: "no model profile in any source" });
        continue;
      }
    }
    const textFirst = sortMembers(members, T);
    const pointsFirst = sortMembers(members, P);
    const firstDefined = <R>(list: Member<Record<string, unknown>>[], get: (i: Record<string, unknown>) => R): R | undefined => {
      for (const m of list) {
        const v = get(m.item);
        if (nonEmpty(v)) return v;
      }
      return undefined;
    };
    const primary = stats ? [stats as unknown as Member<Record<string, unknown>>, ...textFirst.filter((m) => m !== (stats as unknown as Member<Record<string, unknown>>))] : textFirst;

    // a chapter (sub-faction) vs its parent is an attribution difference, not a data conflict
    const factionId = pick("datasheet", id, "factionId", members, P, (i) => canonFaction(i["factionId"] as string), { compare: (v) => familyOf(v ?? "") }) ?? canonFaction(c.members[0]!.item.factionId)!;
    const name = firstDefined(textFirst, (i) => i["name"] as string) ?? c.members[0]!.item.name;
    const gameSystemId = (c.members[0]!.item.gameSystemId as string) ?? policy.gameSystem?.id ?? "wh40k-11e";
    const models = ((firstDefined(primary, (i) => i["models"]) as ModelProfile[] | undefined) ?? []).map((m) => ({ ...m, id: rekey(stats?.adapter ?? "", m.id, "mp") }));
    const weapons = ((firstDefined(primary, (i) => i["weapons"]) as WeaponProfile[] | undefined) ?? []).map((w) => ({ ...w, id: rekey(stats?.adapter ?? "", w.id, "wp") }));
    const abilityAdapter = primary.find((m) => nonEmpty(m.item["abilityIds"]));
    const abilityIds = [...new Set(((abilityAdapter?.item["abilityIds"] as string[] | undefined) ?? []).map((x) => rekey(abilityAdapter?.adapter ?? "", x, "ab")).filter((x) => abilityById.has(x)))];

    const leaderTo = pick("datasheet", id, "leaderTo", members, P, (i) => i["leaderTo"] as string[] | undefined, { compare: (v) => resolveList(v) });
    const supportTo = pick("datasheet", id, "supportTo", members, P, (i) => i["supportTo"] as string[] | undefined, { compare: (v) => resolveList(v) });
    function resolveList(v: string[] | undefined): string[] {
      const out: string[] = [];
      for (const ref of v ?? []) {
        const r = resolveDsRef(ref);
        if (r && !out.includes(r)) out.push(r);
      }
      return out.sort();
    }
    const ds: Datasheet = {
      id,
      gameSystemId,
      factionId,
      name,
      isLegends: pick("datasheet", id, "isLegends", members, P, (i) => i["isLegends"] as boolean | undefined) ?? false,
      isCharacter: (firstDefined(primary, (i) => i["isCharacter"]) as boolean | undefined) ?? false,
      isEpicHero: (firstDefined(primary, (i) => i["isEpicHero"]) as boolean | undefined) ?? false,
      isBattleline: (firstDefined(primary, (i) => i["isBattleline"]) as boolean | undefined) ?? false,
      isSupport: c.members.some((m) => m.item.isSupport === true || (m.item.supportTo?.length ?? 0) > 0),
      keywords: (firstDefined(primary, (i) => i["keywords"]) as string[] | undefined) ?? [],
      factionKeywords: (firstDefined(primary, (i) => i["factionKeywords"]) as string[] | undefined) ?? [],
      models,
      weapons,
      abilityIds,
      stratagemIds: [],
      leaderTo: resolveList(leaderTo),
      supportTo: resolveList(supportTo),
      composition: (firstDefined(primary, (i) => i["composition"]) as Datasheet["composition"] | undefined) ?? [],
      wargearOptions: (firstDefined(primary, (i) => i["wargearOptions"]) as string[] | undefined) ?? [],
    };
    dsStratRefs.set(id, [...new Set(c.members.flatMap((m) => (m.item["stratagemIds"] as string[] | undefined) ?? []))]);
    for (const ref of [...(leaderTo ?? []), ...(supportTo ?? [])]) {
      if (!resolveDsRef(ref)) warnings.push(`datasheet ${id}: leader/support reference "${ref}" does not resolve to a known datasheet`);
    }
    const optional = <K extends keyof Datasheet>(key: K, list = primary): void => {
      const v = firstDefined(list, (i) => i[key as string]) as Datasheet[K] | undefined;
      if (v !== undefined) (ds as Record<string, unknown>)[key] = v;
    };
    optional("role");
    optional("transportCapacity");
    optional("loadout");
    optional("damagedProfile");
    optional("sourceId");

    // stat / weapon conflicts against the other sources that carry profiles
    if (stats) {
      for (const other of withModels.slice(1)) {
        const om = new Map((other.item.models ?? []).map((m) => [normaliseName(m.name), m]));
        for (const mine of models) {
          const theirs = om.get(normaliseName(mine.name)) ?? (models.length === 1 && (other.item.models?.length ?? 0) === 1 ? other.item.models![0] : undefined);
          if (!theirs) continue;
          for (const f of statFields) conflict("datasheet", id, `models[${mine.name}].${f}`, mine[f] ?? null, [{ adapter: stats.adapter, value: mine[f] ?? null }, { adapter: other.adapter, value: theirs[f] ?? null }]);
        }
        const ow = new Map((other.item.weapons ?? []).map((w) => [`${w.kind}|${normaliseName(w.name)}`, w]));
        for (const mine of weapons) {
          const theirs = ow.get(`${mine.kind}|${normaliseName(mine.name)}`);
          if (!theirs) continue;
          for (const f of weaponFields) conflict("datasheet", id, `weapons[${mine.name}].${f}`, norm(mine[f]), [{ adapter: stats.adapter, value: norm(mine[f]) }, { adapter: other.adapter, value: norm(theirs[f]) }]);
          const kw = (w: WeaponProfile): string[] => w.keywords.map((k) => `${k.name}${k.keyword ? "-" + k.keyword : ""}${k.value !== undefined ? " " + String(k.value).toUpperCase() : ""}`).sort();
          conflict("datasheet", id, `weapons[${mine.name}].keywords`, kw(mine), [{ adapter: stats.adapter, value: kw(mine) }, { adapter: other.adapter, value: kw(theirs) }]);
        }
      }
    }

    // points
    const ruleSets = pointsFirst.map((m) => ({ adapter: m.adapter, rules: rulesByPart.get(m.adapter)?.get(m.item["id"] as string) ?? [] })).filter((x) => x.rules.length);
    const chosenRules = ruleSets[0];
    if (chosenRules) {
      for (const r of chosenRules.rules) priceRules.push({ ...r, datasheetId: id });
      conflict("datasheet", id, "points", ruleSig(chosenRules.rules), ruleSets.map((x) => ({ adapter: x.adapter, value: ruleSig(x.rules) })));
    }
    const wgSets = pointsFirst.map((m) => ({ adapter: m.adapter, items: wargearByPart.get(m.adapter)?.get(m.item["id"] as string) ?? [] })).filter((x) => x.items.length);
    const chosenWg = wgSets[0];
    if (chosenWg) {
      for (const w of chosenWg.items) wargearPrices.push({ ...w, datasheetId: id });
      conflict("datasheet", id, "wargearPrices", wgSig(chosenWg.items), wgSets.map((x) => ({ adapter: x.adapter, value: wgSig(x.items) })));
    }
    const fp = pick("datasheet", id, "fallbackPoints", members, P, (i) => i["fallbackPoints"] as number | undefined, { silent: true });
    const derived = chosenRules ? firstCopyPoints(chosenRules.rules) : undefined;
    if (derived !== undefined) ds.fallbackPoints = derived;
    else if (fp !== undefined) ds.fallbackPoints = fp;

    datasheets.push(ds);
  }

  // ---- detachments ----------------------------------------------------------------------------
  const detClusters = new ClusterIndex<Detachment>();
  const detKeys = (d: Detachment): string[] => {
    const n = normaliseName(d.name);
    return [`id|${d.id}`, `fn|${factionKey(d.factionId)}|${n}`, `fam|${familyOf(d.factionId)}|${n}`];
  };
  for (const part of ordered) for (const d of part.detachments ?? []) detClusters.add(adapterOf(part), d, detKeys(d));
  detClusters.dedupeWithinFamily(
    (d) => `${familyOf(d.factionId)}|${normaliseName(d.name)}`,
    (d) => familyOf(d.factionId) === `faction:${factionKey(d.factionId)}`,
  );
  const detIdMap = new Map<string, string>();
  for (const c of detClusters.clusters) for (const m of c.members) detIdMap.set(m.item.id, c.id);

  // ---- enhancements ---------------------------------------------------------------------------
  const enhClusters = new ClusterIndex<Enhancement>();
  const detFaction = new Map<string, string>();
  for (const part of ordered) for (const d of part.detachments ?? []) detFaction.set(d.id, d.factionId);
  const enhKeys = (e: Enhancement): string[] => {
    const n = normaliseName(e.name);
    const fid = detFaction.get(e.detachmentId) ?? "";
    const det = normaliseName((detIdMap.get(e.detachmentId) ?? e.detachmentId).replace(/^det:[^:]+:/, "").replace(/-/g, " "));
    return [`fdn|${factionKey(fid)}|${det}|${n}`, `id|${e.id}`, `fdnf|${familyOf(fid)}|${det}|${n}`, `fn|${factionKey(fid)}|${n}`, `fam|${familyOf(fid)}|${n}`];
  };
  for (const part of ordered) for (const e of part.enhancements ?? []) enhClusters.add(adapterOf(part), e, enhKeys(e));
  const enhFaction = (e: Enhancement): string => detFaction.get(e.detachmentId) ?? "";
  enhClusters.dedupeWithinFamily(
    (e) => `${familyOf(enhFaction(e))}|${detIdMap.get(e.detachmentId) ?? e.detachmentId}|${normaliseName(e.name)}`,
    (e) => familyOf(enhFaction(e)) === `faction:${factionKey(enhFaction(e))}`,
  );
  const enhIdMap = new Map<string, string>();
  for (const c of enhClusters.clusters) for (const m of c.members) enhIdMap.set(m.item.id, c.id);
  const enhancements: Enhancement[] = [];
  for (const c of enhClusters.clusters) {
    const members = c.members as unknown as Member<Record<string, unknown>>[];
    const detachmentId = sortMembers(c.members, P).map((m) => detIdMap.get(m.item.detachmentId)).find((x): x is string => !!x) ?? c.members[0]!.item.detachmentId;
    const e: Enhancement = {
      id: c.id,
      detachmentId,
      name: sortMembers(c.members, T)[0]!.item.name,
      cost: pick("enhancement", c.id, "cost", members, P, (i) => ((i["cost"] as number) > 0 ? (i["cost"] as number) : undefined)) ?? 0,
      text: pick("enhancement", c.id, "text", members, T, (i) => i["text"] as string | undefined, { silent: true }) ?? "",
      supportOnly: c.members.some((m) => m.item.supportOnly),
      isLegends: c.members.some((m) => m.item.isLegends),
    };
    const restrictions = pick("enhancement", c.id, "restrictions", members, T, (i) => i["restrictions"] as string | undefined, { silent: true });
    if (restrictions) e.restrictions = restrictions;
    const abilityId = pick("enhancement", c.id, "abilityId", members, T, (i) => i["abilityId"] as string | undefined, { silent: true });
    if (abilityId) e.abilityId = rekey("", abilityId, "ab");
    enhancements.push(e);
  }

  // ---- stratagems -----------------------------------------------------------------------------
  const stratClusters = new ClusterIndex<Stratagem>();
  for (const part of ordered) {
    for (const s of part.stratagems ?? []) {
      const n = normaliseName(s.name);
      const fid = s.factionId ? factionKey(s.factionId) : "core";
      const det = s.detachmentId ? detIdMap.get(s.detachmentId) ?? s.detachmentId : "";
      stratClusters.add(adapterOf(part), s, [`id|${s.id}`, `fdn|${fid}|${det}|${n}`]);
    }
  }
  const stratIdMap = new Map<string, string>();
  for (const c of stratClusters.clusters) for (const m of c.members) stratIdMap.set(m.item.id, c.id);
  const stratagems: Stratagem[] = [];
  for (const c of stratClusters.clusters) {
    const members = c.members as unknown as Member<Record<string, unknown>>[];
    const first = sortMembers(c.members, T)[0]!.item;
    const s: Stratagem = { ...first, id: c.id, cpCost: pick("stratagem", c.id, "cpCost", members, P, (i) => i["cpCost"] as number | undefined) ?? first.cpCost };
    if (s.factionId) s.factionId = canonFaction(s.factionId) ?? s.factionId;
    if (s.detachmentId) s.detachmentId = detIdMap.get(s.detachmentId) ?? s.detachmentId;
    if (s.abilityId) s.abilityId = rekey("", s.abilityId, "ab");
    stratagems.push(s);
  }

  // Datasheet -> stratagem links, now that the merged stratagem ids are known.
  const stratagemIdSet = new Set(stratagems.map((s) => s.id));
  for (const ds of datasheets) {
    const refs = dsStratRefs.get(ds.id) ?? [];
    ds.stratagemIds = [...new Set(refs.map((x) => stratIdMap.get(x) ?? x))].filter((x) => stratagemIdSet.has(x));
  }

  const detachments: Detachment[] = [];
  for (const c of detClusters.clusters) {
    const members = c.members as unknown as Member<Record<string, unknown>>[];
    const factionId = pick("detachment", c.id, "factionId", members, P, (i) => canonFaction(i["factionId"] as string), { silent: true }) ?? canonFaction(c.members[0]!.item.factionId)!;
    const d: Detachment = {
      id: c.id,
      factionId,
      name: sortMembers(c.members, T)[0]!.item.name,
      dp: pick("detachment", c.id, "dp", members, P, (i) => i["dp"] as number | undefined) ?? 1,
      forceDispositions: pick("detachment", c.id, "forceDispositions", members, P, (i) => i["forceDispositions"] as string[] | undefined, { compare: (v) => [...(v ?? [])].map((x) => x.toUpperCase()).sort() }) ?? [],
      ruleAbilityIds: [...new Set((sortMembers(c.members, T).find((m) => m.item.ruleAbilityIds.length)?.item.ruleAbilityIds ?? []).map((x) => rekey("", x, "ab")).filter((x) => abilityById.has(x)))],
      enhancementIds: [...new Set(c.members.flatMap((m) => m.item.enhancementIds.map((x) => enhIdMap.get(x) ?? x)))].filter((x) => enhancements.some((e) => e.id === x)),
      stratagemIds: [...new Set(c.members.flatMap((m) => m.item.stratagemIds.map((x) => stratIdMap.get(x) ?? x)))].filter((x) => stratagems.some((s) => s.id === x)),
    };
    const uniqueTag = pick("detachment", c.id, "uniqueTag", members, P, (i) => i["uniqueTag"] as string | undefined, { compare: (v) => (v ?? "").toLowerCase() });
    if (uniqueTag) d.uniqueTag = uniqueTag;
    detachments.push(d);
    if (parts.length > 1 && c.members.length === 1 && c.members[0]!.adapter !== P[0]) {
      unmatched.push({ adapter: c.members[0]!.adapter, entity: "detachment", id: c.id, name: d.name, reason: "not found in the points authority" });
    }
  }

  // ---- abilities: keep only referenced ones ---------------------------------------------------
  const referenced = new Set<string>();
  for (const d of datasheets) for (const x of d.abilityIds) referenced.add(x);
  for (const d of detachments) for (const x of d.ruleAbilityIds) referenced.add(x);
  for (const e of enhancements) if (e.abilityId) referenced.add(e.abilityId);
  for (const s of stratagems) if (s.abilityId) referenced.add(s.abilityId);
  const abilities: Ability[] = [];
  let pruned = 0;
  for (const [id, { ability }] of abilityById) {
    if (referenced.has(id)) abilities.push(ability);
    else pruned++;
  }
  if (pruned) warnings.push(`${pruned} unreferenced abilities pruned`);

  // ---- publications & game system -------------------------------------------------------------
  const publications: Publication[] = [];
  const seenPub = new Set<string>();
  for (const part of ordered) {
    for (const p of part.publications ?? []) {
      if (!seenPub.has(p.id)) {
        seenPub.add(p.id);
        publications.push(p);
      }
    }
  }
  const gameSystem: GameSystem = policy.gameSystem ?? sortMembers(ordered.map((p) => ({ adapter: adapterOf(p), item: p })), T).map((m) => m.item.gameSystem).find((g): g is GameSystem => !!g) ?? {
    id: datasheets[0]?.gameSystemId ?? "wh40k-11e",
    name: "Warhammer 40,000",
    edition: "11",
    costTypes: [],
  };

  if (unmatched.length) {
    const byAdapter = new Map<string, number>();
    for (const u of unmatched) byAdapter.set(u.adapter, (byAdapter.get(u.adapter) ?? 0) + 1);
    warnings.push(`${unmatched.length} unmatched entities (${[...byAdapter].map(([a, n]) => `${a}: ${n}`).join(", ")})`);
  }

  return {
    data: { gameSystem, factions, publications, datasheets, abilities, detachments, enhancements, stratagems, priceRules, wargearPrices },
    conflicts,
    warnings,
    unmatched,
  };
}

function norm(v: unknown): unknown {
  return typeof v === "string" ? v.toUpperCase().replace(/\s+/g, "") : v ?? null;
}

function ruleSig(rules: PriceRule[]): string {
  return [...rules]
    .sort((a, b) => a.copyRange.min - b.copyRange.min)
    .map((r) => `[${r.copyRange.min},${r.copyRange.max ?? ""}]${[...r.tiers].sort((a, b) => a.models - b.models).map((t) => `${t.models}:${t.points}`).join(",")}`)
    .join(" | ");
}

function wgSig(items: WargearPrice[]): string {
  return [...items]
    .map((w) => `${normaliseName(w.item)}:${w.points}`)
    .sort()
    .join(", ");
}

function firstCopyPoints(rules: PriceRule[]): number | undefined {
  const first = [...rules].filter((r) => r.copyRange.min <= 1).sort((a, b) => a.copyRange.min - b.copyRange.min)[0] ?? rules[0];
  const tier = first ? [...first.tiers].sort((a, b) => a.models - b.models)[0] : undefined;
  return tier?.points;
}
