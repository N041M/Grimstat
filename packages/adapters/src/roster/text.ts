import type { Roster, Snapshot } from "@grimstat/schema";
import { SIZE_LABEL, rosterView, type RosterView, type UnitView } from "./common";

export type RosterTextDialect = "gw-app" | "nr-tournament" | "markdown";

function gwUnit(v: UnitView, indent = ""): string[] {
  const lines: string[] = [`${indent}${v.name} (${v.points} points)`];
  if (v.unit.isWarlord) lines.push(`${indent}  • Warlord`);
  if (v.host) lines.push(`${indent}  • ${v.unit.attachedTo?.role === "support" ? "Supports" : "Leads"}: ${v.host.name}`);
  if (v.enhancement) lines.push(`${indent}  • Enhancement: ${v.enhancement.name} (+${v.enhancement.cost} pts)`);
  for (const g of v.groups) {
    lines.push(`${indent}  • ${g.count}x ${g.profileName}`);
    for (const w of g.wargear) lines.push(`${indent}     ${g.count}x ${w}`);
  }
  return lines;
}

export function exportGwAppText(view: RosterView): string {
  const r = view.roster;
  const out: string[] = [];
  out.push(`${r.name} (${view.total} points)`, "");
  out.push(view.factionName);
  out.push(`${SIZE_LABEL[r.battleSize]} (${r.pointsLimit} points)`);
  if (view.detachments.length) out.push(`Detachments: ${view.detachments.map((d) => `${d.name} (${d.dp} DP${d.forceDisposition ? `, ${d.forceDisposition}` : ""})`).join(", ")}`);
  out.push("");
  for (const s of view.sections) {
    out.push(s.section, "");
    for (const v of s.units) {
      out.push(...gwUnit(v), "");
    }
  }
  out.push("Exported with Grimstat");
  return out.join("\n");
}

export function exportNrTournamentText(view: RosterView): string {
  const r = view.roster;
  const out: string[] = [];
  out.push(`+++ ${r.name} [${view.total}pts] +++`);
  out.push(`++ ${view.factionName} — ${SIZE_LABEL[r.battleSize]} [${r.pointsLimit}pts] ++`);
  for (const d of view.detachments) out.push(`++ Detachment: ${d.name} [${d.dp} DP]${d.forceDisposition ? ` (${d.forceDisposition})` : ""} ++`);
  out.push("");
  for (const s of view.sections) {
    out.push(`+ ${s.section} +`);
    for (const v of s.units) {
      const groups = v.groups.map((g) => `${g.count}x ${g.profileName}${g.wargear.length ? ` (${g.wargear.join(", ")})` : ""}`).join(", ");
      const flags = [v.unit.isWarlord ? "Warlord" : "", v.enhancement ? `Enhancement: ${v.enhancement.name}` : "", v.host ? `${v.unit.attachedTo?.role === "support" ? "Supports" : "Leads"}: ${v.host.name}` : ""].filter(Boolean);
      out.push(`${v.name} [${v.points}pts]: ${groups}${flags.length ? ` — ${flags.join("; ")}` : ""}`);
    }
    out.push("");
  }
  return out.join("\n").trimEnd() + "\n";
}

export function exportMarkdown(view: RosterView): string {
  const r = view.roster;
  const out: string[] = [];
  out.push(`# ${r.name} (${view.total} / ${r.pointsLimit} pts)`, "");
  out.push(`**${view.factionName}** · ${SIZE_LABEL[r.battleSize]}`);
  if (view.detachments.length) out.push("", ...view.detachments.map((d) => `- ${d.name} (${d.dp} DP${d.forceDisposition ? `, ${d.forceDisposition}` : ""})`));
  for (const s of view.sections) {
    out.push("", `## ${s.section}`, "", "| Unit | Models | Wargear | Notes | Points |", "|---|---|---|---|---|");
    for (const v of s.units) {
      const models = v.groups.map((g) => `${g.count}× ${g.profileName}`).join(", ");
      const wargear = [...new Set(v.groups.flatMap((g) => g.wargear))].join(", ");
      const notes = [v.unit.isWarlord ? "Warlord" : "", v.enhancement ? `Enh: ${v.enhancement.name}` : "", v.host ? `${v.unit.attachedTo?.role === "support" ? "Supports" : "Leads"} ${v.host.name}` : ""].filter(Boolean).join("; ");
      out.push(`| ${v.name} | ${models} | ${wargear} | ${notes} | ${v.points} |`);
    }
  }
  return out.join("\n") + "\n";
}

export function exportRosterText(roster: Roster, snapshot: Snapshot, dialect: RosterTextDialect): string {
  const view = rosterView(roster, snapshot);
  switch (dialect) {
    case "gw-app":
      return exportGwAppText(view);
    case "nr-tournament":
      return exportNrTournamentText(view);
    case "markdown":
      return exportMarkdown(view);
  }
}
