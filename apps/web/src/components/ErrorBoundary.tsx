import { Component, type ErrorInfo, type ReactNode } from "react";
import { t } from "../i18n";

interface Props {
  children: ReactNode;
  /** Compact rendering for widgets. */
  compact?: boolean;
  resetKey?: unknown;
}
interface State {
  error: Error | undefined;
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

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-box" role="alert">
        <strong>{t("error.title")}</strong>
        <p className="small">{error.message}</p>
        {!this.props.compact && error.stack ? <pre>{error.stack}</pre> : null}
        <button type="button" onClick={() => this.setState({ error: undefined })}>
          {t("error.retry")}
        </button>
      </div>
    );
  }
}
