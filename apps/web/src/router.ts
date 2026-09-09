import { useEffect, useState } from "react";

export type Route = "calculator" | "scenarios" | "data" | "about";
export const ROUTES: Route[] = ["calculator", "scenarios", "data", "about"];

export function parseRoute(hash: string): Route {
  const m = /^#\/?([a-z]+)/.exec(hash);
  const r = m?.[1];
  return (ROUTES as string[]).includes(r ?? "") ? (r as Route) : "calculator";
}

export function navigate(route: Route, replace = false): void {
  const target = `#/${route}`;
  if (replace) history.replaceState(null, "", target);
  else location.hash = target;
  // replaceState does not fire hashchange; notify listeners manually.
  window.dispatchEvent(new HashChangeEvent("hashchange"));
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}
