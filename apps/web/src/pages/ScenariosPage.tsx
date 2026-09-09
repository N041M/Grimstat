import { useCallback, useEffect, useState } from "react";
import type { Scenario } from "@grimstat/schema";
import { db } from "../db";
import { useApp } from "../state/AppContext";
import { navigate } from "../router";
import { forStorage, touch } from "../lib/scenario";
import { newId, nowIso } from "../lib/ids";
import { permalinkUrl } from "../lib/permalink";
import { fmtDate } from "../lib/format";
import { Empty } from "../components/ui";
import { t } from "../i18n";

export function ScenariosPage() {
  const { scenario, activeSnapshotId, replaceScenario, notify } = useApp();
  const [items, setItems] = useState<Scenario[] | undefined>(undefined);
  const [link, setLink] = useState<{ id: string; url: string } | undefined>(undefined);

  const refresh = useCallback(async () => {
    const all = await db.scenarios.toArray();
    setItems(all.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const saveCurrent = async () => {
    const rec = forStorage(touch({ ...scenario, ...(activeSnapshotId ? { snapshotId: activeSnapshotId } : {}) }));
    await db.scenarios.put(rec);
    notify(t("scenario.saved", { name: rec.name }), "success");
    await refresh();
  };

  const load = async (s: Scenario) => {
    await replaceScenario(s, s.snapshotId);
    navigate("calculator");
  };

  const duplicate = async (s: Scenario) => {
    const now = nowIso();
    const copy: Scenario = { ...s, id: newId("sc"), name: t("scenario.copyName", { name: s.name }), createdAt: now, updatedAt: now, revision: 0 };
    await db.scenarios.put(copy);
    await refresh();
  };

  const remove = async (s: Scenario) => {
    if (!window.confirm(t("scenario.confirmDelete", { name: s.name }))) return;
    await db.scenarios.delete(s.id);
    await refresh();
  };

  const share = async (s: Scenario) => {
    const url = permalinkUrl(s.snapshotId ? { scenario: s, snapshotId: s.snapshotId } : { scenario: s });
    setLink({ id: s.id, url });
    try {
      await navigator.clipboard.writeText(url);
      notify(t("scenario.linkCopied"), "success");
    } catch {
      /* clipboard unavailable: the link box below is selectable */
    }
  };

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>{t("nav.scenarios")}</h1>
          <p>{t("scenarios.intro")}</p>
        </div>
        <button type="button" className="primary" onClick={() => void saveCurrent()}>
          {t("scenarios.saveCurrent", { name: scenario.name })}
        </button>
      </div>
      {items === undefined ? null : items.length === 0 ? (
        <Empty>{t("scenarios.empty")}</Empty>
      ) : (
        <div className="list">
          {items.map((s) => (
            <div key={s.id} className={`list-item ${s.id === scenario.id ? "active" : ""}`}>
              <div className="grow">
                <div>
                  <strong>{s.name}</strong> {s.id === scenario.id ? <span className="badge accent">{t("scenarios.current")}</span> : null}
                </div>
                <div className="small muted">
                  {s.attacker.name} → {s.defender.name} · {fmtDate(s.updatedAt)}
                  {s.snapshotId ? ` · ${t("scenarios.snapshot", { id: s.snapshotId })}` : ""}
                </div>
                {link?.id === s.id ? <input type="text" readOnly value={link.url} aria-label={t("scenario.permalink")} style={{ width: "100%", marginTop: 6, fontFamily: "var(--mono)", fontSize: "0.7rem" }} onFocus={(e) => e.currentTarget.select()} /> : null}
              </div>
              <div className="actions">
                <button type="button" className="sm primary" onClick={() => void load(s)}>
                  {t("scenarios.load")}
                </button>
                <button type="button" className="sm" onClick={() => void share(s)}>
                  {t("scenarios.link")}
                </button>
                <button type="button" className="sm" onClick={() => void duplicate(s)}>
                  {t("scenarios.duplicate")}
                </button>
                <button type="button" className="sm danger" onClick={() => void remove(s)}>
                  {t("scenarios.delete")}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
