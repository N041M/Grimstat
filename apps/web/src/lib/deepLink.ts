/**
 * What the phone app does with a web address it was opened with.
 *
 * Android hands the app every address on the site it is registered for: a short link, a public
 * page, and the site's root, which is where sign-in emails and long share links point. The app
 * routes by hash, so each becomes a hash for the router. A short link has to be asked about first,
 * because where it goes is only known to the server.
 */
export type AppLink = { kind: "hash"; hash: string } | { kind: "short"; id: string };

const SHORT = /^\/l\/([^/]+)\/?$/;
const PAGE = /^\/u\/([^/]+)\/?$/;

/** The link an address stands for, or nothing when it is not one of the site's. */
export function appLinkFor(url: string, site: string): AppLink | undefined {
  let target: URL;
  let home: URL;
  try {
    target = new URL(url);
    home = new URL(site);
  } catch {
    return undefined;
  }
  if (target.origin !== home.origin) return undefined;
  const short = SHORT.exec(target.pathname);
  if (short) return { kind: "short", id: short[1]! };
  const page = PAGE.exec(target.pathname);
  if (page) return { kind: "hash", hash: `#/u/${page[1]!.toLowerCase()}` };
  if (target.pathname === "/" && target.hash.length > 1) return { kind: "hash", hash: target.hash };
  return undefined;
}
