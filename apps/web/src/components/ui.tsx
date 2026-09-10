import { useEffect, useId, useRef, type CSSProperties, type ReactNode, type RefObject } from "react";
import { t } from "../i18n";

/** Labelled form field; the label wraps the control so it is always associated. */
export function Field({ label, children, hint, className }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`field ${className ?? ""}`.trim()}>
      <span>{label}</span>
      {children}
      {hint ? <span className="small muted">{hint}</span> : null}
    </label>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: string; disabled?: boolean }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" aria-checked={checked} checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="track" aria-hidden="true" />
      <span className="label">
        <span>{label}</span>
        {description ? <span className="desc">{description}</span> : null}
      </span>
    </label>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  const id = useId();
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}`} aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}>
          {tab.label}
        </button>
      ))}
    </div>
  );
}

export function Badge({ children, tone }: { children: ReactNode; tone?: "ok" | "warn" | "danger" | "accent" | "brass" }) {
  return <span className={`badge ${tone ?? ""}`.trim()}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="row" role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="small">{label}</span>
    </span>
  );
}

/** Parse a number input; returns fallback for empty/invalid input. */
export function num(v: string, fallback: number): number {
  const n = Number(v);
  return v.trim() === "" || !Number.isFinite(n) ? fallback : n;
}

/** Nullable number input: empty string -> null. */
export function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// ---------- icons (16px line icons, currentColor) ----------

export type IconName = "export" | "history" | "more" | "copy" | "trash" | "calc" | "plus" | "close" | "chevron" | "check" | "search" | "back" | "file" | "warn";

const PATHS: Record<IconName, ReactNode> = {
  export: (
    <>
      <path d="M8 10V2" />
      <path d="M4.5 5.5 8 2l3.5 3.5" />
      <path d="M2.5 9.5v3a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1v-3" />
    </>
  ),
  history: (
    <>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9" />
      <path d="M2.5 2.5v3h3" />
      <path d="M8 5v3.2l2.2 1.3" />
    </>
  ),
  more: (
    <>
      <circle cx="3.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
    </>
  ),
  trash: (
    <>
      <path d="M3 4.5h10" />
      <path d="M6.5 4.5v-2h3v2" />
      <path d="M4.5 4.5l.6 8.5a1 1 0 0 0 1 .9h3.8a1 1 0 0 0 1-.9l.6-8.5" />
    </>
  ),
  calc: (
    <>
      <circle cx="8" cy="8" r="5" />
      <circle cx="8" cy="8" r="1.6" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  chevron: <path d="M4 6l4 4 4-4" />,
  check: <path d="M3 8.5l3 3 7-7" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.5" />
      <path d="M10.5 10.5 14 14" />
    </>
  ),
  back: <path d="M10 3 5 8l5 5" />,
  file: (
    <>
      <path d="M4 1.5h5.5L13 5v8.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-11a1 1 0 0 1 1-1z" />
      <path d="M9.5 1.5V5H13" />
    </>
  ),
  warn: (
    <>
      <path d="M8 2.5 14 13H2z" />
      <path d="M8 6.5v3M8 11.2v.3" />
    </>
  ),
};

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={`icon ${className ?? ""}`.trim()} viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      {PATHS[name]}
    </svg>
  );
}

// ---------- dismissable layers ----------

/** Calls `onDismiss` on Escape or on a pointer-down outside `ref` while `active`. */
export function useDismiss(ref: RefObject<HTMLElement>, active: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onDismiss();
      }
    };
    const onDown = (e: PointerEvent) => {
      const el = ref.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) onDismiss();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("pointerdown", onDown, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("pointerdown", onDown, true);
    };
  }, [ref, active, onDismiss]);
}

/**
 * Small anchored layer under its trigger. Render the trigger as `trigger`; `children` appear while `open`.
 * Escape and outside clicks call `onClose`; focus moves into the layer when it opens.
 */
export function Popover({ open, onClose, trigger, children, label, align = "start", className }: { open: boolean; onClose: () => void; trigger: ReactNode; children: ReactNode; label: string; align?: "start" | "end"; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, onClose);
  useEffect(() => {
    if (!open) return;
    const el = layer.current;
    if (!el) return;
    const first = el.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]:not([tabindex='-1'])");
    (first ?? el).focus({ preventScroll: true });
  }, [open]);
  return (
    <div className={`pop-wrap ${className ?? ""}`.trim()} ref={ref}>
      {trigger}
      {open ? (
        <div className={`popover align-${align}`} role="dialog" aria-label={label} ref={layer} tabIndex={-1}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** Modal dialog on the native `<dialog>` element (Escape and backdrop click close it). */
export function Dialog({ open, onClose, title, children, className, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; className?: string; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? "wide" : ""} ${className ?? ""}`.trim()}
      aria-labelledby={`${id}-t`}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="dialog-inner">
        <div className="dialog-head">
          <h2 id={`${id}-t`}>{title}</h2>
          <button type="button" className="ghost sm icon-btn" onClick={onClose} aria-label={t("common.close")}>
            <Icon name="close" />
          </button>
        </div>
        {open ? children : null}
      </div>
    </dialog>
  );
}

/**
 * Bottom sheet for narrow viewports: fixed, 70vh, backdrop, drag handle (drag down or tap to close),
 * Escape closes. Locks page scrolling while open.
 */
export function Sheet({ open, onClose, label, children, className }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number } | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("sheet-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("sheet-open");
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className={`sheet ${className ?? ""}`.trim()} role="dialog" aria-modal="true" aria-label={label} ref={ref}>
        <button
          type="button"
          className="sheet-handle"
          aria-label={t("common.close")}
          onClick={onClose}
          onPointerDown={(e) => {
            drag.current = { y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            const start = drag.current;
            drag.current = undefined;
            if (start && e.clientY - start.y > 60) onClose();
          }}
        >
          <span aria-hidden="true" />
        </button>
        {children}
      </div>
    </>
  );
}

// ---------- meters ----------

/** Thin points progress bar with a `1,985 / 2,000` label; warn above 90 %, danger over the limit. */
export function PointsMeter({ points, limit, tone, label, compact }: { points: string; limit: string; tone: "ok" | "warn" | "danger"; label: string; compact?: boolean; }) {
  const raw = Number(points.replace(/[^\d.-]/g, ""));
  const lim = Number(limit.replace(/[^\d.-]/g, ""));
  const pct = lim > 0 ? Math.min(100, Math.max(0, (raw / lim) * 100)) : raw > 0 ? 100 : 0;
  return (
    <div className={`pts-meter tone-${tone} ${compact ? "compact" : ""}`.trim()} role="meter" aria-valuemin={0} aria-valuemax={lim} aria-valuenow={raw} aria-label={label}>
      <div className="pts-meter-label">
        <strong>{points}</strong>
        <span className="muted"> / {limit}</span>
      </div>
      <div className="pts-bar" aria-hidden="true">
        <span style={{ "--w": `${pct}%` } as CSSProperties} />
      </div>
    </div>
  );
}

/** Detachment points as pips: ● ● ○ plus a "2 / 3 DP" label. */
export function DpPips({ spent, limit, label }: { spent: number; limit: number; label: string }) {
  const total = Math.max(limit, spent);
  const pips = Array.from({ length: total }, (_, i) => i < spent);
  const over = spent > limit;
  return (
    <span className={`dp-pips ${over ? "over" : ""}`.trim()} role="img" aria-label={label}>
      <span className="pips" aria-hidden="true">
        {pips.map((on, i) => (
          <span key={i} className={`pip ${on ? "on" : ""} ${on && i >= limit ? "extra" : ""}`.trim()} />
        ))}
      </span>
      <span className="dp-label">{label}</span>
    </span>
  );
}
