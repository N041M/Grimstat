import type { Ability, Conflict, Datasheet, Detachment, Enhancement, Faction, GameSystem, GlossaryEntry, ModelProfile, PriceRule, PriceTier, Publication, SnapshotData, SourceRef, Stratagem, WargearPrice, WeaponProfile } from "@grimstat/schema";
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
  /**
   * Adapter ids in order of authority for points, Detachment Points, unique tags and leader/support
   * lists. A points table is the one field that does not simply take the first of these that has a
   * value. See `fullestRules`.
   */
  pointsPrecedence: string[];
  /** Adapter ids in order of authority for stats, weapons, abilities, keywords and rules text. */
  textPrecedence: string[];
  /** Per adapter, fields whose values are placeholders (used only when nobody else has a value, and not reported as conflicts). */
  untrusted?: Record<string, string[]>;
  /**
   * Adapter ids whose points table this importer reconstructs from a rules engine instead of reading
   * a table the source publishes. See `boundToPublishedSizes` for what that costs them.
   */
  derivedPoints?: string[];
  /** Also join datasheets by name across unrelated factions when the name is globally unique (default false). */
  matchAcrossFactions?: boolean;
  /** Drop datasheets that end up without a model profile (default true). When false they are kept with a placeholder profile. */
  dropStubs?: boolean;
  gameSystem?: GameSystem;
}

export const DEFAULT_MERGE_POLICY: MergePolicy = {
  pointsPrecedence: ["mfm-yaml", "bsdata-json", "wahapedia-csv"],
  textPrecedence: ["wahapedia-csv", "bsdata-json", "mfm-yaml"],
  untrusted: { "wahapedia-csv": ["detachment.dp"] },
  derivedPoints: ["bsdata-json"],
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

/**
 * Deep copy of the plain data an adapter emitted. Fields taken from a single source were handed on by
 * reference, which left the merged snapshot sharing arrays and objects with the parts it was built
 * from. Editing either one would then change the other.
 */
function copy<T>(v: T): T {
  if (Array.isArray(v)) return v.map((x) => copy(x)) as T;
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v)) out[k] = copy((v as Record<string, unknown>)[k]);
    return out as T;
  }
  return v;
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
    // A source that calls an army by its catalogue or keyword name ("Adeptus Astartes - Blood
    // Angels", "Asuryani") reaches this faction through an alias, and the name it came with is not
    // the army's. A member whose own name lands on this faction without one is preferred, so the
    // codex name is what the screens show.
    const ownName = sortMembers(c.members, T)
      .map((m) => m.item.name)
      .find((n) => `faction:${normaliseName(n).replace(/\s+/g, "-")}` === c.id);
    const name = ownName ?? pick("faction", c.id, "name", members, T, (i) => i["name"] as string, { silent: true }) ?? c.id;
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

  /**
   * The member that carries the profiles of a unit name within one faction family.
   *
   * A chapter publishes its own points for units it shares with its parent codex, and the sources
   * that carry profiles file those units under the parent alone, so the chapter's datasheet reaches
   * the merge with a points table and nothing else. Dropping it as a stub leaves a chapter army
   * buying the parent's datasheet at the parent's points.
   */
  const familyProfiles = new Map<string, Member<PartialDatasheet>>();
  for (const c of dsClusters.clusters) {
    const m = sortMembers(c.members, T).find((x) => nonEmpty(x.item.models));
    if (!m) continue;
    const key = `${familyOf(m.item.factionId)}|${normaliseName(m.item.name)}`;
    if (!familyProfiles.has(key)) familyProfiles.set(key, m);
  }
  /** The donor's profiles under the adopting datasheet's own id, so that profile ids stay unique. */
  const adoptProfiles = (donor: Member<PartialDatasheet>, id: string): Member<PartialDatasheet> => {
    const from = donor.item.id.replace(/^ds:/, "");
    const to = id.replace(/^ds:/, "");
    const under = <X extends { id: string }>(kind: "mp" | "wp", x: X): X => ({ ...x, id: x.id.includes(from) ? x.id.replace(from, to) : `${kind}:${to}:${x.id}` });
    const item = copy(donor.item);
    return { adapter: donor.adapter, item: { ...item, models: (item.models ?? []).map((m) => under("mp", m)), weapons: (item.weapons ?? []).map((w) => under("wp", w)) } };
  };

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
      const ab: Ability = { ...copy(a), id };
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
    const donor = withModels.length ? undefined : familyProfiles.get(`${familyOf(c.members[0]!.item.factionId)}|${normaliseName(c.members[0]!.item.name)}`);
    if (donor) warnings.push(`datasheet ${id} ("${c.members[0]!.item.name}") has no model profile in any source; it took the profiles of ${donor.item.id}, so the points it publishes apply.`);
    const stats = withModels[0] ?? (donor ? adoptProfiles(donor, id) : undefined);
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
    if (!models.length) {
      // `dropStubs: false` keeps points-only datasheets, and the schema requires one profile per datasheet.
      models.push({ id: `mp:${id.replace(/^ds:/, "")}:unknown`, name, T: 1, Sv: 7, W: 1 });
      warnings.push(`datasheet ${id} ("${name}") has no model profile in any source; a placeholder profile was added`);
    }
    const weapons = ((firstDefined(primary, (i) => i["weapons"]) as WeaponProfile[] | undefined) ?? []).map((w) => ({ ...copy(w), id: rekey(stats?.adapter ?? "", w.id, "wp") }));
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
      keywords: copy((firstDefined(primary, (i) => i["keywords"]) as string[] | undefined) ?? []),
      factionKeywords: copy((firstDefined(primary, (i) => i["factionKeywords"]) as string[] | undefined) ?? []),
      models,
      weapons,
      abilityIds,
      stratagemIds: [],
      leaderTo: resolveList(leaderTo),
      supportTo: resolveList(supportTo),
      composition: copy((firstDefined(primary, (i) => i["composition"]) as Datasheet["composition"] | undefined) ?? []),
      wargearOptions: copy((firstDefined(primary, (i) => i["wargearOptions"]) as string[] | undefined) ?? []),
    };
    dsStratRefs.set(id, [...new Set(primary.flatMap((m) => (m.item["stratagemIds"] as string[] | undefined) ?? []))]);
    for (const ref of [...(leaderTo ?? []), ...(supportTo ?? [])]) {
      if (!resolveDsRef(ref)) warnings.push(`datasheet ${id}: leader/support reference "${ref}" does not resolve to a known datasheet`);
    }
    const optional = <K extends keyof Datasheet>(key: K, list = primary): void => {
      const v = firstDefined(list, (i) => i[key as string]) as Datasheet[K] | undefined;
      if (v !== undefined) (ds as Record<string, unknown>)[key] = copy(v);
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
    const candidates = boundToPublishedSizes(ruleSets, policy.derivedPoints ?? [], (dropped, adapter) => warnings.push(droppedRowWarning(id, name, adapter, dropped)));
    const chosenRules = fullestRules(candidates);
    if (chosenRules) {
      for (const r of chosenRules.rules) priceRules.push({ ...copy(r), datasheetId: id });
      conflict("datasheet", id, "points", ruleSig(chosenRules.rules), candidates.map((x) => ({ adapter: x.adapter, value: ruleSig(x.rules) })));
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
    const s: Stratagem = {
      id: c.id,
      name: first.name,
      cpCost: pick("stratagem", c.id, "cpCost", members, P, (i) => i["cpCost"] as number | undefined) ?? first.cpCost,
      phases: copy(pick("stratagem", c.id, "phases", members, T, (i) => i["phases"] as string[] | undefined, { silent: true }) ?? []),
    };
    /** A source that carries the rules text often omits the attribution ids, and the other way round. */
    const optional = <K extends keyof Stratagem>(key: K, order: string[]): void => {
      const v = pick("stratagem", c.id, key, members, order, (i) => i[key] as Stratagem[K] | undefined, { silent: true });
      if (v !== undefined) (s as Record<string, unknown>)[key] = v;
    };
    optional("factionId", P);
    optional("detachmentId", P);
    optional("type", T);
    optional("turn", T);
    optional("when", T);
    optional("target", T);
    optional("effect", T);
    optional("restrictions", T);
    optional("text", T);
    optional("abilityId", T);
    if (s.factionId) s.factionId = canonFaction(s.factionId) ?? s.factionId;
    if (s.detachmentId) s.detachmentId = detIdMap.get(s.detachmentId) ?? s.detachmentId;
    if (s.abilityId) s.abilityId = rekey("", s.abilityId, "ab");
    stratagems.push(s);
  }

  // A cluster dropped for want of a model profile can still be named by another datasheet's leader
  // or support list, so those lists are filtered once every kept datasheet is known. This is the
  // same second pass the stratagem links below use.
  const keptDatasheets = new Set(datasheets.map((d) => d.id));
  for (const d of datasheets) {
    for (const ref of [...d.leaderTo, ...d.supportTo]) {
      if (!keptDatasheets.has(ref)) warnings.push(`datasheet ${d.id}: leader/support reference "${ref}" names a datasheet no source describes, so it was dropped.`);
    }
    d.leaderTo = d.leaderTo.filter((x) => keptDatasheets.has(x));
    d.supportTo = d.supportTo.filter((x) => keptDatasheets.has(x));
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
      forceDispositions: copy(pick("detachment", c.id, "forceDispositions", members, P, (i) => i["forceDispositions"] as string[] | undefined, { compare: (v) => [...(v ?? [])].map((x) => x.toUpperCase()).sort() }) ?? []),
      ruleAbilityIds: [...new Set((sortMembers(c.members, T).find((m) => m.item.ruleAbilityIds.length)?.item.ruleAbilityIds ?? []).map((x) => rekey("", x, "ab")).filter((x) => abilityById.has(x)))],
      enhancementIds: [...new Set(c.members.flatMap((m) => m.item.enhancementIds.map((x) => enhIdMap.get(x) ?? x)))].filter((x) => enhancements.some((e) => e.id === x)),
      stratagemIds: [...new Set(c.members.flatMap((m) => m.item.stratagemIds.map((x) => stratIdMap.get(x) ?? x)))].filter((x) => stratagems.some((s) => s.id === x)),
    };
    const uniqueTag = pick("detachment", c.id, "uniqueTag", members, P, (i) => i["uniqueTag"] as string | undefined, { compare: (v) => (v ?? "").toLowerCase() });
    if (uniqueTag) d.uniqueTag = uniqueTag;
    detachments.push(d);
    const only = c.members.length === 1 ? c.members[0]!.adapter : undefined;
    if (parts.length > 1 && only && only !== P[0]) {
      unmatched.push({ adapter: only, entity: "detachment", id: c.id, name: d.name, reason: "not found in the points authority" });
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
        publications.push(copy(p));
      }
    }
  }
  // ---- glossary -------------------------------------------------------------------------------
  // One entry per keyword, taken from whichever source ranks highest for rules text and has one.
  const glossary: GlossaryEntry[] = [];
  const seenRule = new Set<string>();
  for (const part of sortMembers(ordered.map((p) => ({ adapter: adapterOf(p), item: p })), T).map((m) => m.item)) {
    for (const g of part.glossary ?? []) {
      if (seenRule.has(g.key)) continue;
      seenRule.add(g.key);
      glossary.push(copy(g));
    }
  }

  const declared = sortMembers(ordered.map((p) => ({ adapter: adapterOf(p), item: p })), T).map((m) => m.item.gameSystem).find((g): g is GameSystem => !!g);
  const gameSystem: GameSystem = copy(policy.gameSystem ?? declared ?? { id: datasheets[0]?.gameSystemId ?? "wh40k-11e", name: "Warhammer 40,000", edition: "11", costTypes: [] });

  if (unmatched.length) {
    const byAdapter = new Map<string, number>();
    for (const u of unmatched) byAdapter.set(u.adapter, (byAdapter.get(u.adapter) ?? 0) + 1);
    warnings.push(`${unmatched.length} unmatched entities (${[...byAdapter].map(([a, n]) => `${a}: ${n}`).join(", ")})`);
  }

  return {
    data: { gameSystem, factions, publications, datasheets, abilities, detachments, enhancements, stratagems, priceRules, wargearPrices, ...(glossary.length ? { glossary } : {}) },
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
  const first = firstBand(rules);
  const tier = first ? [...first.tiers].sort((a, b) => a.models - b.models)[0] : undefined;
  return tier?.points;
}

/** The band that prices the first copy of the unit. */
function firstBand(rules: PriceRule[]): PriceRule | undefined {
  return [...rules].filter((r) => r.copyRange.min <= 1).sort((a, b) => a.copyRange.min - b.copyRange.min)[0] ?? rules[0];
}

/** One row per (copy band, model count), which is how the datasheet prints its points table. */
function rowCount(rules: PriceRule[]): number {
  return rules.reduce((n, r) => n + r.tiers.length, 0);
}

/**
 * A rule set of one open band gives a base price and records nothing about what later copies cost.
 * Every BSData table reaching the merge has that shape, because this importer reads only the
 * model-count thresholds in a catalogue and not the modifiers carrying its Requisition Thresholds.
 */
function unbanded(rules: PriceRule[]): boolean {
  const only = rules.length === 1 ? rules[0]! : undefined;
  return !!only && only.copyRange.min === 1 && only.copyRange.max === undefined;
}

function prices(rule: PriceRule, models: number, points: number): boolean {
  return rule.tiers.some((t) => t.models === models && t.points === points);
}

/**
 * Does `fuller` price every row `rules` prices, at the same points, and carry rows of its own?
 *
 * Two sources whose tables agree on every size they share are not in disagreement. One of them has
 * simply printed more sizes, or split the copies into bands the other did not.
 *
 * When the smaller table is un-banded, only the first band of `fuller` has to repeat its prices. An
 * un-banded table says nothing about what later copies cost, so a banded table that starts from the
 * same base price adds to it. A banded table is compared band for band, because a source that has
 * bands and prices copies 3 and up differently is making a claim the other one contradicts.
 */
function subsumes(fuller: PriceRule[], rules: PriceRule[]): boolean {
  if (rowCount(fuller) <= rowCount(rules)) return false;
  if (unbanded(rules)) {
    const base = firstBand(fuller);
    return !!base && rules[0]!.tiers.every((t) => prices(base, t.models, t.points));
  }
  return rules.every((r) => fuller.some((f) => f.copyRange.min === r.copyRange.min && f.copyRange.max === r.copyRange.max && r.tiers.every((t) => prices(f, t.models, t.points))));
}

function droppedRowWarning(id: string, name: string, adapter: string, dropped: PriceTier[]): string {
  const rows = dropped.map((t) => `${t.models} model${t.models === 1 ? "" : "s"} at ${t.points}`).join(" and ");
  const many = dropped.length > 1;
  return `datasheet ${id} ("${name}"): ${adapter} prices ${rows}. No published points table lists ${many ? "those sizes" : "that size"}, so the ${many ? "rows were" : "row was"} dropped.`;
}

/**
 * Drops rows from a derived table for model counts no published table lists.
 *
 * MFM and Wahapedia transcribe the table printed on the datasheet, so the sizes they price are every
 * size the unit has. BSData publishes no table. It is a constraint system, where a unit costs a base
 * price and a modifier raises it once the unit holds at least N models, and this importer replays
 * those modifiers to reconstruct a table. A builder that evaluates the catalogue instead, which is
 * what BattleScribe and New Recruit do, never reaches a modifier whose threshold the unit's own
 * constraints forbid. Replaying the modifiers on their own does reach it, and writes down a
 * price for a unit nobody can field. Emperor's Children Chaos Terminators are a fixed five models
 * and BSData carries a threshold at six, so the reconstruction invented a 6-model price of 360.
 *
 * The bound cannot come from the unit composition, which is wrong often enough to delete real rows.
 * Wahapedia's composition for the Tarantula Sentry Battery reads "1 Tarantula Sentry Battery" while
 * its own table prices 1, 2 and 3 models, and Wolf Scouts records two alternative compositions of 6
 * and 12 models that read back as one maximum of 10. Six datasheets in the current data price a size
 * above the composition they carry, and every one of them is the composition being wrong rather than
 * the price. The set of sizes a published table prices is the reliable bound, because that table is
 * what a player reads the price off.
 *
 * So a derived table may still add copy bands, and it is used whole when no published table covers
 * the datasheet. It may not introduce a model count the published tables do not have.
 */
function boundToPublishedSizes<T extends { adapter: string; rules: PriceRule[] }>(candidates: T[], derived: string[], onDrop: (dropped: PriceTier[], adapter: string) => void): T[] {
  const published = new Set(candidates.filter((c) => !derived.includes(c.adapter)).flatMap((c) => c.rules.flatMap((r) => r.tiers.map((t) => t.models))));
  if (!published.size) return candidates;
  const out: T[] = [];
  for (const c of candidates) {
    if (!derived.includes(c.adapter)) {
      out.push(c);
      continue;
    }
    const dropped = c.rules.flatMap((r) => r.tiers.filter((t) => !published.has(t.models)));
    if (!dropped.length) {
      out.push(c);
      continue;
    }
    onDrop(dropped, c.adapter);
    const rules = c.rules.map((r) => ({ ...r, tiers: r.tiers.filter((t) => published.has(t.models)) })).filter((r) => r.tiers.length);
    if (rules.length) out.push({ ...c, rules });
  }
  return out;
}

/**
 * The rule set the snapshot stores, out of the candidates in points precedence order.
 *
 * Precedence is the right rule when two sources price the same size in the same copy band
 * differently. The points authority wins and the merge records the conflict. It is the wrong rule
 * when the authority's table is a subset of another source's. Taking the authority's table whole
 * drops the rows only the other source has, and a unit at that size then has no price at all, so the
 * army can pass a points limit while being hundreds of points over.
 *
 * A candidate that prices everything the current pick prices and adds rows of its own is therefore
 * preferred, and the search repeats until no candidate is fuller still. Every step adds rows, so it
 * ends.
 *
 * The other way to write this was a per-field merge that keeps the authority's rows and fills in the
 * missing ones. Two sources band copies differently, so that produces overlapping bands no source
 * published, which the resolver then has to settle by specificity. Taking one candidate whole keeps
 * the stored table the same table a reader can look up on the datasheet.
 */
function fullestRules<T extends { rules: PriceRule[] }>(candidates: T[]): T | undefined {
  let best = candidates[0];
  if (!best) return undefined;
  for (;;) {
    const fuller = candidates.find((c) => c !== best && subsumes(c.rules, best!.rules));
    if (!fuller) return best;
    best = fuller;
  }
}
