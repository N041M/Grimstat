import type { Datasheet, Roster, RosterUnit, Snapshot } from "@grimstat/schema";
import { normaliseName } from "@grimstat/snapshot";

const SIZE_BY_LABEL: Record<string, Roster["battleSize"]> = { "combat patrol": "combat-patrol", incursion: "incursion", "strike force": "strike-force", onslaught: "onslaught" };
const SECTION_NAMES = new Set(["characters", "battleline", "dedicated transports", "other datasheets", "allied units", "epic heroes", "infantry", "mounted", "vehicles", "monsters", "fortifications", "swarms", "beasts", "aircraft"]);

interface PendingUnit {
  id: string;
  ds: Datasheet;
  name: string;
  customName?: string;
  groups: Array<{ modelProfileId: string; count: number; wargear: string[] }>;
  warlord: boolean;
  enhancementName?: string;
  attach?: { hostName: string; role: "leader" | "support" };
}

function clean(line: string): string {
  return line.replace(/^[\s•◦▪\-*+]+/, "").trim();
}

const UNIT_HEADER = /^(.*?)\s*(?:\((\d+)\s*(?:points|pts)\)|\[(\d+)\s*pts\])\s*(?::\s*(.*))?$/i;
const COUNT_ITEM = /^(\d+)\s*[x×]\s+(.+)$/i;

export function importRosterText(text: string, snapshot: Snapshot, opts: { name?: string } = {}): { roster: Roster; warnings: string[] } {
  const warnings: string[] = [];
  const lines = text.split(/\r?\n/).map(clean).filter((l) => l.length);
  const now = new Date().toISOString();
  const factions = snapshot.data.factions;
  const factionByKey = new Map(factions.map((f) => [normaliseName(f.name), f] as const));
  const dsByKey = new Map<string, Datasheet[]>();
  for (const d of snapshot.data.datasheets) {
    const k = normaliseName(d.name);
    dsByKey.set(k, [...(dsByKey.get(k) ?? []), d]);
  }
  let name = opts.name ?? "Imported army";
  let factionId: string | undefined;
  let battleSize: Roster["battleSize"] = "strike-force";
  let pointsLimit = 2000;
  const detachments: Roster["detachments"] = [];
  const units: PendingUnit[] = [];
  const st: { cur: PendingUnit | null } = { cur: null };
  let headerSeen = false;

  const findDatasheet = (label: string): Datasheet | undefined => {
    const key = normaliseName(label);
    const cands = dsByKey.get(key) ?? [];
    return cands.find((d) => d.factionId === factionId) ?? cands[0];
  };
  const addDetachment = (label: string, disposition?: string) => {
    const key = normaliseName(label);
    const det = snapshot.data.detachments.find((d) => normaliseName(d.name) === key && (!factionId || d.factionId === factionId)) ?? snapshot.data.detachments.find((d) => normaliseName(d.name) === key);
    if (!det) {
      warnings.push(`Unknown detachment "${label}".`);
      return;
    }
    if (!factionId) factionId = det.factionId;
    const entry: Roster["detachments"][number] = { id: `d${detachments.length + 1}`, detachmentId: det.id };
    if (disposition) entry.forceDisposition = disposition;
    detachments.push(entry);
  };
  const startUnit = (label: string, rest?: string) => {
    const ds = findDatasheet(label);
    if (!ds) {
      warnings.push(`Unknown unit "${label}" — skipped.`);
      st.cur = null;
      return;
    }
    if (!factionId) factionId = ds.factionId;
    const u: PendingUnit = { id: `u${units.length + 1}`, ds, name: ds.name, groups: [], warlord: false };
    units.push(u);
    st.cur = u;
    if (rest) parseInlineGroups(u, rest);
  };
  const profileFor = (ds: Datasheet, label: string) => {
    const key = normaliseName(label);
    return ds.models.find((m) => normaliseName(m.name) === key) ?? (ds.models.length === 1 && normaliseName(ds.name) === key ? ds.models[0] : undefined);
  };
  const parseInlineGroups = (u: PendingUnit, rest: string) => {
    // "2x Warden (flux carbine, shock maul), 1x Warden Sergeant (power fist) — Warlord; Enhancement: X"
    const [groupsPart, ...flagParts] = rest.split(/\s+[—–]\s+/);
    for (const part of (groupsPart ?? "").split(/,\s*(?=\d+\s*[x×]\s)/)) {
      const m = /^(\d+)\s*[x×]\s+([^()]+?)\s*(?:\((.*)\))?$/.exec(part.trim());
      if (!m) continue;
      const prof = profileFor(u.ds, m[2]!);
      const wargear = m[3] ? m[3].split(/,\s*/).map((w) => w.trim()).filter(Boolean) : [];
      u.groups.push({ modelProfileId: prof?.id ?? u.ds.models[0]!.id, count: Number(m[1]), wargear });
      if (!prof) warnings.push(`${u.name}: model "${m[2]}" not found; used the first profile.`);
    }
    for (const f of flagParts.join(" ").split(/;\s*/)) applyFlag(u, f.trim());
  };
  const applyFlag = (u: PendingUnit, f: string): boolean => {
    if (/^warlord$/i.test(f)) {
      u.warlord = true;
      return true;
    }
    let m = /^enhancement:\s*(.+?)(?:\s*\(\+?\d+\s*pts?\))?$/i.exec(f);
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

  for (const raw of lines) {
    const line = raw.replace(/^\+{1,3}\s*|\s*\+{1,3}$/g, "").trim();
    if (!line) continue;
    if (/^exported with/i.test(line)) continue;
    // NR-style faction/size line: "Faction — Strike Force [2000pts]"
    let m = /^(.+?)\s+[—–-]\s+(Combat Patrol|Incursion|Strike Force|Onslaught)\s*\[(\d+)\s*pts\]$/i.exec(line);
    if (m) {
      const f = factionByKey.get(normaliseName(m[1]!));
      if (f) factionId = f.id;
      battleSize = SIZE_BY_LABEL[m[2]!.toLowerCase()] ?? battleSize;
      pointsLimit = Number(m[3]);
      continue;
    }
    m = /^Detachment:\s*(.+?)\s*\[(\d+)\s*DP\]\s*(?:\((.+)\))?$/i.exec(line);
    if (m) {
      addDetachment(m[1]!, m[3]);
      continue;
    }
    m = /^(Combat Patrol|Incursion|Strike Force|Onslaught)\s*\((\d+)\s*points\)$/i.exec(line);
    if (m) {
      battleSize = SIZE_BY_LABEL[m[1]!.toLowerCase()] ?? battleSize;
      pointsLimit = Number(m[2]);
      continue;
    }
    m = /^Detachments:\s*(.+)$/i.exec(line);
    if (m) {
      for (const part of m[1]!.split(/\),\s*/)) {
        const dm = /^(.+?)\s*\((\d+)\s*DP(?:,\s*(.+?))?\)?$/.exec(part.trim());
        if (dm) addDetachment(dm[1]!, dm[3]);
        else addDetachment(part.replace(/\)$/, "").trim());
      }
      continue;
    }
    if (factionByKey.has(normaliseName(line)) && !st.cur) {
      factionId = factionByKey.get(normaliseName(line))!.id;
      continue;
    }
    if (SECTION_NAMES.has(normaliseName(line))) {
      st.cur = null;
      continue;
    }
    const det = snapshot.data.detachments.find((d) => normaliseName(d.name) === normaliseName(line) && (!factionId || d.factionId === factionId));
    if (det && !st.cur && !units.length) {
      addDetachment(det.name);
      continue;
    }
    m = UNIT_HEADER.exec(line);
    if (m && !COUNT_ITEM.test(line)) {
      if (!headerSeen && !factionId && !findDatasheet(m[1]!)) {
        // first "Name (N points)" line is the roster name
        headerSeen = true;
        name = m[1]!.trim();
        continue;
      }
      headerSeen = true;
      startUnit(m[1]!.trim(), m[4]);
      continue;
    }
    if (!st.cur) {
      if (!headerSeen) {
        name = line;
        headerSeen = true;
      } else warnings.push(`Ignored line: "${line}"`);
      continue;
    }
    if (applyFlag(st.cur, line)) continue;
    m = COUNT_ITEM.exec(line);
    if (m) {
      const count = Number(m[1]);
      const label = m[2]!.trim();
      const prof = profileFor(st.cur.ds, label);
      if (prof) st.cur.groups.push({ modelProfileId: prof.id, count, wargear: [] });
      else {
        const g = st.cur.groups.at(-1);
        if (g) g.wargear.push(label);
        else st.cur.groups.push({ modelProfileId: st.cur.ds.models[0]!.id, count, wargear: [label] });
      }
      continue;
    }
    warnings.push(`${st.cur.name}: ignored line "${line}"`);
  }

  if (!factionId) factionId = factions[0]?.id ?? "unknown";
  const rosterUnits: RosterUnit[] = units.map((u) => {
    const groups = u.groups.length ? u.groups : defaultGroups(u.ds);
    const out: RosterUnit = { id: u.id, datasheetId: u.ds.id, models: groups, isWarlord: u.warlord };
    if (u.customName) out.customName = u.customName;
    if (u.enhancementName) {
      const key = normaliseName(u.enhancementName);
      const enh = snapshot.data.enhancements.find((e) => normaliseName(e.name) === key && detachments.some((d) => d.detachmentId === e.detachmentId)) ?? snapshot.data.enhancements.find((e) => normaliseName(e.name) === key);
      if (enh) out.enhancementId = enh.id;
      else warnings.push(`${u.name}: unknown enhancement "${u.enhancementName}".`);
    }
    return out;
  });
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
    name,
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
