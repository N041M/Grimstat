import { useEffect, useMemo, useState } from "react";

export type Route = "calculator" | "scenarios" | "armies" | "collection" | "codex" | "analyses" | "battle" | "play" | "data" | "profile" | "about" | "u";
export const ROUTES: Route[] = ["calculator", "scenarios", "armies", "collection", "codex", "analyses", "battle", "play", "data", "profile", "about", "u"];
/** Routes that are somebody's page rather than a screen of the app: reached by link, not from the rail or the tour. */
export const PUBLIC_ROUTES: Route[] = ["u"];

/** Parsed hash: `#/armies/<param>?a=b` → route "armies", param "<param>", query {a: "b"}. */
export interface RouteInfo {
  route: Route;
  param: string | undefined;
  query: URLSearchParams;
}

/** `/armies/<param>?a=b`, with the leading "#" already off. */
const HASH = /^\/?([a-z]+)(?:\/([^?]*))?(?:\?(.*))?$/;

export function parseRouteInfo(hash: string): RouteInfo {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const m = HASH.exec(h);
  const r = m?.[1];
  const route = (ROUTES as string[]).includes(r ?? "") ? (r as Route) : "calculator";
  let param: string | undefined;
  if (m?.[2]) {
    try {
      param = decodeURIComponent(m[2]);
    } catch {
      param = m[2];
    }
  }
  return { route, param: param || undefined, query: new URLSearchParams(m?.[3] ?? "") };
}

export function parseRoute(hash: string): Route {
  return parseRouteInfo(hash).route;
}

/**
 * Whether a hash names a screen the app does not have.
 *
 * Only a hash shaped like an address is judged. A permalink such as `#s=<token>` is not one, and
 * neither is an empty hash, so neither is mistaken for a wrong address and rewritten out of the bar
 * before the screen that reads it has had its turn.
 */
export function isUnknownRoute(hash: string): boolean {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const m = HASH.exec(h);
  return m !== null && !(ROUTES as string[]).includes(m[1] ?? "");
}

export function hrefFor(route: Route, param?: string): string {
  return `#/${route}${param ? `/${encodeURIComponent(param)}` : ""}`;
}

export function navigate(route: Route, replace = false, param?: string): void {
  const target = hrefFor(route, param);
  if (replace) history.replaceState(null, "", target);
  else location.hash = target;
  // replaceState does not fire hashchange; notify listeners manually.
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

function useHash(): string {
  const [hash, setHash] = useState<string>(() => location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  // An address the app cannot read lands on the Calculator, so the bar is put right to match.
  // Otherwise the address that showed nothing is the one that gets bookmarked and shared.
  useEffect(() => {
    if (isUnknownRoute(hash)) navigate("calculator", true);
  }, [hash]);
  return hash;
}

export function useRoute(): Route {
  return parseRoute(useHash());
}

export function useRouteInfo(): RouteInfo {
  const hash = useHash();
  return useMemo(() => parseRouteInfo(hash), [hash]);
}
