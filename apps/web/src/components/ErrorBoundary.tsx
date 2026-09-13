import { Component, useState, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

interface Props {
  children: ReactNode;
  /** Compact rendering for widgets. */
  compact?: boolean;
  resetKey?: unknown;
  /**
   * Run just before the boundary clears the failure and shows its children again.
   *
   * A screen that loads part of itself on demand needs this. React keeps a rejected `lazy` payload
   * and throws the same failure for every later render of it, so the screen has to put a fresh
   * payload in place here. Without that, Try again renders straight back into the same error.
   */
  onRetry?: () => void;
}
interface State {
  error: Error | undefined;
}

/**
 * Whether a failure is a part of the app that did not load, rather than something the render did.
 *
 * The browser throws this when the file behind a screen loaded on demand never arrives. A dropped
 * connection does it, and so does a deploy that replaced the file this page was told to ask for.
 * Every engine words the failure differently, so all three wordings are matched.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "ChunkLoadError") return true;
  const m = error.message.toLowerCase();
  return m.includes("dynamically imported module") || m.includes("module script failed");
}

/** Everything known about a failure as one block of text, for a bug report. */
function errorText(error: unknown): string {
  if (error instanceof Error) return [`${error.name}: ${error.message}`, error.stack ?? ""].join("\n").trim();
  return String(error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}

/** Copy button with its own result line, because a clipboard write can be refused without throwing anything visible. */
function CopyDetails({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      setState("failed");
    }
  };
  return (
    <>
      <button type="button" onClick={() => void copy()}>
        {label}
      </button>
      {state === "idle" ? null : (
        <span className="small muted" role="status">
          {state === "copied" ? t("error.copied") : t("error.copyFailed")}
        </span>
      )}
    </>
  );
}

/** The stack, folded away. Opening it is a deliberate act, so the failure itself stays readable. */
function ErrorDetails({ stack }: { stack: string }) {
  return (
    <details className="error-details">
      <summary>{t("error.details")}</summary>
      <pre>{stack}</pre>
    </details>
  );
}

/**
 * The screen for a failure that stopped the app before the shell existed. `main.tsx` renders it in
 * place of the app; there is nothing to retry, so it offers the message and the details to copy.
 */
export function StartupError({ error }: { error: unknown }) {
  const stack = errorStack(error);
  return (
    <div className="error-box startup-error" role="alert">
      <strong>{t("startup.failed")}</strong>
      <p className="small">{errorMessage(error)}</p>
      <div className="error-actions">
        <CopyDetails text={errorText(error)} label={t("startup.copy")} />
      </div>
      {stack ? <ErrorDetails stack={stack} /> : null}
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: undefined };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Kept deliberately quiet in production; surfaced in the UI instead of the console.
    void error;
    void info;
  }

  override componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: undefined });
  }

  private retry = (): void => {
    this.props.onRetry?.();
    this.setState({ error: undefined });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A part of the app that did not load is asked for again on the next full page load, so that is
    // offered beside Try again.
    const chunk = isChunkLoadError(error);
    return (
      <div className="error-box" role="alert">
        <strong>{chunk ? t("error.chunkTitle") : t("error.title")}</strong>
        {/* A chunk that did not arrive reports itself as a module URL, which means nothing to a player. */}
        {chunk ? null : <p className="small">{error.message}</p>}
        <div className="error-actions">
          <button type="button" onClick={this.retry}>
            {t("error.retry")}
          </button>
          {chunk ? (
            <button type="button" className="primary" onClick={() => location.reload()}>
              {t("error.reload")}
            </button>
          ) : null}
          <CopyDetails text={errorText(error)} label={t("error.copy")} />
        </div>
        {!this.props.compact && error.stack ? <ErrorDetails stack={error.stack} /> : null}
      </div>
    );
  }
}
