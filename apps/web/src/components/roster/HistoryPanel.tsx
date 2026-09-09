import { useEffect, useMemo, useState } from "react";
import { Roster, type Snapshot } from "@grimstat/schema";
import { rosterSummary } from "@grimstat/resolver";
import { listRosterVersions, type RosterVersionRecord } from "../../db";
import { diffRosters, type RosterDiff } from "../../lib/roster";
import { fmtDate, fmtInt } from "../../lib/format";
import { t } from "../../i18n";

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  onRestore: (r: Roster, revision: number) => void;
  onClose: () => void;
}

function parseVersion(v: RosterVersionRecord): Roster | undefined {
  try {
    return Roster.parse(JSON.parse(v.json));
  } catch {
    return undefined;
  }
}

export function HistoryPanel({ roster, snapshot, onRestore, onClose }: Props) {
  const [versions, setVersions] = useState<RosterVersionRecord[]>([]);
  const [diff, setDiff] = useState<{ a: number; b: number; diff: RosterDiff } | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void listRosterVersions(roster.id).then((v) => {
      if (alive) setVersions(v);
    });
    return () => {
      alive = false;
    };
  }, [roster.id, roster.revision]);

  const parsed = useMemo(
    () =>
      versions.map((v) => {
        const r = parseVersion(v);
        let points: number | undefined;
        if (r) {
          try {
            points = rosterSummary(r, snapshot).points;
          } catch {
            points = undefined;
          }
        }
        return { rec: v, roster: r, points };
      }),
    [versions, snapshot],
  );

  const compare = (i: number) => {
    const cur = parsed[i];
    const prev = parsed[i + 1];
    if (!cur?.roster || !prev?.roster) return;
    setDiff({ a: prev.rec.revision, b: cur.rec.revision, diff: diffRosters(prev.roster, cur.roster, snapshot) });
  };

  return (
    <div className="stack">
      <div className="panel-head">
        <h3 style={{ margin: 0 }}>{t("roster.history.title")}</h3>
        <button type="button" className="ghost sm" onClick={onClose} aria-label={t("common.close")}>
          ×
        </button>
      </div>
      {diff ? (
        <div className="diff-box">
          <div className="row between">
            <strong>{t("roster.history.diffTitle", { a: diff.a, b: diff.b })}</strong>
            <span className="small muted">{t("roster.history.pointsChange", { before: fmtInt(diff.diff.pointsBefore), after: fmtInt(diff.diff.pointsAfter) })}</span>
            <button type="button" className="ghost sm" onClick={() => setDiff(undefined)} aria-label={t("roster.history.closeDiff")}>
              ×
            </button>
          </div>
          {!diff.diff.added.length && !diff.diff.removed.length && !diff.diff.changed.length ? <p className="small muted">{t("roster.history.noChanges")}</p> : null}
          {diff.diff.added.length ? (
            <div>
              <h4 className="inspector-h">{t("roster.history.added")}</h4>
              <ul className="diff-list">
                {diff.diff.added.map((u) => (
                  <li key={u.id} className="ok">
                    + {u.name} <span className="muted">({t("unit.points", { v: fmtInt(u.points) })})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {diff.diff.removed.length ? (
            <div>
              <h4 className="inspector-h">{t("roster.history.removed")}</h4>
              <ul className="diff-list">
                {diff.diff.removed.map((u) => (
                  <li key={u.id} className="danger">
                    − {u.name} <span className="muted">({t("unit.points", { v: fmtInt(u.points) })})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {diff.diff.changed.length ? (
            <div>
              <h4 className="inspector-h">{t("roster.history.changed")}</h4>
              <ul className="diff-list">
                {diff.diff.changed.map((u) => (
                  <li key={u.id} className="warn">
                    ~ {u.name} <span className="muted">({t("roster.history.pointsChange", { before: fmtInt(u.before), after: fmtInt(u.points) })})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {parsed.length === 0 ? (
        <div className="empty">{t("roster.history.empty")}</div>
      ) : (
        <ul className="version-list">
          {parsed.map(({ rec, roster: r, points: pts }, i) => {
            const current = rec.revision === roster.revision;
            return (
              <li key={rec.id} className={`version-row ${current ? "current" : ""}`.trim()}>
                <div className="grow">
                  <div>
                    <strong>{t("roster.history.revision", { n: rec.revision })}</strong> {current ? <span className="badge accent">{t("roster.history.current")}</span> : null}
                  </div>
                  <div className="small muted">
                    {fmtDate(rec.updatedAt)}
                    {pts !== undefined ? ` · ${t("unit.points", { v: fmtInt(pts) })}` : ""}
                    {r ? ` · ${t("armies.unitsCount", { n: r.units.length })}` : ""}
                  </div>
                </div>
                <div className="actions">
                  <button type="button" className="sm" disabled={!r || current} onClick={() => r && onRestore(r, rec.revision)}>
                    {t("roster.history.restore")}
                  </button>
                  <button type="button" className="sm ghost" disabled={i + 1 >= parsed.length || !r || !parsed[i + 1]?.roster} onClick={() => compare(i)}>
                    {t("roster.history.compare")}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
