/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

/** Build-time facts shown on the About screen (see `define` in vite.config.ts). */
declare const __GS_TESTS__: number;
declare const __GS_PACKAGES__: number;
/** The built bundle's size, or the placeholder token while running the dev server. */
declare const __GS_BUNDLE__: string;
/** The commit this build came from, or "dev" for a build made outside the repository. */
declare const __GS_BUILD__: string;

/** Set on a build made for an address the app has left; see `lib/moved.ts`. */
interface ImportMetaEnv {
  readonly VITE_MOVED_TO?: string;
  readonly VITE_CLOSES_ON?: string;
}
