import { useMemo, useState } from "react";
import type { Roster, Snapshot } from "@grimstat/schema";
import { usePersistedSetting } from "../../hooks/usePersistedSetting";
import { anyStratagemNamesAUnit, cpRange, filterStratagems, groupStratagems, stratagemParts, stratagemPhases, stratagemsForRoster, type RosterStratagem, type StratagemGroup } from "../../lib/stratagems";
import { rulesTextState } from "../../lib/importProgress";
import { hrefFor } from "../../router";
import { Empty } from "../ui";
import { PanelHead, PillChip } from "../kit";
import { t, tn, type I18nKey } from "../../i18n";

interface Props {
  roster: Roster;
  snapshot: Snapshot;
}

const PART_LABEL: Record<"when" | "target" | "effect" | "restrictions", I18nKey> = {
  when: "roster.strat.when",
  target: "roster.strat.target",
  effect: "roster.strat.effect",
  restrictions: "roster.strat.restrictions",
};

const SOURCE_LABEL: Record<StratagemGroup["source"], I18nKey> = {
  detachment: "roster.strat.source.detachment",
  faction: "roster.strat.source.faction",
  core: "roster.strat.source.core",
};

/** The turn a stratagem may be used in, when the source recorded one. */
function turnLabel(turn: string | undefined): string | undefined {
  if (turn === "your") return t("roster.strat.turn.your");
  if (turn === "opponent") return t("roster.strat.turn.opponent");
  if (turn === "either") return t("roster.strat.turn.either");
  return undefined;
}

function Card({ item }: { item: RosterStratagem }) {
  const s = item.stratagem;
  const parts = stratagemParts(s);
  const turn = turnLabel(s.turn);
  const meta = [s.type, turn, ...s.phases].filter(Boolean) as string[];
  return (
    <article className="strat-card">
      <div className="strat-card-head">
        <h4 className="strat-name">{s.name}</h4>
        <span className="strat-cp">{tn(s.cpCost, "roster.strat.cp.one", "roster.strat.cp.many", { n: s.cpCost })}</span>
      </div>
      {meta.length ? <div className="strat-meta">{meta.join(" · ")}</div> : null}
      {parts.length ? (
        <dl className="strat-parts">
          {parts.map((p) => (
            <div key={p.key}>
              <dt>{t(PART_LABEL[p.key])}</dt>
              <dd>{p.text}</dd>
            </div>
          ))}
        </dl>
      ) : s.text ? (
        <p className="strat-text">{s.text}</p>
      ) : (
        <p className="strat-text muted">{t("roster.strat.noText")}</p>
      )}
      {item.units.length ? (
        <div className="strat-units">
          <span className="t-eyebrow">{t("roster.strat.forUnits")}</span> {item.units.join(", ")}
        </div>
      ) : null}
    </article>
  );
}

/**
 * Armies → Stratagems: what this list may actually spend CP on. The reach is the same one the
 * printable reference pack uses, so the tab and the print-out never disagree: the detachments the
 * list took, the faction's own, and the core ones.
 *
 * Only the rules text export carries stratagems, so a snapshot built without it has none. The empty
 * state reads the snapshot to tell the two cases apart: the export was never asked for, or it was
 * asked for and did not answer. Telling somebody to set up a mirror they have already set up is the
 * one thing this screen must not do.
 */
export function StratagemsTab({ roster, snapshot }: Props) {
  const [query, setQuery] = useState("");
  const [phase, setPhase] = useState<string | undefined>(undefined);
  // Reading preferences, so they are remembered across armies.
  const [unitsOnly, setUnitsOnly] = usePersistedSetting<boolean>("roster.strat.unitsOnly", false, (raw) => (typeof raw === "boolean" ? raw : undefined));

  const all = useMemo(() => stratagemsForRoster(roster, snapshot), [roster, snapshot]);
  const phases = useMemo(() => stratagemPhases(all), [all]);
  // A snapshot with no datasheet-to-stratagem links cannot answer "only the ones a unit names", so
  // the filter is neither offered nor applied against one. Left applied it emptied the tab for every
  // army, and the setting is remembered across armies, so one click hid the list for good.
  const byUnitAvailable = useMemo(() => anyStratagemNamesAUnit(all), [all]);
  const byUnit = unitsOnly && byUnitAvailable;
  const shown = useMemo(() => filterStratagems(all, { query, phase, unitsOnly: byUnit }), [all, query, phase, byUnit]);
  const groups = useMemo(() => groupStratagems(shown), [shown]);
  const cp = useMemo(() => cpRange(all), [all]);
  const clearFilters = () => {
    setQuery("");
    setPhase(undefined);
    setUnitsOnly(false);
  };

  if (all.length === 0) {
    const hasAny = (snapshot.data.stratagems ?? []).length > 0;
    const rules = rulesTextState(snapshot);
    return (
      <div className="army-strats">
        <Empty>
          <p>{hasAny ? t("roster.strat.noneForList") : t(rules.state === "failed" ? "roster.strat.noneAfterFailure" : "roster.strat.noneInData")}</p>
          {hasAny ? null : (
            <p>
              <a href={hrefFor("data")}>{t("roster.strat.dataLink")}</a>
            </p>
          )}
        </Empty>
      </div>
    );
  }

  return (
    <div className="army-strats">
      <PanelHead
        title={t("roster.strat.title")}
        aside={<span className="t-meta">{cp ? t("roster.strat.summary", { n: all.length, min: cp.min, max: cp.max }) : tn(all.length, "roster.strat.count.one", "roster.strat.count.many", { n: all.length })}</span>}
      />
      <p className="data-note">{t("roster.strat.intro")}</p>
      <div className="strat-tools">
        <input type="search" className="strat-search" value={query} placeholder={t("roster.strat.filter")} aria-label={t("roster.strat.filter")} onChange={(e) => setQuery(e.target.value)} />
        {phases.length ? (
          <div className="strat-phases" role="group" aria-label={t("roster.strat.phase")}>
            <PillChip label={t("roster.strat.phase.any")} on={phase === undefined} onChange={() => setPhase(undefined)} />
            {phases.map((p) => (
              <PillChip key={p} label={p} on={phase === p} onChange={() => setPhase(phase === p ? undefined : p)} />
            ))}
          </div>
        ) : null}
        {byUnitAvailable ? <PillChip label={t("roster.strat.unitsOnly")} title={t("roster.strat.unitsOnlyTitle")} on={byUnit} onChange={setUnitsOnly} /> : null}
      </div>

      {shown.length === 0 ? (
        <p className="strat-none">
          {t("roster.strat.noMatch")}{" "}
          <button type="button" className="link-btn" onClick={clearFilters}>
            {t("roster.strat.clearFilters")}
          </button>
        </p>
      ) : (
        groups.map((g) => (
          <section key={`${g.source}:${g.name ?? ""}`} className="strat-group" aria-label={g.name ?? t(SOURCE_LABEL[g.source])}>
            <h3 className="strat-group-head">
              <span>{g.name ?? t(SOURCE_LABEL[g.source])}</span>
              <span className="t-meta">{g.name ? t(SOURCE_LABEL[g.source]) : null}</span>
            </h3>
            <div className="strat-cards">
              {g.items.map((item) => (
                <Card key={item.stratagem.id} item={item} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
