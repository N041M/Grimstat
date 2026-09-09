import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import { pluginsReady } from "./plugin";
import { AppProvider } from "./state/AppContext";
import { App } from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";

registerSW({ immediate: true });

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");
const root = createRoot(el);

pluginsReady
  .then(() => {
    root.render(
      <StrictMode>
        <ErrorBoundary>
          <AppProvider>
            <App />
          </AppProvider>
        </ErrorBoundary>
      </StrictMode>,
    );
  })
  .catch((e: unknown) => {
    root.render(
      <div className="error-box" role="alert" style={{ margin: "2rem" }}>
        <strong>Grimstat could not start.</strong>
        <pre>{e instanceof Error ? (e.stack ?? e.message) : String(e)}</pre>
      </div>,
    );
  });
