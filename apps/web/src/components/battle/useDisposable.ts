import { useEffect, useMemo } from "react";

/**
 * A three.js object built from React state, disposed when it is replaced or unmounted.
 *
 * R3F frees what it created from JSX, but a geometry handed to it through a prop is the caller's to
 * free — and a geometry rebuilt on every frame of a drag that nobody frees is a GPU leak with a very
 * short fuse. Disposing one that is still drawn is safe: the renderer re-uploads it on the next frame,
 * which is what makes this survive StrictMode's double effects.
 */
export function useDisposable<T extends { dispose(): void }>(make: () => T, deps: readonly unknown[]): T {
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the caller's list is the dependency list
  const object = useMemo(make, deps);
  useEffect(() => () => object.dispose(), [object]);
  return object;
}
