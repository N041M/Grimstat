import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { getSetting, setSetting } from "../db";

const WRITE_DEBOUNCE_MS = 250;

/** A write that is waiting for the typing to stop. */
export interface PendingWrite<T> {
  /** Start the wait again with this value, replacing whatever was waiting. */
  schedule(key: string, value: T): void;
  /** Write what is waiting now. Does nothing when nothing is waiting. */
  flush(): Promise<void>;
  /** Forget what is waiting without writing it. */
  cancel(): void;
}

/**
 * A debounced write that can be finished early.
 *
 * The value waits `delay` milliseconds so a run of keystrokes costs one write, and the wait can be
 * cut short by `flush`, which is what a component does on its way out. A write that fails is
 * dropped, because there is nothing a settings write can usefully report to the person typing.
 */
export function pendingWrite<T>(write: (key: string, value: T) => Promise<void>, delay = WRITE_DEBOUNCE_MS): PendingWrite<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let due: { key: string; value: T } | undefined;
  const flush = async (): Promise<void> => {
    clearTimeout(timer);
    const now = due;
    due = undefined;
    if (now) await write(now.key, now.value).catch(() => undefined);
  };
  return {
    schedule(key, value) {
      clearTimeout(timer);
      due = { key, value };
      timer = setTimeout(() => void flush(), delay);
    },
    flush,
    cancel() {
      clearTimeout(timer);
      due = undefined;
    },
  };
}

/**
 * React state mirrored into the Dexie `settings` store under `key`. The stored value is read once on
 * mount (validated by `parse`, which returns undefined to reject it); later changes are written back,
 * debounced. `loaded` is false until the first read has completed.
 */
export function usePersistedSetting<T>(key: string, initial: T, parse: (raw: unknown) => T | undefined): [T, (next: SetStateAction<T>) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const initialRef = useRef(initial);
  const writer = useMemo(() => pendingWrite<T>((k, v) => setSetting(k, v)), []);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    // Back to the default while the new key is read. Leaving the old key's value in place meant a
    // key with nothing stored kept it, and the write below then saved it under the new key.
    setValue(initialRef.current);
    getSetting<unknown>(key)
      .then((raw) => {
        if (!alive) return;
        const parsed = raw === undefined ? undefined : parseRef.current(raw);
        if (parsed !== undefined) setValue(parsed);
      })
      .catch(() => undefined)
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [key]);

  // No cleanup here: the next change restarts the wait by itself, and a value still waiting has to
  // survive an unmount for the effect below to write it.
  useEffect(() => {
    if (!loaded) {
      writer.cancel();
      return;
    }
    writer.schedule(key, value);
  }, [key, value, loaded, writer]);

  // Save on unmount / page hide so a quick navigation never loses the last edit.
  useEffect(() => {
    const onHide = () => void writer.flush();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      void writer.flush();
    };
  }, [writer]);

  const set = useCallback((next: SetStateAction<T>) => setValue(next), []);
  return [value, set, loaded];
}
