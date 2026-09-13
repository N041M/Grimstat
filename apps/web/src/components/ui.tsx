import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from "react";
import { t } from "../i18n";

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute("aria-hidden") && el.offsetParent !== null);
}

/** Keep Tab inside `root` (modal layers that are not a native `<dialog>`). Call from a keydown handler. */
export function trapTab(e: KeyboardEvent | ReactKeyboardEvent, root: HTMLElement): void {
  if (e.key !== "Tab") return;
  const items = focusable(root);
  if (items.length === 0) {
    e.preventDefault();
    root.focus({ preventScroll: true });
    return;
  }
  const first = items[0];
  const last = items[items.length - 1];
  const active = document.activeElement;
  if (!first || !last) return;
  if (e.shiftKey && (active === first || active === root || !root.contains(active))) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && (active === last || !root.contains(active))) {
    e.preventDefault();
    first.focus();
  }
}

/** Arrow keys walk the `role="menuitem*"` buttons inside `root`; Home and End jump. */
export function menuKeys(e: ReactKeyboardEvent, root: HTMLElement | null): void {
  if (!root) return;
  if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
  const items = [...root.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]')].filter((el) => !el.hasAttribute("disabled"));
  if (items.length === 0) return;
  e.preventDefault();
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1 : e.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
  items[next]?.focus();
}

/** Remember what had focus and give it back when a layer closes and left focus on the body. */
function restoreFocus(opener: HTMLElement | null): void {
  const active = document.activeElement;
  if (opener && opener.isConnected && (!active || active === document.body)) opener.focus({ preventScroll: true });
}

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

/**
 * Marks which ends of a sideways-scrolling strip have more content beyond them, as
 * `data-fade="start"`, `"end"` or `"both"`. The CSS fades the ends that are marked.
 *
 * The fade has to follow the scroll rather than be painted once. A strip that always faded its
 * right edge went on fading it after it had been scrolled to the end, where there is nothing more
 * to say, and never faded the left, where by then there was. Fading both ends unconditionally is
 * no better: it dims the first tab of a strip nobody has scrolled yet.
 *
 * `watch` re-runs the setup when the element itself is replaced — the phone bar's action strip is
 * only mounted at compact widths, so it comes and goes with them.
 */
export function useEdgeFade(ref: RefObject<HTMLElement | null>, watch?: unknown): void {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      /*
       * Where the first and last children sit, rather than `scrollLeft` against `scrollWidth`.
       * These strips carry side padding — the tab bar 16px, the battle toolbar 4 — and a strip
       * with padding rests at a `scrollLeft` of exactly that, never 0, so reading the number
       * directly reported content hidden off the left of a strip nobody had scrolled.
       */
      const first = el.firstElementChild;
      const last = el.lastElementChild;
      if (!first || !last) {
        el.removeAttribute("data-fade");
        return;
      }
      const box = el.getBoundingClientRect();
      const start = first.getBoundingClientRect().left < box.left - 1;
      const end = last.getBoundingClientRect().right > box.right + 1;
      const mark = start && end ? "both" : start ? "start" : end ? "end" : "";
      if (mark) el.setAttribute("data-fade", mark);
      else el.removeAttribute("data-fade");
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Its own width, and the width of what it holds: the actions change with the screen, and the
    // tabs change with the army.
    const resize = new ResizeObserver(update);
    resize.observe(el);
    const mutate = new MutationObserver(update);
    mutate.observe(el, { childList: true, subtree: true, characterData: true });
    return () => {
      el.removeEventListener("scroll", update);
      resize.disconnect();
      mutate.disconnect();
    };
  }, [ref, watch]);
}

/**
 * Keeps the selected tab in view in a tab bar too wide for the screen. Below 900px `.tabbar`
 * scrolls sideways, so a screen reopened on its last tab would otherwise start with that tab off
 * the edge. Give the bar a ref and pass whatever changes when the tab does.
 */
export function useTabInView(ref: RefObject<HTMLElement | null>, value: string): void {
  useEffect(() => {
    const bar = ref.current;
    if (!bar || bar.scrollWidth <= bar.clientWidth) return;
    const tab = bar.querySelector<HTMLElement>('[aria-selected="true"]');
    tab?.scrollIntoView({ inline: "nearest", block: "nearest" });
  }, [ref, value]);
}

/** Roving-tabindex tab strip: the selected tab is in the Tab order, the arrow keys move between tabs. */
export function Tabs<T extends string>({ tabs, value, onChange, label }: { tabs: Array<{ id: T; label: string }>; value: T; onChange: (v: T) => void; label: string }) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  useEdgeFade(list, value);
  const onKeyDown = (e: ReactKeyboardEvent) => {
    const i = tabs.findIndex((tb) => tb.id === value);
    let next: number | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (i + 1) % tabs.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    const target = next === undefined ? undefined : tabs[next];
    if (!target) return;
    e.preventDefault();
    onChange(target.id);
    list.current?.querySelector<HTMLElement>(`[data-tab="${CSS.escape(target.id)}"]`)?.focus();
  };
  return (
    <div className="tabs" role="tablist" aria-label={label} ref={list} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button key={tab.id} type="button" role="tab" id={`${id}-${tab.id}`} data-tab={tab.id} aria-selected={value === tab.id} tabIndex={value === tab.id ? 0 : -1} onClick={() => onChange(tab.id)}>
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

export type IconName = "export" | "history" | "more" | "copy" | "trash" | "calc" | "plus" | "close" | "chevron" | "check" | "search" | "back" | "file" | "warn" | "expand" | "collapse";

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
  /* Four corners opening outwards, and the same four closing inwards: what a video player and a
     map both use for full screen, so it needs no label to be understood. */
  expand: (
    <>
      <path d="M6 2H2v4" />
      <path d="M10 2h4v4" />
      <path d="M6 14H2v-4" />
      <path d="M10 14h4v-4" />
    </>
  ),
  collapse: (
    <>
      <path d="M2 6h4V2" />
      <path d="M14 6h-4V2" />
      <path d="M2 10h4v4" />
      <path d="M14 10h-4v4" />
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
 * Escape and outside clicks call `onClose`; focus moves into the layer when it opens and goes back
 * to the trigger when it closes. Arrow keys walk any `role="menuitem"` buttons inside.
 */
export function Popover({ open, onClose, trigger, children, label, align = "start", className }: { open: boolean; onClose: () => void; trigger: ReactNode; children: ReactNode; label: string; align?: "start" | "end"; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const layer = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, onClose);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const el = layer.current;
    if (el) {
      const first = el.querySelector<HTMLElement>("input, select, textarea, button, [tabindex]:not([tabindex='-1'])");
      (first ?? el).focus({ preventScroll: true });
    }
    return () => restoreFocus(opener);
  }, [open]);
  return (
    <div className={`pop-wrap ${className ?? ""}`.trim()} ref={ref}>
      {trigger}
      {open ? (
        <div className={`popover align-${align}`} role="dialog" aria-label={label} ref={layer} tabIndex={-1} onKeyDown={(e) => menuKeys(e, layer.current)}>
          {children}
        </div>
      ) : null}
    </div>
  );
}

// ---------- confirmation ----------

export interface ConfirmOptions {
  title: string;
  /** What will happen, in one or two sentences. */
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Paint the confirm button as destructive. */
  danger?: boolean;
}

function ConfirmDialog({ pending, onSettle }: { pending: ConfirmOptions | undefined; onSettle: (v: boolean) => void }) {
  return (
    <Dialog open={pending !== undefined} onClose={() => onSettle(false)} title={pending?.title ?? ""} className="confirm-dialog">
      {pending?.body ? <div className="confirm-body">{pending.body}</div> : null}
      <div className="dialog-actions">
        <button type="button" autoFocus onClick={() => onSettle(false)}>
          {pending?.cancelLabel ?? t("common.cancel")}
        </button>
        <button type="button" className={pending?.danger ? "danger" : "primary"} onClick={() => onSettle(true)}>
          {pending?.confirmLabel ?? t("common.confirm")}
        </button>
      </div>
    </Dialog>
  );
}

/**
 * In-app replacement for `window.confirm`: `const { confirm, dialog } = useConfirm()`, render
 * `{dialog}` once, then `if (await confirm({ title, body, danger: true })) …`.
 */
export function useConfirm(): { confirm: (opts: ConfirmOptions) => Promise<boolean>; dialog: ReactNode } {
  const [pending, setPending] = useState<{ opts: ConfirmOptions; resolve: (v: boolean) => void } | undefined>(undefined);
  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false);
          return { opts, resolve };
        });
      }),
    [],
  );
  const onSettle = useCallback((v: boolean) => {
    setPending((prev) => {
      prev?.resolve(v);
      return undefined;
    });
  }, []);
  const dialog = <ConfirmDialog pending={pending?.opts} onSettle={onSettle} />;
  return { confirm, dialog };
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
/**
 * A panel that covers part of the screen on a phone. It rises from the bottom by default; `side`
 * "left" slides it in from the edge instead, which is what navigation uses so the drawer lands where
 * the rail sits on a wider screen.
 */
export function Sheet({ open, onClose, label, children, className, side }: { open: boolean; onClose: () => void; label: string; children: ReactNode; className?: string; side?: "bottom" | "left" }) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | undefined>(undefined);
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = ref.current;
    root?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (root) trapTab(e, root);
    };
    document.addEventListener("keydown", onKey);
    document.body.classList.add("sheet-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("sheet-open");
      restoreFocus(opener);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div className={`sheet ${side === "left" ? "sheet-left" : ""} ${className ?? ""}`.trim()} role="dialog" aria-modal="true" aria-label={label} ref={ref} tabIndex={-1}>
        <button
          type="button"
          className="sheet-handle"
          aria-label={t("common.close")}
          onClick={onClose}
          onPointerDown={(e) => {
            drag.current = { x: e.clientX, y: e.clientY };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerUp={(e) => {
            const start = drag.current;
            drag.current = undefined;
            const travel = side === "left" ? start && start.x - e.clientX : start && e.clientY - start.y;
            if (travel && travel > 60) onClose();
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
