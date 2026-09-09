import { readFileSync } from "node:fs";
import { importJson } from "@grimstat/adapters";
import { normaliseName } from "@grimstat/snapshot";
import type { Datasheet, Snapshot } from "@grimstat/schema";

export function findDatasheet(snapshot: Snapshot, query: string): Datasheet[] {
  const q = normaliseName(query);
  const exact = snapshot.data.datasheets.filter((d) => normaliseName(d.name) === q || d.id === query);
  if (exact.length) return exact;
  return snapshot.data.datasheets.filter((d) => normaliseName(d.name).includes(q));
}

export function formatDatasheet(snapshot: Snapshot, ds: Datasheet): string {
  const lines: string[] = [];
  const faction = snapshot.data.factions.find((f) => f.id === ds.factionId);
  const abilities = new Map(snapshot.data.abilities.map((a) => [a.id, a]));
  const name = (id: string): string => snapshot.data.datasheets.find((d) => d.id === id)?.name ?? id;
  lines.push(`${ds.name}  [${ds.id}]`);
  lines.push(`faction: ${faction?.name ?? ds.factionId}${ds.isLegends ? "  (Legends)" : ""}${ds.role ? `  role: ${ds.role}` : ""}`);
  lines.push(`keywords: ${[...ds.factionKeywords, ...ds.keywords].join(", ")}`);
  lines.push(`models:`);
  for (const m of ds.models) lines.push(`  ${m.name.padEnd(32)} M${m.M ?? "-"}" T${m.T} Sv${m.Sv}+ Inv${m.InvSv ?? "-"} W${m.W} Ld${m.Ld ?? "-"}+ OC${m.OC ?? "-"}${m.baseSize ? `  ${m.baseSize}` : ""}`);
  if (ds.weapons.length) lines.push(`weapons:`);
  for (const w of ds.weapons) {
    const kw = w.keywords.map((k) => k.raw ?? `${k.name}${k.keyword ? "-" + k.keyword : ""}${k.value !== undefined ? " " + k.value : ""}`).join(", ");
    lines.push(`  ${w.name.padEnd(32)} ${w.kind === "melee" ? "Melee" : `${w.range ?? "-"}"`}  A${w.A} ${w.skill === null ? "N/A" : w.skill + "+"} S${w.S} AP-${w.AP} D${w.D}${kw ? `  [${kw}]` : ""}`);
  }
  if (ds.abilityIds.length) lines.push(`abilities:`);
  for (const id of ds.abilityIds) {
    const a = abilities.get(id);
    if (!a) continue;
    const tier = a.coreKeyword ? `core:${a.coreKeyword}${a.coreValue !== undefined ? " " + a.coreValue : ""}` : a.effects?.length ? "tier2" : "text";
    const text = a.text.replace(/\s+/g, " ");
    lines.push(`  ${a.name} (${a.scope}, ${tier})${text ? `: ${text.length > 140 ? text.slice(0, 140) + "..." : text}` : ""}`);
  }
  if (ds.composition.length) lines.push(`composition: ${ds.composition.map((c) => c.description).join("; ")}`);
  if (ds.loadout) lines.push(`loadout: ${ds.loadout.replace(/\s+/g, " ")}`);
  if (ds.leaderTo.length) lines.push(`leader of: ${ds.leaderTo.map(name).join(", ")}`);
  if (ds.supportTo.length) lines.push(`supports: ${ds.supportTo.map(name).join(", ")}`);
  const rules = snapshot.data.priceRules.filter((r) => r.datasheetId === ds.id);
  if (rules.length) {
    lines.push(`points:`);
    for (const r of rules) lines.push(`  copies ${r.copyRange.min}${r.copyRange.max !== undefined ? `-${r.copyRange.max}` : "+"}: ${r.tiers.map((t) => `${t.models} model${t.models > 1 ? "s" : ""} = ${t.points}`).join(", ")}`);
  } else if (ds.fallbackPoints !== undefined) lines.push(`points: ${ds.fallbackPoints} (fallback)`);
  const wg = snapshot.data.wargearPrices.filter((w) => w.datasheetId === ds.id);
  if (wg.length) lines.push(`wargear: ${wg.map((w) => `${w.item} +${w.points}`).join(", ")}`);
  if (ds.damagedProfile) lines.push(`damaged (${ds.damagedProfile.threshold}): ${ds.damagedProfile.description.replace(/\s+/g, " ")}`);
  return lines.join("\n");
}

export function runShow(file: string, query: string, log: (s: string) => void = console.log): Datasheet[] {
  const snapshot = importJson(readFileSync(file, "utf8"));
  const hits = findDatasheet(snapshot, query);
  if (!hits.length) {
    log(`no datasheet matches "${query}"`);
    return hits;
  }
  if (hits.length > 1) log(`${hits.length} matches: ${hits.map((h) => h.name).join(", ")}\n`);
  for (const ds of hits.slice(0, 5)) log(formatDatasheet(snapshot, ds) + "\n");
  return hits;
}
