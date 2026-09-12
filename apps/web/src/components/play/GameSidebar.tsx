import { useMemo, useState } from "react";
import type { GameRecord } from "../../db";
import { totalsFor } from "../../lib/game";
import { fmtDay, fmtInt } from "../../lib/format";
import { hrefFor } from "../../router";
import { ContextEmpty, ContextList, ContextRow } from "../shell";
import { PHASE_LABEL } from "./labels";
import type { PlayContext } from "./types";
import { t } from "../../i18n";

interface Props {
  ctx: PlayContext;
  games: GameRecord[];
  onOpen: (rec: GameRecord) => void;
}

/**
 * The context column while a game is open: what this game is, what it is being played with, where
 * the score stands, and everything that has happened in it.
 *
 * The log is the point of the column. A game is decided by arguments about what was scored in round
 * two, and this is the only record of it.
 */
export function GameSidebar({ ctx, games, onOpen }: Props) {
  const { game } = ctx;
  const rec = game.game;
  const { state } = game;
  const [draft, setDraft] = useState<string | undefined>(undefined);

  const mine = totalsFor(state.you, state.secondaries);
  const theirs = totalsFor(state.them, state.secondaries);
  const entries = useMemo(() => [...game.log].reverse(), [game.log]);
  const others = useMemo(() => games.filter((g) => g.id !== rec?.id), [games, rec?.id]);

  const commitName = () => {
    const value = draft;
    setDraft(undefined);
    if (value === undefined) return;
    const next = value.trim();
    if (!next || next === rec?.name) return;
    game.rename(next);
  };

  const finish = (over: boolean) => {
    game.dispatch({ kind: "finish", over }, "note", over ? t("play.gs.logFinish") : t("play.gs.logReopen"));
  };

  return (
    <div className="play-gs">
      <div className="ctx-lede">
        <input
          className="play-gs-name"
          value={draft ?? rec?.name ?? ""}
          aria-label={t("play.gs.nameAria")}
          placeholder={t("play.setup.untitled")}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
        />
        <div className="ctx-lede-meta">{state.over ? t("play.gs.over") : t("play.gs.round", { n: state.round, phase: t(PHASE_LABEL[state.phase]) })}</div>
      </div>

      <ContextList>
        <ContextRow
          name={t("play.gs.army")}
          value={ctx.roster ? undefined : t("play.gs.noArmy")}
          meta={ctx.roster?.name}
          {...(ctx.roster ? { href: hrefFor("armies", ctx.roster.id) } : { inert: true })}
        />
        <ContextRow name={t("play.side.you")} value={fmtInt(mine.total)} meta={t("play.sec.split", { p: fmtInt(mine.primary), s: fmtInt(mine.secondary) })} inert />
        <ContextRow name={t("play.side.them")} value={fmtInt(theirs.total)} meta={t("play.sec.split", { p: fmtInt(theirs.primary), s: fmtInt(theirs.secondary) })} inert />
        <ContextRow name={t("play.cp.label")} value={fmtInt(state.you.cp)} meta={t("play.gs.cpMeta")} inert />
      </ContextList>

      <div className="play-gs-finish">
        <button type="button" className={state.over ? "" : "danger"} onClick={() => finish(!state.over)}>
          {state.over ? t("play.gs.reopen") : t("play.gs.finish")}
        </button>
      </div>

      <div className="play-gs-sec">
        <div className="play-gs-head t-eyebrow">{t("play.gs.log")}</div>
        {entries.length === 0 ? (
          <ContextEmpty>{t("play.gs.noLog")}</ContextEmpty>
        ) : (
          <ol className="play-gs-log">
            {entries.map((e) => (
              <li key={e.id} className="play-gs-log-row">
                <span className="play-gs-log-when">{t("play.gs.logWhen", { round: e.round, phase: t(PHASE_LABEL[e.phase]) })}</span>
                <span className="play-gs-log-text">{e.text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="play-gs-sec">
        <div className="play-gs-head t-eyebrow">{t("play.gs.other")}</div>
        {others.length === 0 ? (
          <ContextEmpty>{t("play.gs.noOther")}</ContextEmpty>
        ) : (
          <ContextList>
            {others.map((g) => {
              const you = totalsFor(g.state.you, g.state.secondaries).total;
              const them = totalsFor(g.state.them, g.state.secondaries).total;
              return (
                <ContextRow
                  key={g.id}
                  name={g.name || t("play.setup.untitled")}
                  value={t("play.setup.score", { you: fmtInt(you), them: fmtInt(them) })}
                  meta={`${fmtDay(g.updatedAt)} · ${g.state.over ? t("play.setup.over") : t("play.setup.inProgress", { n: g.state.round })}`}
                  onClick={() => onOpen(g)}
                />
              );
            })}
          </ContextList>
        )}
      </div>
    </div>
  );
}
