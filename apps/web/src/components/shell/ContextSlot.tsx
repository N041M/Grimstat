import { useCallback, useEffect, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Lets a route own the body of the shell's context column without prop-drilling through App.
 *
 *   function CalculatorPage() {
 *     return <ContextSlot><MyScenarioCards /></ContextSlot>;
 *   }
 *
 * The shell renders the target node (`registerContextHost`) and asks `useContextSlotFilled()`
 * whether a page has taken it over; when nothing has, it renders its own default body.
 * The registry is module state rather than React state so a page filling the slot never
 * re-renders the whole shell.
 */

const store: { host: HTMLElement | null; fills: number } = { host: null, fills: 0 };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Called by the shell with the element the slot should portal into (or null on unmount). */
export function registerContextHost(el: HTMLElement | null): void {
  if (store.host === el) return;
  store.host = el;
  emit();
}

const getHost = () => store.host;
const getFills = () => store.fills > 0;
const serverFalse = () => false;
const serverNull = () => null;

/** True while some page has mounted a `<ContextSlot>`; the shell hides its default body then. */
export function useContextSlotFilled(): boolean {
  return useSyncExternalStore(subscribe, getFills, serverFalse);
}

/** Renders `children` into the shell's context column. Renders nothing when the shell is not mounted. */
export function ContextSlot({ children }: { children: ReactNode }) {
  const host = useSyncExternalStore(subscribe, getHost, serverNull);
  useEffect(() => {
    store.fills += 1;
    emit();
    return () => {
      store.fills -= 1;
      emit();
    };
  }, []);
  return host ? createPortal(children, host) : null;
}

/** Test/StrictMode escape hatch: forget the registered host. */
export function resetContextSlot(): void {
  store.host = null;
  store.fills = 0;
  emit();
}

/** Ref callback for the shell's slot element. */
export function useContextHostRef(): (el: HTMLElement | null) => void {
  return useCallback((el: HTMLElement | null) => registerContextHost(el), []);
}
