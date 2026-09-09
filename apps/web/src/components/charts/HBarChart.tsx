export interface HBarRow {
  key: string;
  label: string;
  value: number | undefined;
  /** Formatted value shown at the end of the bar. */
  display: string;
  /** Tooltip / accessible description. */
  title?: string;
  /** Bar colour token (defaults to the chart bar colour). */
  tone?: "bar" | "brass" | "ok" | "info";
}

const TONES: Record<NonNullable<HBarRow["tone"]>, string> = { bar: "var(--chart-bar)", brass: "var(--brass)", ok: "var(--ok)", info: "var(--info)" };

/**
 * Horizontal bar chart in plain CSS (grid + proportional widths). Rows are a list so screen readers
 * get label + value pairs; the bar itself is decorative.
 */
export function HBarChart({ rows, max, ariaLabel, emptyLabel }: { rows: HBarRow[]; max?: number; ariaLabel: string; emptyLabel?: string }) {
  const top = max ?? rows.reduce((m, r) => Math.max(m, r.value ?? 0), 0);
  if (!rows.length) return <div className="empty">{emptyLabel ?? ""}</div>;
  return (
    <div className="hbar" role="list" aria-label={ariaLabel}>
      {rows.map((r) => {
        const v = r.value ?? 0;
        const width = top > 0 ? Math.max(0, Math.min(100, (v / top) * 100)) : 0;
        return (
          <div key={r.key} className="hbar-row" role="listitem" title={r.title ?? `${r.label}: ${r.display}`}>
            <span className="hbar-label">{r.label}</span>
            <span className="hbar-track" aria-hidden="true">
              <span className="hbar-fill" style={{ width: `${width}%`, background: TONES[r.tone ?? "bar"] }} />
            </span>
            <span className="hbar-value">{r.display}</span>
          </div>
        );
      })}
    </div>
  );
}
