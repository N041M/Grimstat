import { useCallback, useEffect, useMemo, useState } from "react";
import type { Roster, Snapshot } from "@grimstat/schema";
import { archetypes } from "@grimstat/game-40k-11e";
import { db, listGames, type GameRecord } from "../db";
import { useApp } from "../state/AppContext";
import { useStoreVersion } from "../hooks/useStoreVersion";
import { useGame, useWakeLock } from "../hooks/useGame";
import { usePersistedSetting } from "../hooks/usePersistedSetting";
import { NARROW_QUERY, useMediaQuery } from "../hooks/useMediaQuery";
import { atStrength, modelsLeft, opponentScenarioUnit, woundsLeft, NEW_UNIT_STATE, type OpponentUnit, type UnitState } from "../lib/game";
import { rosterHostEntries } from "../lib/unitSet";
import { navigate, useRouteInfo } from "../router";
import { BarSlot, ContextSlot, PageHeader } from "../components/shell";
import { PHASE_LABEL } from "../components/play/labels";
import { GameSetup } from "../components/play/GameSetup";
import { GameSidebar } from "../components/play/GameSidebar";
import { GameSummary } from "../components/play/GameSummary";
import { OddsPanel } from "../components/play/OddsPanel";
import { PhaseStrip } from "../components/play/PhaseStrip";
import { PlayStratagems } from "../components/play/PlayStratagems";
import { Scoreboard } from "../components/play/Scoreboard";
import { SecondariesPanel } from "../components/play/SecondariesPanel";
import { UnitRoll } from "../components/play/UnitRoll";
import type { PlayContext, PlayFoe, PlayUnit } from "../components/play/types";
import { t, type I18nKey } from "../i18n";

/** The body under the scoreboard. Kept as a tab set because a phone has one screen's worth of room. */
type PlayView = "units" | "odds" | "strats" | "score" | "summary";
const VIEWS: PlayView[] = ["units", "odds", "strats", "score", "summary"];
const parseView = (raw: unknown): PlayView | undefined => VIEWS.find((v) => v === raw);
const VIEW_LABEL: Record<PlayView, I18nKey> = { units: "play.view.units", odds: "play.view.odds", strats: "play.view.strats", score: "play.view.score", summary: "play.view.summary" };

/** The wounds and size of a resolved unit, taken from the most numerous model. */
function bulk(unit: PlayUnit["unit"]): { profileWounds: number; models: number } {
  const models = unit.models.reduce((s, m) => s + m.count, 0);
  const lead = unit.models.reduce<(typeof unit.models)[number] | undefined>((best, m) => (!best || m.count > best.count ? m : best), undefined);
  return { profileWounds: lead?.W ?? 1, models: Math.max(1, models) };
}

/**
 * Play: the companion for a game actually being played.
 *
 * It owns the only round, phase, score and command point state in the app. Nothing here enforces a
 * rule; the players at the table are the authority, and the assistant's job is to do the arithmetic,
 * remember what happened, and answer "what are my odds here" without leaving the table.
 */
export function PlayPage() {
  const { param } = useRouteInfo();
  const { snapshot: activeSnapshot, withOverrides, notify } = useApp();
  const [lastId, setLastId] = usePersistedSetting<string>("play.game", "", (raw) => (typeof raw === "string" ? raw : undefined));
  const gameId = param ?? (lastId || undefined);
  const game = useGame(gameId);
  const [games, setGames] = useState<GameRecord[] | undefined>(undefined);
  const [view, setView] = usePersistedSetting<PlayView>("play.view", "units", parseView);
  const [focus, setFocus] = usePersistedSetting<boolean>("play.focus", false, (raw) => (typeof raw === "boolean" ? raw : undefined));
  const narrow = useMediaQuery(NARROW_QUERY);
  const [roster, setRoster] = useState<Roster | undefined>(undefined);
  const [rosterSnapshot, setRosterSnapshot] = useState<Snapshot | undefined>(undefined);
  const version = useStoreVersion("games");

  // The screen stays awake only while a game is actually open.
  useWakeLock(!!game.game && !game.state.over);

  /**
   * Focus mode: on a phone the navigation bar sits under the thumb that is tapping "next phase" all
   * game, and leaving the screen mid-turn loses the player's place. While it is on the rail is
   * hidden and the only way off the screen is the deliberate control in the bar.
   *
   * The class goes on the document because the rail belongs to the shell, not to this page.
   */
  const focused = focus && narrow && !!game.game;
  useEffect(() => {
    if (!focused) return;
    document.body.classList.add("play-focused");
    return () => document.body.classList.remove("play-focused");
  }, [focused]);

  // Full screen hides the browser's own chrome, which is the other thing a stray tap reaches. It
  // needs a gesture and may be refused, so the mode works with or without it.
  const toggleFocus = useCallback(() => {
    const next = !focus;
    setFocus(next);
    try {
      if (next && !document.fullscreenElement) void document.documentElement.requestFullscreen?.().catch(() => undefined);
      else if (!next && document.fullscreenElement) void document.exitFullscreen?.().catch(() => undefined);
    } catch {
      // Refused by the browser. Hiding the rail is the part that matters.
    }
  }, [focus, setFocus]);

  useEffect(() => {
    let alive = true;
    void listGames()
      .then((all) => {
        if (alive) setGames(all);
      })
      .catch(() => {
        if (alive) setGames([]);
      });
    return () => {
      alive = false;
    };
  }, [version]);

  // Opening a game from the list puts it in the route; the last one opened is remembered so the
  // screen comes back to the same game after a reload at the table.
  useEffect(() => {
    if (param && param !== lastId) setLastId(param);
  }, [param, lastId, setLastId]);

  // The army being played, with its own snapshot when it was built against a different one.
  useEffect(() => {
    let alive = true;
    const id = game.game?.rosterId;
    if (!id) {
      setRoster(undefined);
      setRosterSnapshot(undefined);
      return;
    }
    void (async () => {
      const r = await db.rosters.get(id);
      if (!alive) return;
      setRoster(r);
      const snapId = game.game?.snapshotId ?? r?.snapshotId;
      const s = snapId ? await db.snapshots.get(snapId) : undefined;
      if (alive) setRosterSnapshot(s ? withOverrides(s) : undefined);
    })();
    return () => {
      alive = false;
    };
  }, [game.game?.rosterId, game.game?.snapshotId, withOverrides]);

  const snapshot = rosterSnapshot ?? activeSnapshot;

  const mine = useMemo<PlayUnit[]>(() => {
    if (!roster || !snapshot) return [];
    return rosterHostEntries(roster, snapshot).map((e) => {
      const id = e.source.kind === "roster" ? e.source.unitId : e.id;
      const state: UnitState = game.state.units[id] ?? NEW_UNIT_STATE;
      const { profileWounds, models } = bulk(e.unit);
      return { id, unit: e.unit, current: atStrength(e.unit, state, models), state, profileWounds, models, woundsLeft: woundsLeft(state, profileWounds, models), modelsLeft: modelsLeft(state, models) };
    });
  }, [roster, snapshot, game.state.units]);

  const foes = useMemo<PlayFoe[]>(
    () =>
      game.state.opponent.map((foe: OpponentUnit) => {
        const state: UnitState = game.state.opponentUnits[foe.id] ?? NEW_UNIT_STATE;
        const archetype = foe.archetypeId ? archetypes.find((a) => a.id === foe.archetypeId) : undefined;
        const unit = archetype ? { ...archetype.unit, name: foe.name || archetype.unit.name } : opponentScenarioUnit(foe, state);
        const { profileWounds, models } = archetype ? bulk(archetype.unit) : { profileWounds: foe.W, models: foe.models };
        return { id: foe.id, foe, unit, current: atStrength(unit, state, models), state, profileWounds, models, woundsLeft: woundsLeft(state, profileWounds, models), modelsLeft: modelsLeft(state, models) };
      }),
    [game.state.opponent, game.state.opponentUnits],
  );

  const ctx: PlayContext = useMemo(() => ({ game, roster, snapshot, mine, foes }), [game, roster, snapshot, mine, foes]);

  const openGame = useCallback(
    (rec: GameRecord) => {
      game.open(rec);
      setLastId(rec.id);
      navigate("play", false, rec.id);
    },
    [game, setLastId],
  );

  const nextPhase = useCallback(() => {
    const before = game.state;
    game.dispatch({ kind: "nextPhase" }, "phase", t("play.log.phase", { phase: t(PHASE_LABEL[before.phase]), round: before.round }));
  }, [game]);

  if (!game.loaded || games === undefined) {
    return (
      <>
        <PageHeader title={t("play.title")} subtitle={t("play.sub.loading")} />
        <div className="page-body">
          <p className="muted small">{t("play.loading")}</p>
        </div>
      </>
    );
  }

  if (!game.game) {
    return <GameSetup games={games} onOpen={openGame} notify={notify} />;
  }

  const g = game.game;
  const body =
    view === "units" ? <UnitRoll ctx={ctx} /> : view === "odds" ? <OddsPanel ctx={ctx} /> : view === "strats" ? <PlayStratagems ctx={ctx} /> : view === "score" ? <SecondariesPanel ctx={ctx} /> : <GameSummary ctx={ctx} />;

  return (
    <>
      <ContextSlot>
        <GameSidebar ctx={ctx} games={games} onOpen={openGame} />
      </ContextSlot>
      <BarSlot>
        <button type="button" className="ctx-bar-action primary" onClick={nextPhase}>
          {t("play.nextPhase")}
        </button>
        <button type="button" className="ctx-bar-action" disabled={!game.canUndo} onClick={game.undo}>
          {t("common.undo")}
        </button>
        <button type="button" className={`ctx-bar-action ${focus ? "on" : ""}`.trim()} aria-pressed={focus} title={t(focus ? "play.focus.offTitle" : "play.focus.onTitle")} onClick={toggleFocus}>
          {t(focus ? "play.focus.off" : "play.focus.on")}
        </button>
      </BarSlot>

      <div className="play-screen">
        <Scoreboard ctx={ctx} />
        <PhaseStrip ctx={ctx} onNext={nextPhase} />
        <div className="play-views" role="tablist" aria-label={t("play.views")}>
          {VIEWS.map((v) => (
            <button key={v} type="button" role="tab" aria-selected={v === view} className={`play-view-tab ${v === view ? "on" : ""}`.trim()} onClick={() => setView(v)}>
              {t(VIEW_LABEL[v])}
            </button>
          ))}
        </div>
        <div className="play-body">{body}</div>
        {g.state.over ? <p className="play-over">{t("play.finished")}</p> : null}
        {focused ? (
          <div className="play-focus-foot">
            <span>{t("play.focus.note")}</span>
            <button type="button" className="sm" onClick={toggleFocus}>
              {t("play.focus.off")}
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}
