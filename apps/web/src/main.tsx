import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import { pluginsReady } from "./plugin";
import { AppProvider } from "./state/AppContext";
import { App } from "./App";
import { ErrorBoundary, StartupError } from "./components/ErrorBoundary";
import { swStore } from "./lib/sw";

/*
 * The build registers with `registerType: "autoUpdate"`. A new version takes over and the page
 * reloads onto it, so somebody who keeps the app open or comes back to a bookmark is on the current
 * build without having to be asked.
 *
 * The reload is what makes this safe rather than what makes it risky. The new worker claims the page
 * as soon as it activates, and a page left running on the old build would ask for chunks of it that
 * the new build does not have. Rosters, games and snapshots are written to the database as they
 * change, so a reload keeps them.
 */
registerSW({
  immediate: true,
  onOfflineReady: () => swStore.offlineReady(),
});

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
