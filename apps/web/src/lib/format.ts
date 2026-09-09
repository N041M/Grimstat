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

export function skill(n: number | null | undefined): string {
  return n === null || n === undefined ? "N/A" : `${n}+`;
}

export function ap(n: number): string {
  return n === 0 ? "0" : `-${n}`;
}

export function dice(v: string | number): string {
  return String(v).toUpperCase().replace(/\s+/g, "");
}
