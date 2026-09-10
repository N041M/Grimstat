import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { normaliseName } from "@grimstat/snapshot";

/**
 * Tolerant army-list text importer. Understands:
 * - Grimstat's own GW-app-style and NR-tournament-style exports (see text.ts)
 * - New Recruit "tournament" exports (`+ FACTION KEYWORD: …` header block, `Char1: 2x Unit (415 pts): …`,
 *   bullet model lines `• 9x Battle Sister: 9 with Bolt pistol, …`, `Enhancement: X (+15 pts)`)
 * - 10th-edition-style GW app text (`Unit (80 points)` + `• 1x Wargear` lines)
 */

const SIZE_BY_LABEL: Record<string, Roster["battleSize"]> = { "combat patrol": "combat-patrol", incursion: "incursion", "strike force": "strike-force", onslaught: "onslaught" };
const SECTION_NAMES = new Set(["characters", "battleline", "dedicated transports", "other datasheets", "allied units", "epic heroes", "infantry", "mounted", "vehicles", "monsters", "fortifications", "swarms", "beasts", "aircraft"]);

interface Group {
  modelProfileId: string;
  count: number;
  wargear: string[];
}

interface PendingUnit {
  id: string;
  ref?: string; // "Char1"
  ds: Datasheet;
  name: string;
  headerCount?: number;
  groups: Group[];
  warlord: boolean;
  enhancementName?: string;
  attach?: { hostName: string; role: "leader" | "support" };
}

const BULLET = /^[•◦▪\-*]\s*/;
/** `Char1: 2x Canis Rex (415 pts): Warlord` / `10x Squad (110 pts)` / `Unit (80 points)` / `Unit [80pts]: …` */
const UNIT_HEADER = /^(?:([A-Za-z]+\d+):\s*)?(?:(\d+)\s*[x×]\s+)?(.+?)\s*(?:\((\d+)\s*(?:points|pts)\)|\[(\d+)\s*pts\])\s*(?::\s*(.*))?$/i;
const COUNT_ITEM = /^(\d+)\s*[x×]\s+(.+)$/i;

export function splitList(text: string): string[] {
  return text
    .split(/,\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** "9 with Bolt pistol, Boltgun" → items; "2x Twin meltagun" → the item twice (multiplicity matters for shooting). */
export function parseWargearList(text: string): string[] {
  const out: string[] = [];
  const segments = text.trim().split(/,\s*(?=\d+\s+with\s)/i);
  for (const seg of segments) {
    const body = seg.trim().replace(/^\d+\s+with\s+/i, "");
    for (const item of splitList(body)) {
      const m = /^(\d+)\s*[x×]\s+(.+)$/.exec(item);
      if (m) for (let i = 0; i < Math.max(1, Math.min(20, Number(m[1]))); i++) out.push(m[2]!.trim());
      else out.push(item);
    }
  }
  return out;
}

function tokens(s: string): string[] {
  return normaliseName(s).split(" ").filter((t) => t && t !== "of" && t !== "the");
}

export function importRosterText(text: string, snapshot: Snapshot, opts: { name?: string } = {}): { roster: Roster; warnings: string[] } {
  const warnings: string[] = [];
  const now = new Date().toISOString();
  const factions = snapshot.data.factions;
  const factionByKey = new Map(factions.map((f) => [normaliseName(f.name), f] as const));
  const dsByKey = new Map<string, Datasheet[]>();
  for (const d of snapshot.data.datasheets) {
    const k = normaliseName(d.name);
    dsByKey.set(k, [...(dsByKey.get(k) ?? []), d]);
  }
  let name = opts.name ?? "";
  let factionId: string | undefined;
  let battleSize: Roster["battleSize"] | undefined;
  let pointsLimit: number | undefined;
  let totalPoints: number | undefined;
  let forceDisposition: string | undefined;
  let warlordRef: string | undefined;
  const detachments: Roster["detachments"] = [];
  const units: PendingUnit[] = [];
  const st: { cur: PendingUnit | null } = { cur: null };
  let headerSeen = false;

  const setFaction = (label: string): boolean => {
    const candidates = [label, ...label.split(/\s+[-–—]\s+/).reverse()];
    for (const c of candidates) {
      const f = factionByKey.get(normaliseName(c));
      if (f) {
        factionId = f.id;
        return true;
      }
    }
    return false;
  };

  const findDatasheet = (label: string): Datasheet | undefined => {
    const key = normaliseName(label);
    const pick = (cands: Datasheet[]) => cands.find((d) => d.factionId === factionId) ?? cands[0];
    const exact = dsByKey.get(key);
    if (exact?.length) return pick(exact);
    // token-set equality ("Sisters of Battle Squad" ~ "Battle Sisters Squad")
    const want = [...new Set(tokens(label))].sort().join(" ");
    const tokenHits = snapshot.data.datasheets.filter((d) => [...new Set(tokens(d.name))].sort().join(" ") === want);
    if (tokenHits.length) return pick(tokenHits);
    // containment: the longest datasheet name contained in the label, or the label contained in a datasheet name
    const contained = snapshot.data.datasheets.filter((d) => {
      const dk = normaliseName(d.name);
      return dk.length >= 5 && (key.includes(dk) || dk.includes(key));
    });
    if (contained.length) {
      const inFaction = contained.filter((d) => d.factionId === factionId);
      const pool = inFaction.length ? inFaction : contained;
      return pool.sort((a, b) => b.name.length - a.name.length)[0];
    }
    return undefined;
  };

  const addDetachment = (label: string) => {
    const clean = label.replace(/\s*\([^)]*\)\s*$/, "").trim();
    const key = normaliseName(clean);
    const det = snapshot.data.detachments.find((d) => normaliseName(d.name) === key && (!factionId || d.factionId === factionId)) ?? snapshot.data.detachments.find((d) => normaliseName(d.name) === key);
    if (!det) {
      warnings.push(`Unknown detachment "${clean}".`);
      return;
    }
    if (!factionId) factionId = det.factionId;
    if (detachments.some((d) => d.detachmentId === det.id)) return;
    const entry: Roster["detachments"][number] = { id: `d${detachments.length + 1}`, detachmentId: det.id };
    if (forceDisposition) entry.forceDisposition = forceDisposition;
    detachments.push(entry);
  };

  const profileFor = (ds: Datasheet, label: string) => {
    const key = normaliseName(label);
    return ds.models.find((m) => normaliseName(m.name) === key) ?? ds.models.find((m) => tokens(m.name).sort().join() === tokens(label).sort().join());
  };

  const applyFlag = (u: PendingUnit, f: string): boolean => {
    if (/^warlord$/i.test(f.trim())) {
      u.warlord = true;
      return true;
    }
    let m = /^enhancements?:\s*(.+?)(?:\s*\(\+?\d+\s*pts?\))?$/i.exec(f);
    if (m) {
      u.enhancementName = m[1]!.trim();
      return true;
    }
    m = /^(leads|leader of|attached to|supports|support of):\s*(.+)$/i.exec(f);
    if (m) {
      u.attach = { hostName: m[2]!.trim(), role: /^support/i.test(m[1]!) ? "support" : "leader" };
      return true;
    }
    return false;
  };

  const startUnit = (ref: string | undefined, count: number | undefined, label: string, rest: string | undefined) => {
    const ds = findDatasheet(label);
    if (!ds) {
      warnings.push(`Unknown unit "${label}" — skipped.`);
      st.cur = null;
      return;
    }
    if (!factionId) factionId = ds.factionId;
    const u: PendingUnit = { id: `u${units.length + 1}`, ds, name: ds.name, groups: [], warlord: false };
    if (ref) u.ref = ref;
    if (count) u.headerCount = count;
    units.push(u);
    st.cur = u;
    if (rest) {
      // NR "Unit [80pts]: 2x Model (a, b), 1x Other (c) — Warlord; Enhancement: X" or "Unit (415 pts): Warlord" or inline wargear
      const [groupsPart, ...flagParts] = rest.split(/\s+[—–]\s+/);
      const groupRe = /^(\d+)\s*[x×]\s+([^()]+?)\s*(?:\((.*)\))?$/;
      const chunks = (groupsPart ?? "").split(/,\s*(?=\d+\s*[x×]\s+[^(),]+(?:\(|,|$))/);
      const asGroups = chunks.length && chunks.every((c) => groupRe.test(c.trim()) && (c.includes("(") || profileFor(ds, groupRe.exec(c.trim())![2]!)));
      if (asGroups) {
        for (const part of chunks) {
          const m = groupRe.exec(part.trim())!;
          const prof = profileFor(ds, m[2]!);
          u.groups.push({ modelProfileId: prof?.id ?? ds.models[0]!.id, count: Number(m[1]), wargear: m[3] ? parseWargearList(m[3]) : [] });
        }
      } else if (!applyFlag(u, groupsPart ?? "")) {
        // inline wargear for a single-group unit
        const items = parseWargearList(groupsPart ?? "");
        if (items.length) u.groups.push({ modelProfileId: ds.models[0]!.id, count: Math.max(1, count ?? 1), wargear: items });
      }
      for (const f of flagParts.join(" ").split(/;\s*/)) applyFlag(u, f.trim());
    }
  };

  const rawLines = text.split(/\r?\n/);
  let lastHeaderKey = "";
  for (const raw of rawLines) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // ---- New Recruit header block
    if (/^\+{3,}$/.test(trimmed) || /^\+\s*$/.test(trimmed)) continue;
    // "+ KEY: value" (New Recruit header block) and "& continuation" lines; "++ …" lines belong to Grimstat's own dialect
    const hm = /^\+\s+([A-Z][A-Z ]+?):\s*(.*)$/.exec(trimmed) ?? (trimmed.startsWith("&") ? /^&\s*()(.*)$/.exec(trimmed) : null);
    if (hm) {
      const key = (hm[1] || lastHeaderKey).trim().toUpperCase();
      const val = (hm[2] ?? "").trim();
      lastHeaderKey = key || lastHeaderKey;
      switch (key) {
        case "FACTION KEYWORD":
        case "FACTION":
          if (!setFaction(val)) warnings.push(`Unknown faction "${val}".`);
          break;
        case "DETACHMENT":
        case "DETACHMENTS":
          for (const part of val.split(/,\s*(?![^()]*\))/)) if (part.trim()) addDetachment(part.trim());
          break;
        case "FORCE DISPOSITION":
          forceDisposition = val;
          for (const d of detachments) d.forceDisposition = val;
          break;
        case "TOTAL ARMY POINTS":
          totalPoints = Number(/(\d+)/.exec(val)?.[1] ?? 0) || undefined;
          break;
        case "WARLORD":
          warlordRef = val;
          break;
        case "ARMY NAME":
        case "LIST NAME":
          name = val;
          break;
        default:
          break; // ENHANCEMENT (repeated per unit), NUMBER OF UNITS, SECONDARY, … are informational
      }
      headerSeen = true;
      continue;
    }
    if (/^(exported with|created with)/i.test(trimmed)) continue;
    const isBullet = BULLET.test(trimmed);
    const line = trimmed.replace(BULLET, "").replace(/^\+{1,3}\s*|\s*\+{1,3}$/g, "").trim();
    if (!line) continue;

    // ---- Grimstat NR-style header lines
    let m = /^(.+?)\s+[—–-]\s+(Combat Patrol|Incursion|Strike Force|Onslaught)\s*\[(\d+)\s*pts\]$/i.exec(line);
    if (m) {
      setFaction(m[1]!);
      battleSize = SIZE_BY_LABEL[m[2]!.toLowerCase()] ?? battleSize;
      pointsLimit = Number(m[3]);
      headerSeen = true;
      continue;
    }
    m = /^Detachment:\s*(.+?)\s*\[(\d+)\s*DP\]\s*(?:\((.+)\))?$/i.exec(line);
    if (m) {
      addDetachment(m[1]!);
      if (m[3]) detachments.at(-1)!.forceDisposition = m[3];
      continue;
    }
    m = /^(Combat Patrol|Incursion|Strike Force|Onslaught)\s*\((\d+)\s*points\)$/i.exec(line);
    if (m) {
      battleSize = SIZE_BY_LABEL[m[1]!.toLowerCase()] ?? battleSize;
      pointsLimit = Number(m[2]);
      headerSeen = true;
      continue;
    }
    m = /^Detachments:\s*(.+)$/i.exec(line);
    if (m) {
      for (const part of m[1]!.split(/\),\s*/)) {
        const dm = /^(.+?)\s*\((\d+)\s*DP(?:,\s*(.+?))?\)?$/.exec(part.trim());
        if (dm) {
          addDetachment(dm[1]!);
          if (dm[3]) detachments.at(-1)!.forceDisposition = dm[3];
        } else addDetachment(part.replace(/\)$/, "").trim());
      }
      continue;
    }
    if (!isBullet && !st.cur && factionByKey.has(normaliseName(line))) {
      setFaction(line);
      headerSeen = true;
      continue;
    }
    if (!isBullet && SECTION_NAMES.has(normaliseName(line))) {
      st.cur = null;
      continue;
    }
    if (!isBullet && !st.cur && !units.length) {
      const det = snapshot.data.detachments.find((d) => normaliseName(d.name) === normaliseName(line) && (!factionId || d.factionId === factionId));
      if (det) {
        addDetachment(det.name);
        continue;
      }
    }

    // ---- unit header
    m = isBullet ? null : UNIT_HEADER.exec(line);
    if (m) {
      const [, ref, countStr, label, pts1, pts2, rest] = m;
      const looksLikeUnit = !!ref || !!countStr || !!findDatasheet(label!);
      if (!headerSeen && !looksLikeUnit && !units.length) {
        // "My list (2000 points)" — the roster name line
        name = name || label!.trim();
        headerSeen = true;
        continue;
      }
      headerSeen = true;
      void pts1;
      void pts2;
      startUnit(ref, countStr ? Number(countStr) : undefined, label!.trim(), rest);
      continue;
    }

    if (!st.cur) {
      if (!headerSeen && !isBullet) {
        name = name || line;
        headerSeen = true;
      } else if (!/^\d+\s*(pts|points)$/i.test(line)) warnings.push(`Ignored line: "${line}"`);
      continue;
    }
    if (applyFlag(st.cur, line)) continue;

    // ---- lines under a unit: "1x Sir Hekhtur: Close combat weapon, …" | "9x Battle Sister: 9 with …" | "1x Power fist" | "Warlord"
    m = COUNT_ITEM.exec(line);
    if (m) {
      const count = Number(m[1]);
      const body = m[2]!.trim();
      const colon = body.indexOf(":");
      if (colon > 0) {
        const profileLabel = body.slice(0, colon).trim();
        const wargear = parseWargearList(body.slice(colon + 1));
        const prof = profileFor(st.cur.ds, profileLabel);
        st.cur.groups.push({ modelProfileId: prof?.id ?? st.cur.ds.models[0]!.id, count, wargear });
        continue;
      }
      const prof = profileFor(st.cur.ds, body);
      if (prof) st.cur.groups.push({ modelProfileId: prof.id, count, wargear: [] });
      else {
        const g = st.cur.groups.at(-1);
        if (g) g.wargear.push(body);
        else st.cur.groups.push({ modelProfileId: st.cur.ds.models[0]!.id, count: Math.max(1, st.cur.headerCount ?? 1), wargear: [body] });
      }
      continue;
    }
    if (isBullet) {
      // "• Bolt pistol" style single wargear line
      const g = st.cur.groups.at(-1);
      if (g) g.wargear.push(line);
      else st.cur.groups.push({ modelProfileId: st.cur.ds.models[0]!.id, count: Math.max(1, st.cur.headerCount ?? 1), wargear: [line] });
      continue;
    }
    warnings.push(`${st.cur.name}: ignored line "${line}"`);
  }

  if (!factionId) factionId = units[0]?.ds.factionId ?? factions[0]?.id ?? "unknown";
  // battle size: explicit, else inferred from the declared total
  if (!battleSize) {
    const pts = totalPoints ?? 0;
    battleSize = pts > 0 && pts <= 1000 ? "incursion" : pts > 2000 ? "onslaught" : "strike-force";
  }
  pointsLimit ??= battleSize === "incursion" ? 1000 : battleSize === "onslaught" ? 3000 : battleSize === "combat-patrol" ? 500 : 2000;

  const rosterUnits: RosterUnit[] = units.map((u) => {
    let groups: Group[] = u.groups.length ? u.groups : defaultGroups(u.ds);
    if (u.headerCount && !u.groups.length) groups = scaleGroups(groups, u.headerCount);
    // merge groups that ended up on the same profile with identical wargear
    groups = mergeGroups(groups);
    const out: RosterUnit = { id: u.id, datasheetId: u.ds.id, models: groups, isWarlord: u.warlord };
    if (u.enhancementName) {
      const key = normaliseName(u.enhancementName);
      const enh = snapshot.data.enhancements.find((e) => normaliseName(e.name) === key && detachments.some((d) => d.detachmentId === e.detachmentId)) ?? snapshot.data.enhancements.find((e) => normaliseName(e.name) === key);
      if (enh) out.enhancementId = enh.id;
      else warnings.push(`${u.name}: unknown enhancement "${u.enhancementName}".`);
    }
    return out;
  });
  if (warlordRef) {
    const refMatch = /^([A-Za-z]+\d+):\s*(.*)$/.exec(warlordRef);
    const byRef = refMatch ? units.findIndex((u) => u.ref?.toLowerCase() === refMatch[1]!.toLowerCase()) : -1;
    const byName = units.findIndex((u) => normaliseName(u.name) === normaliseName(refMatch?.[2] ?? warlordRef!));
    const i = byRef >= 0 ? byRef : byName;
    if (i >= 0) rosterUnits[i]!.isWarlord = true;
  }
  units.forEach((u, i) => {
    if (!u.attach) return;
    const key = normaliseName(u.attach.hostName);
    const host = units.find((h) => h !== u && normaliseName(h.name) === key);
    if (host) rosterUnits[i]!.attachedTo = { unitId: host.id, role: u.attach.role };
    else warnings.push(`${u.name}: host unit "${u.attach.hostName}" not found.`);
  });
  const roster: Roster = {
    id: `roster_${Math.random().toString(36).slice(2, 10)}`,
    ownerId: "local",
    createdAt: now,
    updatedAt: now,
    revision: 0,
    name: name || "Imported army",
    gameSystemId: snapshot.gameSystemId,
    snapshotId: snapshot.id,
    factionId,
    battleSize,
    pointsLimit,
    detachments,
    units: rosterUnits,
  };
  return { roster, warnings };
}

function scaleGroups(groups: Group[], total: number): Group[] {
  const current = groups.reduce((s, g) => s + g.count, 0);
  if (current === total || groups.length === 0) return groups;
  const last = groups[groups.length - 1]!;
  return [...groups.slice(0, -1), { ...last, count: Math.max(1, last.count + (total - current)) }];
}

function mergeGroups(groups: Group[]): Group[] {
  const out: Group[] = [];
  for (const g of groups) {
    const same = out.find((o) => o.modelProfileId === g.modelProfileId && o.wargear.join("|") === g.wargear.join("|"));
    if (same) same.count += g.count;
    else out.push({ ...g, wargear: [...g.wargear] });
  }
  return out;
}

export function defaultGroups(ds: Datasheet): RosterUnit["models"] {
  const mins = ds.composition.map((c) => c.min).filter((m): m is number => typeof m === "number" && m > 0);
  const total = mins.length ? mins.reduce((s, m) => s + m, 0) : 1;
  if (ds.models.length === 1) return [{ modelProfileId: ds.models[0]!.id, count: Math.max(1, total), wargear: [] }];
  let remaining = total;
  return ds.models.map((m, i) => {
    const last = i === ds.models.length - 1;
    const count = last ? Math.max(1, remaining) : 1;
    remaining -= count;
    return { modelProfileId: m.id, count, wargear: [] };
  });
}
