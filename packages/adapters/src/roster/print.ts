import type { Ability, Roster, Snapshot } from "@grimstat/schema";
import { rosterView, SIZE_LABEL } from "./common";

const esc = (s: unknown): string => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const nl = (s: string): string => esc(s).replace(/\n/g, "<br>");

/**
 * A printable reference pack for one list: only the datasheets, enhancements, detachment rules and
 * stratagems this army actually uses. Generated on the user's machine from their imported data.
 */
export function exportRosterPrintHtml(roster: Roster, snapshot: Snapshot): string {
  const view = rosterView(roster, snapshot);
  const abilities = new Map(snapshot.data.abilities.map((a) => [a.id, a] as const));
  const ab = (id: string): Ability | undefined => abilities.get(id);
  const detIds = new Set(roster.detachments.map((d) => d.detachmentId));
  const strats = snapshot.data.stratagems.filter((s) => (s.detachmentId && detIds.has(s.detachmentId)) || (!s.detachmentId && (!s.factionId || s.factionId === roster.factionId)));
  const parts: string[] = [];
  parts.push(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(roster.name)} — reference pack</title><style>
  body{font:12px/1.35 system-ui,sans-serif;color:#111;margin:18px;max-width:900px}
  h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;border-bottom:1px solid #999;padding-bottom:2px}
  .card{border:1px solid #999;padding:8px 10px;margin:10px 0;break-inside:avoid;page-break-inside:avoid}
  .card h3{font-size:14px;margin:0 0 4px;display:flex;justify-content:space-between}
  table{border-collapse:collapse;width:100%;margin:4px 0 6px;font-size:11.5px}th,td{border:1px solid #bbb;padding:2px 5px;text-align:left}
  th{background:#eee}.kw{font-size:10.5px;color:#444}.ab{margin:3px 0}.ab b{font-weight:600}.meta{color:#444}
  @media print{body{margin:8mm}.card{margin:6px 0}}
  </style></head><body>`);
  parts.push(`<h1>${esc(roster.name)} <span class="meta">— ${view.total} / ${roster.pointsLimit} pts</span></h1>`);
  parts.push(`<div class="meta">${esc(view.factionName)} · ${esc(SIZE_LABEL[roster.battleSize])}${view.detachments.length ? " · " + view.detachments.map((d) => `${esc(d.name)} (${d.dp} DP${d.forceDisposition ? `, ${esc(d.forceDisposition)}` : ""})`).join(", ") : ""}</div>`);

  // list summary
  parts.push(`<h2>Army list</h2><table><tr><th>Unit</th><th>Models</th><th>Wargear</th><th>Notes</th><th>Pts</th></tr>`);
  for (const s of view.sections) for (const v of s.units) {
    const notes = [v.unit.isWarlord ? "Warlord" : "", v.enhancement ? `Enh: ${v.enhancement.name}` : "", v.host ? `${v.unit.attachedTo?.role === "support" ? "Supports" : "Leads"} ${v.host.name}` : ""].filter(Boolean).join("; ");
    parts.push(`<tr><td>${esc(v.name)}</td><td>${v.groups.map((g) => `${g.count}× ${esc(g.profileName)}`).join(", ")}</td><td>${esc([...new Set(v.groups.flatMap((g) => g.wargear))].join(", "))}</td><td>${esc(notes)}</td><td>${v.points}</td></tr>`);
  }
  parts.push(`</table>`);

  // detachment rules
  for (const d of roster.detachments) {
    const det = view.ctx.detachment(d.detachmentId);
    if (!det) continue;
    parts.push(`<h2>Detachment: ${esc(det.name)} (${det.dp} DP)</h2>`);
    for (const id of det.ruleAbilityIds) {
      const a = ab(id);
      if (a) parts.push(`<div class="ab"><b>${esc(a.name)}</b>: ${nl(a.text)}</div>`);
    }
  }

  // datasheets
  parts.push(`<h2>Datasheets</h2>`);
  const seen = new Set<string>();
  for (const s of view.sections) for (const v of s.units) {
    const ds = v.ds;
    if (!ds || seen.has(ds.id)) continue;
    seen.add(ds.id);
    parts.push(`<div class="card"><h3><span>${esc(ds.name)}</span><span class="meta">${v.points} pts</span></h3>`);
    parts.push(`<table><tr><th>Model</th><th>M</th><th>T</th><th>Sv</th><th>Inv</th><th>W</th><th>Ld</th><th>OC</th></tr>`);
    for (const m of ds.models) parts.push(`<tr><td>${esc(m.name)}</td><td>${m.M ?? "–"}</td><td>${m.T}</td><td>${m.Sv}+</td><td>${m.InvSv ? `${m.InvSv}+` : "–"}</td><td>${m.W}</td><td>${m.Ld ?? "–"}</td><td>${m.OC ?? "–"}</td></tr>`);
    parts.push(`</table>`);
    const selected = new Set(v.groups.flatMap((g) => g.wargear.map((w) => w.toLowerCase().split(/\s+[–—-]\s+/)[0]!)));
    const usedAttached = v.attached.flatMap((a) => a.groups.flatMap((g) => g.wargear.map((w) => w.toLowerCase().split(/\s+[–—-]\s+/)[0]!)));
    for (const u of usedAttached) selected.add(u);
    const weapons = ds.weapons.filter((w) => !selected.size || selected.has(w.name.toLowerCase().split(/\s+[–—-]\s+/)[0]!));
    if (weapons.length) {
      parts.push(`<table><tr><th>Weapon</th><th>Range</th><th>A</th><th>BS/WS</th><th>S</th><th>AP</th><th>D</th><th>Keywords</th></tr>`);
      for (const w of weapons) parts.push(`<tr><td>${esc(w.name)}</td><td>${w.kind === "melee" ? "Melee" : `${w.range ?? "–"}"`}</td><td>${esc(w.A)}</td><td>${w.skill ? `${w.skill}+` : "N/A"}</td><td>${w.S}</td><td>${w.AP ? `-${w.AP}` : "0"}</td><td>${esc(w.D)}</td><td class="kw">${esc(w.keywords.map((k) => k.raw ?? k.name).join(", "))}</td></tr>`);
      parts.push(`</table>`);
    }
    for (const id of ds.abilityIds) {
      const a = ab(id);
      if (!a) continue;
      parts.push(`<div class="ab"><b>${esc(a.name)}</b>${a.text ? `: ${nl(a.text)}` : ""}</div>`);
    }
    if (v.enhancement) {
      const e = snapshot.data.enhancements.find((x) => x.name === v.enhancement!.name);
      parts.push(`<div class="ab"><b>Enhancement — ${esc(v.enhancement.name)} (+${v.enhancement.cost} pts)</b>${e?.text ? `: ${nl(e.text)}` : ""}</div>`);
    }
    parts.push(`<div class="kw">${esc([...ds.keywords, ...ds.factionKeywords].join(" · "))}</div></div>`);
  }

  // stratagems
  if (strats.length) {
    parts.push(`<h2>Stratagems</h2>`);
    for (const s of strats) {
      const body = s.text ?? [s.when ? `WHEN: ${s.when}` : "", s.target ? `TARGET: ${s.target}` : "", s.effect ? `EFFECT: ${s.effect}` : "", s.restrictions ? `RESTRICTIONS: ${s.restrictions}` : ""].filter(Boolean).join("\n");
      parts.push(`<div class="card"><h3><span>${esc(s.name)}</span><span class="meta">${s.cpCost} CP${s.type ? ` · ${esc(s.type)}` : ""}${s.phases.length ? ` · ${esc(s.phases.join(", "))}` : ""}</span></h3><div class="ab">${nl(body)}</div></div>`);
    }
  }
  parts.push(`<p class="meta">Generated by Grimstat from data imported on this machine. Unofficial; Warhammer 40,000 © Games Workshop Ltd.</p></body></html>`);
  return parts.join("\n");
}
