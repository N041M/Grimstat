export interface HBarRow {
  key: string;
  label: string;
  value: number | undefined;
  /** Formatted value shown at the end of the bar. */
  display: string;
  /** Tooltip / accessible description. */
  title?: string;
  /** Bar colour token (defaults to the chart bar colour). */
  tone?: "bar" | "brass" | "ok" | "info" | "danger";
  /** With `onSelect`: the row's toggle state (rendered as aria-pressed). */
  pressed?: boolean;
  /** With `onSelect`: accessible name of the row button (defaults to the label). */
  actionLabel?: string;
}

const TONES: Record<NonNullable<HBarRow["tone"]>, string> = { bar: "var(--ink)", brass: "var(--mid)", ok: "var(--good)", info: "var(--ink-2)", danger: "var(--accent)" };

/**
 * Horizontal bar chart in plain CSS (grid + proportional widths). Rows are a list so screen readers
 * get label + value pairs; the bar itself is decorative. `signed` draws bars from a centre line
 * (negative values to the left); `onSelect` turns every row label into a toggle button.
 */
export function HBarChart({ rows, max, ariaLabel, emptyLabel, signed, onSelect }: { rows: HBarRow[]; max?: number; ariaLabel: string; emptyLabel?: string; signed?: boolean; onSelect?: (key: string) => void }) {
  const top = max ?? rows.reduce((m, r) => Math.max(m, Math.abs(r.value ?? 0)), 0);
  if (!rows.length) return <div className="empty">{emptyLabel ?? ""}</div>;
  return (
    <div className="hbar" role="list" aria-label={ariaLabel}>
      {rows.map((r) => {
        const v = r.value ?? 0;
        const frac = top > 0 ? Math.max(0, Math.min(1, Math.abs(v) / top)) : 0;
        const width = signed ? frac * 50 : frac * 100;
        const style = signed ? (v < 0 ? { width: `${width}%`, right: "50%" } : { width: `${width}%`, left: "50%" }) : { width: `${width}%` };
        return (
          <div key={r.key} className="hbar-row" role="listitem" title={r.title ?? `${r.label}: ${r.display}`}>
            {onSelect ? (
              <button type="button" className="hbar-label hbar-btn" aria-pressed={r.pressed ?? false} aria-label={r.actionLabel ?? r.label} onClick={() => onSelect(r.key)}>
                {r.label}
              </button>
            ) : (
              <span className="hbar-label">{r.label}</span>
            )}
            <span className={`hbar-track${signed ? " signed" : ""}`} aria-hidden="true">
              <span className="hbar-fill" style={{ ...style, background: TONES[r.tone ?? "bar"] }} />
            </span>
            <span className="hbar-value">{r.display}</span>
          </div>
        );
      })}
    </div>
  );
}
