/** Number formatting helpers used by widgets and tables. */
export function fmt(n: number | undefined | null, digits = 2): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "–";
  return n.toFixed(digits);
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
  if (secs < 45) return "just now";
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return d.toISOString().slice(0, 10);
}

export function skill(n: number | null | undefined): string {
  return n === null || n === undefined ? "N/A" : `${n}+`;
}

export function ap(n: number): string {
  return n === 0 ? "0" : `-${n}`;
}

export function dice(v: string | number): string {
  return String(v).toUpperCase().replace(/\s+/g, "");
}
