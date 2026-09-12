import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { getSetting, setSetting } from "../db";

const WRITE_DEBOUNCE_MS = 250;

/**
 * React state mirrored into the Dexie `settings` store under `key`. The stored value is read once on
 * mount (validated by `parse`, which returns undefined to reject it); later changes are written back,
 * debounced. `loaded` is false until the first read has completed.
 */
export function usePersistedSetting<T>(key: string, initial: T, parse: (raw: unknown) => T | undefined): [T, (next: SetStateAction<T>) => void, boolean] {
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const initialRef = useRef(initial);

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

  useEffect(() => {
    if (!loaded) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void setSetting(key, value).catch(() => undefined), WRITE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer.current);
  }, [key, value, loaded]);

  const set = useCallback((next: SetStateAction<T>) => setValue(next), []);
  return [value, set, loaded];
}
