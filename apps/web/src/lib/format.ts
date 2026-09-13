import { t } from "../i18n";

/** Number formatting helpers used by widgets and tables. */
export function fmt(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "–";
  return n.toFixed(digits);
}

/**
 * A sampled figure, printed only to the place its interval can actually tell apart.
 *
 * `ciHalfWidth` is the 95% half-width on `value`. Two decimals on a figure whose interval is ±0.05
 * print digits the run cannot support, so the number of decimals is read off the interval instead:
 * floor(-log10(halfWidth)), held between 0 and `maxDigits`. A half-width of 0.5 gets no decimals,
 * 0.07 and 0.05 get one, 0.005 gets two.
 *
 * An exact result has no half-width and prints at `maxDigits`, which is what `fmt` does. A
 * half-width that is not a positive finite number says nothing about how precise the figure is, so
 * zero, a negative number and a non-finite one are all read as no interval and print at `maxDigits`
 * too. `value` itself goes through `fmt`, so an absent or non-finite one still prints an en dash.
 */
export function fmtSampled(value: number | undefined | null, ciHalfWidth?: number, maxDigits = 2): string {
  if (ciHalfWidth === undefined || !Number.isFinite(ciHalfWidth) || ciHalfWidth <= 0) return fmt(value, maxDigits);
  return fmt(value, Math.min(maxDigits, Math.max(0, Math.floor(-Math.log10(ciHalfWidth)))));
}

/** A half-width only counts when it is a positive finite number. Anything else means no interval. */
const width = (h: number | undefined): number => (h !== undefined && Number.isFinite(h) && h > 0 ? h : 0);

/**
 * Whether two figures are close enough that their intervals touch, which is where a ranking has no
 * grounds to put one of them above the other.
 *
 * A figure with no half-width was worked out exactly and stands at a point, so two exact figures
 * touch only when they are the same number. Two figures that are exactly equal count as tied for
 * that reason, whether they were sampled or not.
 */
export function overlaps(aValue: number, aHalf: number | undefined, bValue: number, bHalf: number | undefined): boolean {
  if (aValue === bValue) return true;
  if (!Number.isFinite(aValue) || !Number.isFinite(bValue)) return false;
  return Math.abs(aValue - bValue) <= width(aHalf) + width(bHalf);
}

export function pct(p: number | undefined | null, digits = 1): string {
  if (p === undefined || p === null || !Number.isFinite(p)) return "–";
  return `${(p * 100).toFixed(digits)}%`;
}

export function fmtInt(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "–";
  return Math.round(n).toLocaleString();
}

export function fmtDate(iso: string | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

/** Date only, ISO-ordered ("2026-08-14"): the stamp used in dense table columns. */
export function fmtDay(iso: string | undefined): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 10);
}

/** Compact "just now / 4m / 3h / 6d / 2026-08-14" stamp for dense list rows. */
export function fmtRelative(iso: string | undefined, now = Date.now()): string {
  if (!iso) return "–";
  const d = new Date(iso);
  const ms = d.getTime();
  if (Number.isNaN(ms)) return iso;
  const secs = Math.max(0, Math.round((now - ms) / 1000));
  if (secs < 45) return t("time.justNow");
  const mins = Math.round(secs / 60);
  if (mins < 60) return t("time.minutesAgo", { n: mins });
  const hours = Math.round(mins / 60);
  if (hours < 24) return t("time.hoursAgo", { n: hours });
  const days = Math.round(hours / 24);
  if (days < 14) return t("time.daysAgo", { n: days });
  return d.toISOString().slice(0, 10);
}

const ORDINALS = typeof Intl !== "undefined" && "PluralRules" in Intl ? new Intl.PluralRules("en", { type: "ordinal" }) : undefined;

/** "1st", "2nd", "3rd", "11th": placings in the published-list tables. */
export function ordinal(n: number): string {
  const cat = ORDINALS?.select(n) ?? "other";
  return t(cat === "one" ? "ordinal.one" : cat === "two" ? "ordinal.two" : cat === "few" ? "ordinal.few" : "ordinal.other", { n });
}

/** "3+", or the en dash every table uses for a missing value (Torrent weapons have no skill). */
export function skill(n: number | null | undefined): string {
  return n === null || n === undefined ? "–" : `${n}+`;
}

export function ap(n: number): string {
  return n === 0 ? "0" : `-${n}`;
}

export function dice(v: string | number): string {
  return String(v).toUpperCase().replace(/\s+/g, "");
}

/**
 * Shorten a source reference for display. Git object ids are shown at the usual eight characters;
 * anything else (a version tag, a timestamp) is already readable and is left alone.
 */
export function shortRef(ref: string | undefined): string | undefined {
  if (!ref) return undefined;
  return /^[0-9a-f]{12,}$/i.test(ref) ? ref.slice(0, 8) : ref;
}
