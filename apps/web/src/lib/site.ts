/**
 * The website's address, for a build that does not run at it.
 *
 * The website reaches its API and its data files by relative paths, and this is empty there. The
 * phone app runs from an origin of its own, so its build names the site in `VITE_SITE_URL`, and
 * every path the app fetches from the site is joined to it here.
 */

/** The site's origin from the build setting, or an empty string when the build runs at the site. */
export function siteFrom(raw: string | undefined): string {
  const value = raw?.trim() ?? "";
  if (!value) return "";
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : "";
  } catch {
    return "";
  }
}

export const SITE_URL = siteFrom(import.meta.env.VITE_SITE_URL);

/** A path on the site, such as "/api/sync", as this build reaches it. Anything but a path starting with "/" comes back unchanged. */
export function onSite(path: string, site: string = SITE_URL): string {
  return site && path.startsWith("/") ? `${site}${path}` : path;
}
