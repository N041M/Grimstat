import { useEffect, useMemo, useState } from "react";

export type Route = "calculator" | "scenarios" | "armies" | "analyses" | "battle" | "data" | "about";
export const ROUTES: Route[] = ["calculator", "scenarios", "armies", "analyses", "battle", "data", "about"];

/** Parsed hash: `#/armies/<param>?a=b` → route "armies", param "<param>", query {a: "b"}. */
export interface RouteInfo {
  route: Route;
  param: string | undefined;
  query: URLSearchParams;
}

export function parseRouteInfo(hash: string): RouteInfo {
  const h = hash.startsWith("#") ? hash.slice(1) : hash;
  const m = /^\/?([a-z]+)(?:\/([^?]*))?(?:\?(.*))?$/.exec(h);
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
  return hash;
}

export function useRoute(): Route {
  return parseRoute(useHash());
}

export function useRouteInfo(): RouteInfo {
  const hash = useHash();
  return useMemo(() => parseRouteInfo(hash), [hash]);
}
