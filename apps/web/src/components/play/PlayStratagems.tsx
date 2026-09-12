import { useMemo, useState } from "react";
import type { Side } from "../../lib/game";
import { filterStratagems, groupStratagems, stratagemParts, stratagemsForRoster, type RosterStratagem, type StratagemGroup } from "../../lib/stratagems";
import { hrefFor } from "../../router";
import { Empty } from "../ui";
import { PanelHead, PillChip } from "../kit";
import { PHASE_LABEL, stratagemMatchesPhase } from "./labels";
import type { PlayContext } from "./types";
import { t, tn, type I18nKey } from "../../i18n";

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

function turnLabel(turn: string | undefined): string | undefined {
  if (turn === "your") return t("roster.strat.turn.your");
  if (turn === "opponent") return t("roster.strat.turn.opponent");
  if (turn === "either") return t("roster.strat.turn.either");
  return undefined;
}

/** Whether a stratagem may be used in the turn now being played. An unrecorded turn matches both. */
function matchesTurn(turn: string | undefined, active: Side): boolean {
  if (turn === undefined || turn === "either") return true;
  return active === "you" ? turn === "your" : turn === "opponent";
}

function Card({ item, cp, onUse }: { item: RosterStratagem; cp: number; onUse: () => void }) {
  const s = item.stratagem;
  const afford = s.cpCost <= cp;
  const parts = stratagemParts(s);
  const meta = [s.type, turnLabel(s.turn), ...s.phases].filter(Boolean).join(" · ");
  return (
    <article className={`pstrat-card ${afford ? "" : "short"}`.trim()}>
      <div className="pstrat-head">
        <h4 className="pstrat-name">{s.name}</h4>
        <button type="button" className={`pstrat-use ${afford ? "primary" : ""}`.trim()} disabled={!afford} onClick={onUse}>
          {afford ? t("play.strat.use", { n: s.cpCost }) : t("play.strat.short", { n: s.cpCost })}
        </button>
      </div>
      {meta ? <div className="pstrat-meta">{meta}</div> : null}
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
 * What the player can spend command points on at this exact moment: the stratagems their list
 * carries, narrowed to the phase on the tracker and to whose turn it is.
 *
 * Ones that cost more than the command points in hand stay on screen and dimmed, because knowing
 * what is out of reach is part of deciding whether to spend now or hold.
 */
export function PlayStratagems({ ctx }: { ctx: PlayContext }) {
  const { roster, snapshot, game } = ctx;
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState("");

  const { phase, active } = game.state;
  const cp = game.state.you.cp;

  const all = useMemo(() => (roster && snapshot ? stratagemsForRoster(roster, snapshot) : []), [roster, snapshot]);
  const now = useMemo(() => all.filter((s) => stratagemMatchesPhase(s.stratagem.phases, phase) && matchesTurn(s.stratagem.turn, active)), [all, phase, active]);
  const shown = useMemo(() => filterStratagems(showAll ? all : now, { query }), [all, now, showAll, query]);
  const groups = useMemo(() => groupStratagems(shown), [shown]);
  const affordable = shown.filter((s) => s.stratagem.cpCost <= cp).length;

  if (!roster) return <Empty>{t("play.strat.noRoster")}</Empty>;
  if (!snapshot) return <Empty>{t("play.strat.noSnapshot")}</Empty>;
  if ((snapshot.data.stratagems ?? []).length === 0)
    return (
      <Empty>
        <p>{t("roster.strat.noneInData")}</p>
        <p>
          <a href={hrefFor("data")}>{t("roster.strat.dataLink")}</a>
        </p>
      </Empty>
    );
  if (all.length === 0) return <Empty>{t("roster.strat.noneForList")}</Empty>;

  const use = (item: RosterStratagem) => {
    const s = item.stratagem;
    game.dispatch({ kind: "spendStratagem", side: "you", cp: s.cpCost, name: s.name }, "stratagem", t("play.strat.log", { name: s.name, n: s.cpCost }), { amount: s.cpCost, side: "you" });
  };

  return (
    <div className="pstrat">
      <PanelHead title={t("play.strat.title")} aside={<span className="t-meta">{t("play.strat.aside", { n: affordable, cp })}</span>} />
      <p className="pstrat-now">{showAll ? t("play.strat.allNote") : t("play.strat.nowNote", { phase: t(PHASE_LABEL[phase]), turn: active === "you" ? t("play.turn.yours") : t("play.turn.theirs") })}</p>
      <div className="pstrat-tools">
        <input type="search" className="pstrat-search" value={query} placeholder={t("roster.strat.filter")} aria-label={t("roster.strat.filter")} onChange={(e) => setQuery(e.target.value)} />
        <PillChip label={t("play.strat.showAll")} title={t("play.strat.showAllTitle")} on={showAll} onChange={setShowAll} />
      </div>

      {shown.length === 0 ? (
        <p className="pstrat-none">
          {query.trim() ? t("roster.strat.noMatch") : t("play.strat.noneNow", { phase: t(PHASE_LABEL[phase]) })}
          {query.trim() || showAll ? null : (
            <button type="button" className="pstrat-showall" onClick={() => setShowAll(true)}>
              {t("play.strat.showAll")}
            </button>
          )}
        </p>
      ) : (
        groups.map((g) => (
          <section key={`${g.source}:${g.name ?? ""}`} className="pstrat-group" aria-label={g.name ?? t(SOURCE_LABEL[g.source])}>
            <h3 className="pstrat-group-head">
              <span>{g.name ?? t(SOURCE_LABEL[g.source])}</span>
              <span className="t-meta">{tn(g.items.length, "roster.strat.count.one", "roster.strat.count.many", { n: g.items.length })}</span>
            </h3>
            <div className="pstrat-cards">
              {g.items.map((item) => (
                <Card key={item.stratagem.id} item={item} cp={cp} onUse={() => use(item)} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
