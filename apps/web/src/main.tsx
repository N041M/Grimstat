import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import { pluginsReady } from "./plugin";
import { AppProvider } from "./state/AppContext";
import { App } from "./App";
import { ErrorBoundary, StartupError } from "./components/ErrorBoundary";
import { swStore } from "./lib/sw";

// The build registers with `registerType: "prompt"`: a new version waits until the user reloads
// from the banner, so a redeploy never swaps code under a live session.
const updateSW = registerSW({
  immediate: true,
  onNeedRefresh: () => swStore.needRefresh(),
  onOfflineReady: () => swStore.offlineReady(),
});
swStore.setUpdater(updateSW);

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
    root.render(<StartupError error={e} />);
  });
