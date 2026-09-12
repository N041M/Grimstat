import { useEffect, useMemo, useState } from "react";
import { Roster, type Diagnostic, type Snapshot } from "@grimstat/schema";
import { listRosterVersions, type RosterVersionRecord } from "../../db";
import { describeRevisionChange, type RevisionChange } from "../../lib/roster";
import { fmtRelative } from "../../lib/format";
import { Dock, DockSection, ProportionBar } from "../kit";
import { DiagnosticItem } from "./DiagnosticItem";
import { t } from "../../i18n";

/** How many revisions the dock walks; each one costs a parse plus a costing pass. */
const HISTORY_LIMIT = 8;

export interface DockBudget {
  label: string;
  used: number;
  limit: number;
}

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  diagnostics: Diagnostic[];
  budgets: DockBudget[];
  onSelectUnit: (index: number) => void;
  onOpenHistory: () => void;
}

function changeText(c: RevisionChange): string {
  switch (c.kind) {
    case "created":
      return t("roster.history.created");
    case "added":
      return t("roster.history.addedOne", { name: c.name });
    case "removed":
      return t("roster.history.removedOne", { name: c.name });
    case "changed":
      return t("roster.history.changedOne", { name: c.name });
    case "detachments":
      return t("roster.history.detachmentChanged");
    case "renamed":
      return t("roster.history.renamed", { name: c.name });
    case "settings":
      return t("roster.history.settingsChanged");
    case "reordered":
      return t("roster.history.reordered");
    case "other":
      return t("roster.history.other");
    case "multi":
      return t("roster.history.multi", { n: c.n });
    case "unreadable":
      return t("roster.history.unreadable");
  }
}

function parseVersion(v: RosterVersionRecord): Roster | undefined {
  try {
    return Roster.parse(JSON.parse(v.json));
  } catch {
    return undefined;
  }
}

/**
 * The Armies right dock: what the army checks say, how the three budgets stand, and what the last
 * few saves did. Everything here is derived; the editor stays the single source of truth.
 */
export function RosterDock({ roster, snapshot, diagnostics, budgets, onSelectUnit, onOpenHistory }: Props) {
  const [versions, setVersions] = useState<RosterVersionRecord[]>([]);

  useEffect(() => {
    let alive = true;
    void listRosterVersions(roster.id).then((v) => {
      if (alive) setVersions(v);
    });
    return () => {
      alive = false;
    };
  }, [roster.id, roster.revision]);

  // Errors and warnings first (accent dots), then the checks that passed.
  const ordered = useMemo(() => {
    const rank = (d: Diagnostic) => (d.severity === "error" ? 0 : d.severity === "warn" ? 1 : 2);
    return [...diagnostics].sort((a, b) => rank(a) - rank(b));
  }, [diagnostics]);
  const failures = ordered.filter((d) => d.severity !== "info").length;

  const history = useMemo(() => {
    const recent = versions.slice(0, HISTORY_LIMIT);
    return recent.map((rec, i) => {
      const cur = parseVersion(rec);
      const prev = i + 1 < versions.length ? parseVersion(versions[i + 1]!) : undefined;
      // A stored revision that fails to parse, or one whose costing throws, is shown as unreadable
      // rather than as a count of changes.
      let change: RevisionChange = { kind: "unreadable" };
      if (cur) {
        try {
          change = describeRevisionChange(prev, cur, snapshot);
        } catch {
          change = { kind: "unreadable" };
        }
      }
      return { rec, change };
    });
  }, [versions, snapshot]);

  return (
    <Dock label={t("roster.dock.validation")} meta={failures ? t("roster.dock.issues", { n: failures }) : t("roster.dock.clean")}>
      <DockSection>
        {ordered.length === 0 ? <p className="dock-empty">{t("roster.diagnostics.clean")}</p> : null}
        <ul className="val-list">
          {ordered.map((d, i) => (
            <DiagnosticItem key={`${d.code}-${i}`} d={d} onSelectUnit={onSelectUnit} />
          ))}
        </ul>
      </DockSection>

      <DockSection title={t("roster.dock.budgets")}>
        <div className="budget-list">
          {budgets.map((b) => (
            <div key={b.label} className="budget-row">
              <span className="budget-name">{b.label}</span>
              <ProportionBar value={b.limit > 0 ? b.used / b.limit : 0} height={6} tone={b.used > b.limit ? "dim" : "ink"} />
              <span className="budget-v">
                {Math.round(b.used)} / {Math.round(b.limit)}
              </span>
            </div>
          ))}
        </div>
      </DockSection>

      <DockSection title={t("roster.dock.history")} count={<button type="button" className="dock-link" onClick={onOpenHistory}>{t("roster.history.all")}</button>}>
        {history.length === 0 ? <p className="dock-empty">{t("roster.history.empty")}</p> : null}
        <div className="hist-list">
          {history.map(({ rec, change }) => (
            <div key={rec.id} className="hist-row">
              <span className="hist-text">{changeText(change)}</span>
              <span className="hist-time">{fmtRelative(rec.updatedAt)}</span>
            </div>
          ))}
        </div>
      </DockSection>
    </Dock>
  );
}
