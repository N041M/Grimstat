import type { Datasheet, Snapshot } from "@grimstat/schema";
import { UnitArt } from "../UnitArt";
import { Empty } from "../ui";
import { COMPARE_CAP, representativeProfile, sizeBounds, unitFigures, type CodexFaction, type CodexGroup } from "../../lib/codex";
import { hrefFor } from "../../router";
import { CodexTools, GROUP_KEY, NoMatch, pointsText, sizeText } from "./shared";
import { t } from "../../i18n";

function SheetCard({ ds, snapshot, inCompare, full, onToggle, onPick }: { ds: Datasheet; snapshot: Snapshot; inCompare: boolean; full: boolean; onToggle: () => void; onPick: () => void }) {
  const rep = representativeProfile(ds);
  const fig = unitFigures(ds, snapshot);
  const label = t(inCompare ? "codex.card.uncompare" : "codex.card.compare", { name: ds.name });
  return (
    <div className={`codex-card ${inCompare ? "in-compare" : ""}`.trim()}>
      <a className="codex-card-link" href={hrefFor("codex", ds.id)} onClick={onPick}>
        <span className="codex-card-head">
          <UnitArt of={ds} />
          <span className="codex-card-name">{ds.name}</span>
        </span>
        <span className="codex-card-meta">{[ds.role, sizeText(sizeBounds(ds))].filter(Boolean).join(" · ")}</span>
        {rep ? (
          <span className="codex-card-stats">
            <span>
              <b>T</b>
              {rep.T}
            </span>
            <span>
              <b>Sv</b>
              {rep.Sv}+
            </span>
            {rep.InvSv ? (
              <span>
                <b>Inv</b>
                {rep.InvSv}+
              </span>
            ) : null}
            <span>
              <b>W</b>
              {rep.W}
            </span>
            <span>
              <b>OC</b>
              {rep.OC ?? "–"}
            </span>
          </span>
        ) : null}
        <span className="codex-card-points">{pointsText(fig.minPoints, fig.maxPoints)}</span>
      </a>
      <button type="button" className="codex-card-cmp" aria-pressed={inCompare} aria-label={label} title={!inCompare && full ? t("codex.compareFull", { n: COMPARE_CAP }) : label} disabled={!inCompare && full} onClick={onToggle}>
        {inCompare ? "✓" : "+"}
      </button>
    </div>
  );
}

interface Props {
  snapshot: Snapshot;
  factions: CodexFaction[];
  factionId: string;
  onFaction: (id: string) => void;
  query: string;
  onQuery: (q: string) => void;
  groups: CodexGroup[];
  compare: string[];
  onToggleCompare: (id: string) => void;
  onPick: () => void;
}

/**
 * What the main region shows before a sheet is opened: the same filter as the column and the
 * faction's datasheets as cards, each with the numbers that tell units apart and a compare mark.
 * On a phone, where the column lives in a sheet, this is the browser.
 */
export function CodexLanding({ snapshot, factions, factionId, onFaction, query, onQuery, groups, compare, onToggleCompare, onPick }: Props) {
  const total = groups.reduce((s, g) => s + g.sheets.length, 0);
  const full = compare.length >= COMPARE_CAP;
  return (
    <div className="codex-landing">
      <p className="codex-lede">{t("codex.landing.lede")}</p>
      <div className="codex-landing-tools">
        <CodexTools factions={factions} factionId={factionId} onFaction={onFaction} query={query} onQuery={onQuery} />
        <span className="t-meta codex-landing-count">{t("codex.landing.count", { n: total })}</span>
      </div>
      {groups.length === 0 ? (
        <Empty>
          <NoMatch query={query} factions={factions} factionId={factionId} onFaction={onFaction} />
        </Empty>
      ) : null}
      {groups.map((g) => (
        <section key={g.group} className="codex-group">
          <h2 className="codex-group-title">
            {t(GROUP_KEY[g.group])} <span>{g.sheets.length}</span>
          </h2>
          <div className="codex-cards">
            {g.sheets.map((d) => (
              <SheetCard key={d.id} ds={d} snapshot={snapshot} inCompare={compare.includes(d.id)} full={full} onToggle={() => onToggleCompare(d.id)} onPick={onPick} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
