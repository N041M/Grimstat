import { importJson } from "@grimstat/adapters";
import { diffSnapshots, type SnapshotDiff } from "@grimstat/snapshot";
import { readFileSync } from "node:fs";

export function runDiff(a: string, b: string, log: (s: string) => void = console.log, limit = 40): SnapshotDiff {
  const sa = importJson(readFileSync(a, "utf8"));
  const sb = importJson(readFileSync(b, "utf8"));
  const d = diffSnapshots(sa, sb);
  log(`${d.from.id} -> ${d.to.id}`);
  log(`added ${d.summary.added}, removed ${d.summary.removed}, changed ${d.summary.changed}, points changed ${d.summary.pointsChanged}`);
  if (d.points.length) {
    log(`\nPoints:`);
    for (const p of d.points.slice(0, limit)) {
      const arrow = p.before !== undefined && p.after !== undefined ? `${p.before} -> ${p.after} (${p.delta! >= 0 ? "+" : ""}${p.delta})` : p.before === undefined ? `new: ${p.after}` : `removed (was ${p.before})`;
      log(`  ${p.name.padEnd(40)} ${arrow}`);
    }
    if (d.points.length > limit) log(`  ... and ${d.points.length - limit} more`);
  }
  const show = (title: string, list: { entity: string; id: string; name: string }[]): void => {
    if (!list.length) return;
    log(`\n${title}:`);
    for (const x of list.slice(0, limit)) log(`  ${x.entity.padEnd(12)} ${x.name} (${x.id})`);
    if (list.length > limit) log(`  ... and ${list.length - limit} more`);
  };
  show("Added", d.added);
  show("Removed", d.removed);
  if (d.changed.length) {
    log(`\nChanged:`);
    for (const c of d.changed.slice(0, limit)) log(`  ${c.entity.padEnd(12)} ${c.name}: ${c.changes.map((ch) => ch.field).join(", ")}`);
    if (d.changed.length > limit) log(`  ... and ${d.changed.length - limit} more`);
  }
  return d;
}
