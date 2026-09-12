import { useMemo, useState } from "react";
import { FINAL_ROUND, scoredIn, totalsFor, type Secondary, type Side } from "../../lib/game";
import { newId } from "../../lib/ids";
import { fmtInt } from "../../lib/format";
import { Icon, Tabs, useConfirm } from "../ui";
import { GridCell, GridHead, GridHeadCell, GridRow, GridTable, PanelHead } from "../kit";
import { SIDE_LABEL } from "./labels";
import type { PlayContext } from "./types";
import { t } from "../../i18n";

/** A scoring line: the primary, which has no id, or one of the secondaries the players agreed on. */
interface Line {
  id: string | undefined;
  name: string;
  cap: number | undefined;
}

/**
 * One cell of the grid. The value on screen comes from the game while the cell is idle; typing
 * holds a draft so the box can be emptied mid-edit, and the number is written to the game once, on
 * blur, so the log gets one line per figure entered rather than one per keystroke.
 */
function ScoreCell({ value, label, onCommit }: { value: number | undefined; label: string; onCommit: (points: number) => void }) {
  const [draft, setDraft] = useState<string | undefined>(undefined);

  const commit = () => {
    const raw = draft;
    setDraft(undefined);
    if (raw === undefined) return;
    const text = raw.trim();
    if (text === "" && value === undefined) return;
    const n = text === "" ? 0 : Number(text);
    if (!Number.isFinite(n)) return;
    const points = Math.max(0, Math.round(n));
    if (points === value) return;
    onCommit(points);
  };

  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      className="sec-in"
      aria-label={label}
      value={draft ?? (value === undefined ? "" : String(value))}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
    />
  );
}

/**
 * The scoring screen: primary and secondary points, per round, for both sides.
 *
 * No mission data ships with the app, so the secondaries are the ones the players agreed on and
 * typed here. A cap can be set on a secondary; the totals apply it without changing what was
 * entered, so the per-round figures stay the record of what happened.
 */
export function SecondariesPanel({ ctx }: { ctx: PlayContext }) {
  const { game } = ctx;
  const { state } = game;
  const [side, setSide] = useState<Side>("you");
  const [name, setName] = useState("");
  const [cap, setCap] = useState("");
  const { confirm, dialog } = useConfirm();

  const rounds = useMemo(() => Array.from({ length: Math.max(FINAL_ROUND, state.round) }, (_, i) => i + 1), [state.round]);
  const mine = totalsFor(state.you, state.secondaries);
  const theirs = totalsFor(state.them, state.secondaries);
  const sideState = state[side];
  const totals = side === "you" ? mine : theirs;

  const lines: Line[] = [{ id: undefined, name: t("play.sec.primary"), cap: undefined }, ...state.secondaries.map((s) => ({ id: s.id, name: s.name, cap: s.cap }))];

  const lineTotal = (line: Line): number => {
    const raw = sideState.scores.filter((s) => s.secondaryId === line.id).reduce((sum, s) => sum + s.points, 0);
    return line.cap === undefined ? raw : Math.min(raw, line.cap);
  };

  const commit = (line: Line, round: number, points: number) => {
    const text = line.id
      ? t("play.sec.logSecondary", { side: t(SIDE_LABEL[side]), n: points, name: line.name, round })
      : t("play.sec.logPrimary", { side: t(SIDE_LABEL[side]), n: points, round });
    game.dispatch({ kind: "score", side, points, round, ...(line.id ? { secondaryId: line.id } : {}) }, "score", text);
  };

  const add = () => {
    const label = name.trim();
    if (!label) return;
    const limit = Number(cap.trim());
    const secondary: Secondary = { id: newId("sec"), name: label, ...(cap.trim() !== "" && Number.isFinite(limit) && limit > 0 ? { cap: Math.round(limit) } : {}) };
    game.dispatch({ kind: "addSecondary", secondary }, "note", t("play.sec.logAdd", { name: label }));
    setName("");
    setCap("");
  };

  const remove = async (secondary: Secondary) => {
    const ok = await confirm({ title: t("play.sec.removeTitle"), body: t("play.sec.removeBody"), confirmLabel: t("common.remove"), danger: true });
    if (!ok) return;
    game.dispatch({ kind: "removeSecondary", id: secondary.id }, "note", t("play.sec.logRemove", { name: secondary.name }));
  };

  const columns = `minmax(96px, 1fr) repeat(${rounds.length}, 50px) 54px`;

  return (
    <div className="sec">
      <div className="sec-totals">
        <div className={`sec-total ${mine.total >= theirs.total ? "ahead" : ""}`.trim()}>
          <span className="sec-total-k">{t("play.side.you")}</span>
          <span className="sec-total-v">{fmtInt(mine.total)}</span>
          <span className="sec-total-m">{t("play.sec.split", { p: fmtInt(mine.primary), s: fmtInt(mine.secondary) })}</span>
        </div>
        <span className="sec-total-dash" aria-hidden="true">
          –
        </span>
        <div className={`sec-total ${theirs.total >= mine.total ? "ahead" : ""}`.trim()}>
          <span className="sec-total-k">{t("play.side.them")}</span>
          <span className="sec-total-v">{fmtInt(theirs.total)}</span>
          <span className="sec-total-m">{t("play.sec.split", { p: fmtInt(theirs.primary), s: fmtInt(theirs.secondary) })}</span>
        </div>
      </div>

      <PanelHead
        title={t("play.sec.title")}
        aside={
          <Tabs
            tabs={[
              { id: "you" as Side, label: t("play.side.you") },
              { id: "them" as Side, label: t("play.side.them") },
            ]}
            value={side}
            onChange={setSide}
            label={t("play.sec.side")}
          />
        }
      />

      <div className="sec-scroll">
        <GridTable columns={columns} label={t("play.sec.grid")} className="sec-grid">
          <GridHead>
            <GridHeadCell>{t("play.sec.line")}</GridHeadCell>
            {rounds.map((r) => (
              <GridHeadCell key={r} align="end">
                {t("play.sec.roundShort", { n: r })}
              </GridHeadCell>
            ))}
            <GridHeadCell align="end">{t("play.sec.total")}</GridHeadCell>
          </GridHead>

          {lines.map((line) => (
            <GridRow key={line.id ?? "primary"}>
              <GridCell>
                <span className="sec-line">
                  <span className="sec-line-name">{line.name}</span>
                  {line.cap === undefined ? null : <span className="sec-cap">{t("play.sec.capShort", { n: line.cap })}</span>}
                </span>
                {line.id ? (
                  <button
                    type="button"
                    className="ghost sec-del"
                    aria-label={t("play.sec.remove", { name: line.name })}
                    onClick={() => {
                      const secondary = state.secondaries.find((s) => s.id === line.id);
                      if (secondary) void remove(secondary);
                    }}
                  >
                    <Icon name="trash" />
                  </button>
                ) : null}
              </GridCell>
              {rounds.map((r) => (
                <GridCell key={r} align="end">
                  <ScoreCell
                    key={`${side}-${r}`}
                    value={scoredIn(sideState, r, line.id)}
                    label={t("play.sec.cell", { line: line.name, round: r, side: t(SIDE_LABEL[side]) })}
                    onCommit={(points) => commit(line, r, points)}
                  />
                </GridCell>
              ))}
              <GridCell align="end" mono>
                {fmtInt(lineTotal(line))}
              </GridCell>
            </GridRow>
          ))}

          <GridRow className="sec-foot">
            <GridCell>{t("play.sec.perRound")}</GridCell>
            {rounds.map((r) => (
              <GridCell key={r} align="end" mono>
                {fmtInt(totals.byRound.get(r) ?? 0)}
              </GridCell>
            ))}
            <GridCell align="end" mono>
              {fmtInt(totals.total)}
            </GridCell>
          </GridRow>
        </GridTable>
      </div>

      {state.secondaries.length === 0 ? <p className="sec-note">{t("play.sec.none")}</p> : null}

      <form
        className="sec-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <input className="sec-add-name" value={name} placeholder={t("play.sec.addPlaceholder")} aria-label={t("play.sec.addName")} onChange={(e) => setName(e.target.value)} />
        <input className="sec-add-cap" type="number" inputMode="numeric" min={0} value={cap} placeholder={t("play.sec.addCap")} aria-label={t("play.sec.addCap")} onChange={(e) => setCap(e.target.value)} />
        <button type="submit" className="primary" disabled={!name.trim()}>
          {t("play.sec.addButton")}
        </button>
      </form>
      <p className="sec-note">{t("play.sec.note")}</p>
      {dialog}
    </div>
  );
}
