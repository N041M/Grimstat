/**
 * The notice a build carries when the app has moved to another address.
 *
 * A build made for the old address is given the new one at build time, and shows one line saying
 * so on every screen until the old address closes. It exists because stored data belongs to the
 * address it was stored under: lists kept at the old address cannot be read at the new one, so a
 * reader has to carry them across with a backup, and has to be told while the old address still
 * answers.
 *
 * The closing date is optional. Without one the line says only that the app has moved.
 */
export interface MovedNotice {
  /** The new address, as a link. */
  url: string;
  /** The new address as a person would say it: the host, without the scheme or a trailing slash. */
  host: string;
  /** The closing date of the old address, as a calendar date, when one was given. */
  closesOn?: Date;
}

/** Reads the notice out of the build's settings, or nothing when this build has not moved. */
export function movedNotice(env: { VITE_MOVED_TO?: string; VITE_CLOSES_ON?: string }): MovedNotice | undefined {
  const raw = env.VITE_MOVED_TO?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  const notice: MovedNotice = { url: url.href, host: url.host };
  const date = env.VITE_CLOSES_ON?.trim();
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const parsed = new Date(`${date}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) notice.closesOn = parsed;
  }
  return notice;
}

/** The closing date as a reader would write it, in their own language and calendar. */
export function formatClosesOn(date: Date, locale?: string): string {
  return date.toLocaleDateString(locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}
