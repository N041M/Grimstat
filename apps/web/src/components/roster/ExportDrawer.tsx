import { useState } from "react";
import type { Roster, Snapshot } from "@grimstat/schema";
import { exportRosterPrintHtml, exportRosterText, type RosterTextDialect } from "@grimstat/adapters";
import { download, openHtmlInNewTab } from "../../lib/download";
import { rosterPermalinkUrl } from "../../lib/rosterPermalink";
import { useApp } from "../../state/AppContext";
import { t } from "../../i18n";

interface Props {
  roster: Roster;
  snapshot: Snapshot;
  onClose: () => void;
}

const DIALECTS: Array<{ id: RosterTextDialect; key: "roster.export.gw" | "roster.export.nr" | "roster.export.md" }> = [
  { id: "gw-app", key: "roster.export.gw" },
  { id: "nr-tournament", key: "roster.export.nr" },
  { id: "markdown", key: "roster.export.md" },
];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "army";

export function ExportDrawer({ roster, snapshot, onClose }: Props) {
  const { notify } = useApp();
  const [text, setText] = useState<{ dialect: RosterTextDialect; body: string } | undefined>(undefined);
  const [link, setLink] = useState<string | undefined>(undefined);

  const guard = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      notify(t("roster.export.failed", { msg: e instanceof Error ? e.message : String(e) }), "error");
    }
  };

  const show = (dialect: RosterTextDialect) => guard(() => setText({ dialect, body: exportRosterText(roster, snapshot, dialect) }));
  const json = () => download(`${slug(roster.name)}.json`, roster);
  const print = () =>
    guard(() => {
      if (!openHtmlInNewTab(exportRosterPrintHtml(roster, snapshot))) notify(t("roster.export.printBlocked"), "info");
    });
  const permalink = () => setLink(rosterPermalinkUrl({ roster, snapshotId: roster.snapshotId }));

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      notify(t("roster.export.copied"), "success");
    } catch {
      notify(t("roster.export.copyFailed"), "info");
    }
  };

  return (
    <div className="stack">
      <div className="panel-head">
        <h3 style={{ margin: 0 }}>{t("roster.export.title")}</h3>
        <button type="button" className="ghost sm" onClick={onClose} aria-label={t("common.close")}>
          ×
        </button>
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {t("roster.export.hint")}
      </p>
      <div className="row">
        {DIALECTS.map((d) => (
          <button key={d.id} type="button" className="sm" aria-pressed={text?.dialect === d.id} onClick={() => show(d.id)}>
            {t(d.key)}
          </button>
        ))}
      </div>
      {text ? (
        <div className="stack">
          <textarea readOnly rows={14} value={text.body} aria-label={t("roster.export.output")} className="mono" onFocus={(e) => e.currentTarget.select()} />
          <div className="row">
            <button type="button" className="sm" onClick={() => void copy(text.body)}>
              {t("roster.export.copy")}
            </button>
          </div>
        </div>
      ) : null}
      <div className="row">
        <button type="button" className="sm" onClick={json}>
          {t("roster.export.json")}
        </button>
        <button type="button" className="sm" onClick={print}>
          {t("roster.export.print")}
        </button>
        <button type="button" className="sm" onClick={permalink}>
          {t("roster.export.permalink")}
        </button>
      </div>
      {link ? (
        <div className="link-box">
          <input type="text" readOnly value={link} aria-label={t("roster.export.permalink")} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className="sm" onClick={() => void copy(link)}>
            {t("roster.export.copy")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
