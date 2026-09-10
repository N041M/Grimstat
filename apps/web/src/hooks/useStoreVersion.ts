import { useEffect, useState } from "react";
import { STORE_CHANGED, type StoreName } from "../db";

/**
 * A counter that increases whenever `store` is written. Put it in an effect's dependencies to
 * re-read a list that another screen can change (the army list in the context column, say, which
 * the roster editor keeps saving to).
 */
export function useStoreVersion(store: StoreName): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const onChange = (e: Event) => {
      if ((e as CustomEvent<StoreName>).detail === store) setVersion((v) => v + 1);
    };
    window.addEventListener(STORE_CHANGED, onChange);
    return () => window.removeEventListener(STORE_CHANGED, onChange);
  }, [store]);
  return version;
}
