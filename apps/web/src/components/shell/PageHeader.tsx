import type { ReactNode } from "react";

/**
 * The main region's page header: 20px title + 11px mono subtitle on the left, actions on the
 * right, `18px 22px 14px`, bottom border. Sticks to the top of the scrolling main region.
 *
 * Every action is `white-space:nowrap; flex:none` and the title block `min-width:0` (see
 * `.page-header` in styles.css) so nothing wraps at the 1040px minimum width.
 */
export function PageHeader({ title, subtitle, actions, className, children }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string; children?: ReactNode }) {
  return (
    <header className={`page-header ${className ?? ""}`.trim()}>
      <div className="page-header-row">
        <div className="page-header-title">
          {typeof title === "string" ? <h1>{title}</h1> : title}
          {subtitle ? <div className="page-header-sub">{subtitle}</div> : null}
        </div>
        {actions ? <div className="page-header-actions">{actions}</div> : null}
      </div>
      {/* Anything a screen hangs under the title row: the Analyses tabs, the Armies points bar. */}
      {children}
    </header>
  );
}
