/**
 * The phone app's side of the links the site hands it.
 *
 * Only the store build loads this module. Android opens the app for the site's addresses it is
 * registered for, and Capacitor reports the address here: once at launch, and again each time the
 * app is already open. The address becomes a hash for the router, and the screens that read the
 * hash do the rest, the same as when the address is typed into a browser.
 */
import { App } from "@capacitor/app";
import { Capacitor } from "@capacitor/core";
import { appLinkFor } from "./deepLink";
import { onSite, SITE_URL } from "./site";

/** A launch address can be reported twice within a moment. A second tap on the same link later is not the same event. */
const SAME_LINK_MS = 2000;
let lastUrl: string | undefined;
let lastAt = 0;

async function open(url: string, now = Date.now()): Promise<void> {
  if (url === lastUrl && now - lastAt < SAME_LINK_MS) return;
  lastUrl = url;
  lastAt = now;
  let link = appLinkFor(url, SITE_URL);
  if (link?.kind === "short") {
    try {
      const res = await fetch(onSite(`/api/links/${encodeURIComponent(link.id)}`));
      if (!res.ok) throw new Error(`The server answered ${res.status}.`);
      const found = (await res.json()) as { url?: string };
      link = found.url ? appLinkFor(found.url, SITE_URL) : undefined;
    } catch (e) {
      console.warn("short link not opened:", e instanceof Error ? e.message : String(e));
      link = undefined;
    }
  }
  if (!link || link.kind !== "hash") return;
  if (location.hash === link.hash) window.dispatchEvent(new HashChangeEvent("hashchange"));
  else location.hash = link.hash;
}

/** Starts listening for addresses the app is opened with. Does nothing outside the phone app. */
export async function installNativeLinks(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  await App.addListener("appUrlOpen", (event) => void open(event.url));
  const launch = await App.getLaunchUrl();
  if (launch?.url) void open(launch.url);
}
