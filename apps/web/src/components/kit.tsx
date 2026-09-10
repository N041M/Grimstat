import type { CSSProperties, ReactNode } from "react";

/**
 * Shared redesign primitives: the control dock, its select boxes / pill chips / switches, the
 * grid-based data table and the small proportional bar. Extracted here (rather than living in a
 * screen) because Armies, Analyses and Data need the same parts — a dock, a sticky table and the
 * chip/switch pair — and they must stay pixel-identical across screens.
 *
 * Styling lives in styles.css under "Kit"; nothing here carries inline colour.
 */

// ---------- dock ----------

/** The right-hand control dock: `--rail` background, left border, its own scroll. */
export function Dock({ label, meta, children }: { label: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <aside className="dock" aria-label={label}>
      <div className="dock-head">
        <span className="dock-head-title">{label}</span>
        {meta ? <span className="dock-head-meta">{meta}</span> : null}
      </div>
      {children}
    </aside>
  );
}

/** One bordered block inside a dock. `count` is the live "how many are on" figure, drawn in the accent. */
export function DockSection({ title, count, children, className }: { title?: string; count?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`dock-section ${className ?? ""}`.trim()}>
      {title ? (
        <div className="dock-section-head">
          <span className="dock-section-title">{title}</span>
          {count === undefined ? null : <span className="dock-section-count">{count}</span>}
        </div>
      ) : null}
      {children}
    </section>
  );
}

// ---------- controls ----------

export interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * The dock's select control: a `78px | 1fr` label/box pair. A real `<select>` keeps the native
 * menu, keyboard handling and label association; only the chrome is restyled.
 */
export function SelectBox<T extends string>({ label, value, options, onChange, title }: { label: string; value: T; options: Array<Option<T>>; onChange: (v: T) => void; title?: string }) {
  return (
    <label className="dock-field" title={title}>
      <span className="dock-field-label">{label}</span>
      <span className="selectbox">
        <select value={value} onChange={(e) => onChange(e.target.value as T)}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="selectbox-chev" aria-hidden="true">
          ⌄
        </span>
      </span>
    </label>
  );
}

/** Same box as `SelectBox`, holding a number instead of a menu (MC iterations). */
export function NumberBox({ label, value, min, step, onChange, title }: { label: string; value: number; min?: number; step?: number; onChange: (v: number) => void; title?: string }) {
  return (
    <label className="dock-field" title={title}>
      <span className="dock-field-label">{label}</span>
      <span className="selectbox">
        <input
          type="number"
          value={value}
          min={min}
          step={step}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      </span>
    </label>
  );
}

/** Boolean pill chip: off is a `--panel` outline, on is an `--ink` fill with inverse text. */
export function PillChip({ label, on, onChange, title }: { label: string; on: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button type="button" className={`pill-chip ${on ? "on" : ""}`.trim()} aria-pressed={on} title={title} onClick={() => onChange(!on)}>
      {label}
    </button>
  );
}

/** A 26×15 switch beside a 12px name and a 10px mono provenance line. */
export function SwitchRow({ name, meta, checked, onChange, title }: { name: string; meta?: string; checked: boolean; onChange: (v: boolean) => void; title?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className="switch-row" title={title} onClick={() => onChange(!checked)}>
      <span className="switch-track" aria-hidden="true">
        <span className="switch-knob" />
      </span>
      <span className="switch-text">
        <span className="switch-name">{name}</span>
        {meta ? <span className="switch-meta">{meta}</span> : null}
      </span>
    </button>
  );
}

// ---------- panels ----------

/** Section title (13px semibold) with optional right-hand aside — a legend, a count, a control. */
export function PanelHead({ title, aside, id }: { title: ReactNode; aside?: ReactNode; id?: string }) {
  return (
    <div className="panel-head-row">
      <h2 className="panel-title" id={id}>
        {title}
      </h2>
      {aside ? <div className="panel-aside">{aside}</div> : null}
    </div>
  );
}

/** Proportional bar in a `--fill` trough. `tone` picks the ink / dim fill. */
export function ProportionBar({ value, tone = "ink", height = 11, title }: { value: number; tone?: "ink" | "dim"; height?: number; title?: string }) {
  const w = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <span className={`pbar tone-${tone}`} style={{ "--h": `${height}px` } as CSSProperties} title={title} aria-hidden="true">
      <span style={{ width: `${w * 100}%` }} />
    </span>
  );
}

// ---------- grid table ----------

export type Align = "start" | "end";

/** Grid-based table: one CSS `grid-template-columns` string drives the header and every row. */
export function GridTable({ columns, label, children, className }: { columns: string; label: string; children: ReactNode; className?: string }) {
  return (
    <div role="table" aria-label={label} className={`gtable ${className ?? ""}`.trim()} style={{ "--gtable-cols": columns } as CSSProperties}>
      {children}
    </div>
  );
}

/** Sticky header row on `--rail`, 10px mono uppercase. */
export function GridHead({ children }: { children: ReactNode }) {
  return (
    <div role="row" className="gtable-head">
      {children}
    </div>
  );
}

export function GridHeadCell({ children, align = "start", sort, onSort }: { children: ReactNode; align?: Align; sort?: "ascending" | "descending" | "none"; onSort?: () => void }) {
  const cls = `gtable-hc align-${align}`;
  if (!onSort)
    return (
      <span role="columnheader" className={cls}>
        {children}
      </span>
    );
  return (
    <span role="columnheader" aria-sort={sort ?? "none"} className={cls}>
      <button type="button" className="gtable-sort" onClick={onSort}>
        {children}
        <span className="gtable-sort-mark" aria-hidden="true">
          {sort === "ascending" ? "↑" : sort === "descending" ? "↓" : ""}
        </span>
      </button>
    </span>
  );
}

export function GridRow({ children, className, onClick, title }: { children: ReactNode; className?: string; onClick?: () => void; title?: string }) {
  return (
    <div role="row" className={`gtable-row ${className ?? ""}`.trim()} title={title} onClick={onClick}>
      {children}
    </div>
  );
}

export function GridCell({ children, align = "start", mono, tone, className }: { children: ReactNode; align?: Align; mono?: boolean; tone?: "ink" | "muted" | "faint" | "accent"; className?: string }) {
  return (
    <span role="cell" className={`gtable-cell align-${align} ${mono ? "mono" : ""} ${tone ? `tone-${tone}` : ""} ${className ?? ""}`.trim()}>
      {children}
    </span>
  );
}
