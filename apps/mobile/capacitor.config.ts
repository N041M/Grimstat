import type { CapacitorConfig } from "@capacitor/cli";

/**
 * The phone app: the web app's store build, wrapped. `webDir` is the web app's build output, made
 * with the store build settings (see the `build:web` script). The WebView serves it from
 * https://localhost, which is the origin the API and the site's files answer for.
 */
const config: CapacitorConfig = {
  appId: "com.grimstat.app",
  appName: "Grimstat",
  webDir: "../web/dist",
  server: {
    androidScheme: "https",
  },
  android: {
    allowMixedContent: false,
  },
};

export default config;
