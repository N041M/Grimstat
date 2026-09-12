import { useCallback, useEffect, useRef, useState } from "react";
import { db, saveGame, type GameRecord } from "../db";
import { applyAction, logEntry, newGameState, type GameAction, type GameState, type LogEntry, type LogFacts, type LogKind } from "../lib/game";
import { newId, nowIso } from "../lib/ids";

/** How many steps back the tracker can go. A game is long; a mis-tap is usually noticed at once. */
export const UNDO_CAP = 40;

export interface GameHandle {
  game: GameRecord | undefined;
  /** False until the first read from the database lands. */
  loaded: boolean;
  state: GameState;
  log: LogEntry[];
  canUndo: boolean;
  /** Apply an action and write a line in the log. `facts` let the line carry numbers for the summary. */
  dispatch: (action: GameAction, kind: LogKind, text: string, facts?: LogFacts) => void;
  /** Apply several actions as one undo step. */
  batch: (actions: GameAction[], kind: LogKind, text: string, facts?: LogFacts) => void;
  undo: () => void;
  rename: (name: string) => void;
  /** Replace the whole record (starting a game, loading another one). */
  open: (game: GameRecord) => void;
}

export function newGameRecord(over: Partial<GameRecord> = {}): GameRecord {
  const now = nowIso();
  return { id: newId("game"), ownerId: "local", createdAt: now, updatedAt: now, revision: 0, name: "", state: newGameState(), log: [], ...over };
}

/**
 * The game on the table: read once from the database, kept in React state, written back on a short
 * debounce. Undo is a bounded stack of previous states rather than an inverse for every action,
 * which is the same shape the terrain editor uses and is simpler to keep correct.
 *
 * `id` undefined means no game is open.
 */
export function useGame(id: string | undefined): GameHandle {
  const [game, setGame] = useState<GameRecord | undefined>(undefined);
  const [loaded, setLoaded] = useState(false);
  // The stack lives in a ref because it is pushed from inside a state updater, which React may run
  // twice; its depth is mirrored into state so the Undo control enables and disables with it.
  const past = useRef<GameState[]>([]);
  const [depth, setDepth] = useState(0);
  const timer = useRef<number | undefined>(undefined);
  const pending = useRef<GameRecord | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    past.current = [];
    setDepth(0);
    if (!id) {
      setGame(undefined);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    void db.games
      .get(id)
      .then((rec) => {
        if (!alive) return;
        setGame(rec);
        setLoaded(true);
      })
      .catch(() => {
        if (alive) setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  const flush = useCallback(() => {
    const rec = pending.current;
    pending.current = undefined;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = undefined;
    if (rec) void saveGame(rec);
  }, []);

  // A game is written a few times a minute at most, so a short debounce is enough; the flush on
  // unmount and on pagehide means closing the tab mid-turn never loses the last tap.
  const queue = useCallback(
    (rec: GameRecord) => {
      pending.current = rec;
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(flush, 400);
    },
    [flush],
  );

  useEffect(() => {
    const on = () => flush();
    window.addEventListener("pagehide", on);
    return () => {
      window.removeEventListener("pagehide", on);
      flush();
    };
  }, [flush]);

  /**
   * Writes work off the record in hand rather than a state updater, so the undo stack and its depth
   * move in the same tick as the record does. An updater runs later, which left the Undo control
   * disabled for one action.
   */
  const write = useCallback(
    (next: (rec: GameRecord) => GameRecord) => {
      if (!game) return;
      const out = { ...next(game), updatedAt: nowIso(), revision: game.revision + 1 };
      setGame(out);
      queue(out);
    },
    [game, queue],
  );

  const record = useCallback(
    (actions: GameAction[], kind: LogKind, text: string, facts?: LogFacts) => {
      if (!game) return;
      past.current = [...past.current, game.state].slice(-UNDO_CAP);
      setDepth(past.current.length);
      write((rec) => ({ ...rec, state: actions.reduce(applyAction, rec.state), log: [...rec.log, logEntry(rec.state, kind, text, facts)] }));
    },
    [game, write],
  );

  const dispatch = useCallback((action: GameAction, kind: LogKind, text: string, facts?: LogFacts) => record([action], kind, text, facts), [record]);
  const batch = useCallback((actions: GameAction[], kind: LogKind, text: string, facts?: LogFacts) => record(actions, kind, text, facts), [record]);

  const undo = useCallback(() => {
    const prev = past.current[past.current.length - 1];
    if (!prev) return;
    past.current = past.current.slice(0, -1);
    setDepth(past.current.length);
    write((rec) => ({ ...rec, state: prev, log: rec.log.slice(0, -1) }));
  }, [write]);

  const rename = useCallback((name: string) => write((rec) => ({ ...rec, name })), [write]);

  const open = useCallback(
    (next: GameRecord) => {
      past.current = [];
      setDepth(0);
      setGame(next);
      setLoaded(true);
      queue(next);
    },
    [queue],
  );

  return { game, loaded, state: game?.state ?? newGameState(), log: game?.log ?? [], canUndo: depth > 0, dispatch, batch, undo, rename, open };
}

/**
 * Keep the screen on while a game is open. Phones dim in the middle of a turn otherwise, and the
 * lock is dropped by the browser whenever the tab is hidden, so it is re-taken on return.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;
    let released = false;
    let lock: { release(): Promise<void> } | undefined;
    const request = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock: { request(kind: "screen"): Promise<{ release(): Promise<void> }> } }).wakeLock;
        lock = await wl.request("screen");
      } catch {
        // Refused (low battery, no permission). The tracker works the same, the screen just sleeps.
      }
    };
    const onVisible = () => {
      if (!released && document.visibilityState === "visible") void request();
    };
    void request();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      released = true;
      document.removeEventListener("visibilitychange", onVisible);
      void lock?.release().catch(() => undefined);
    };
  }, [active]);
}
