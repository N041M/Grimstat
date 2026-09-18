import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles.css";
import { pluginsReady } from "./plugin";
import { AppProvider } from "./state/AppContext";
import { App } from "./App";
import { ErrorBoundary, StartupError } from "./components/ErrorBoundary";
import { swStore } from "./lib/sw";
import { account } from "./lib/accountBoot";

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
/**
 * How often a tab that is being looked at asks whether there is a newer build.
 *
 * The browser asks on its own when a page is navigated to, and not while a tab simply sits there, so
 * a tab left open all day stays on the build it started with. Asking costs one revalidation of the
 * worker script, which is a couple of hundred bytes.
 */
const UPDATE_EVERY_MS = 60 * 60 * 1000;

/**
 * The phone app is its own copy of the build and updates through the store, so it has no service
 * worker (the build leaves it out; see `vite.config.ts`). It listens for the site's addresses the
 * phone hands it instead.
 */
const STORE_BUILD = Boolean(import.meta.env.VITE_STORE_BUILD);

if (STORE_BUILD) {
  void import("./lib/native").then((m) => m.installNativeLinks()).catch(() => undefined);
} else {
  registerSW({
    immediate: true,
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      const look = (): void => {
        if (!document.hidden) void registration.update();
      };
      // Coming back to the tab is the moment a stale build is about to be used again.
      document.addEventListener("visibilitychange", look);
      window.setInterval(look, UPDATE_EVERY_MS);
    },
    onOfflineReady: () => swStore.offlineReady(),
  });
}

const el = document.getElementById("root");
if (!el) throw new Error("#root not found");
const root = createRoot(el);

// A device that was signed in is signed in from the first screen, so the account is read before
// anything renders. A store that cannot be opened is reported by the app itself, not here.
Promise.all([pluginsReady, account.boot().catch(() => undefined)])
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
