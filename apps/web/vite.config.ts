import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/**
 * Which build this is, so the About page can say it and a reader can tell it apart from the one
 * their browser had before. The workflow runner has the commit in the environment; a local build
 * asks git for it and says "dev" when there is no repository to ask.
 */
function buildId(): string {
  const fromCi = process.env.GITHUB_SHA;
  if (fromCi) return fromCi.slice(0, 7);
  try {
    return execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

/** Deployed under a sub-path on GitHub Pages (e.g. "/Grimstat/"); "/" for local dev. */
const base = process.env.VITE_BASE ?? "/";

/**
 * Where the dev server answers for Wahapedia, and which of its exports each edition maps to.
 *
 * Node loads this config directly, so it cannot import the workspace's TypeScript. The path is
 * `WAHAPEDIA_DEV_PROXY` in `src/lib/importProgress.ts` and the upstream mapping is `wahapediaUrlFor`
 * in `packages/adapters/src/sources.ts`; the proxy test in `importProgress.test.ts` holds the two
 * copies together.
 */
const WAHAPEDIA_DEV_PROXY = "/wahapedia/";
const WAHAPEDIA_DEV_PATHS: Record<string, string> = { "wh40k-11e": "/wh40k11ed", "wh40k-10e": "/wh40k10ed" };

/* ---- About-screen facts, measured at build time rather than typed by hand ---- */

const repoRoot = resolve(fileURLToPath(new URL(".", import.meta.url)), "../..");

function walk(dir: string, onFile: (path: string) => void): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, onFile);
    else onFile(p);
  }
}

/** Test cases in the workspace: `it(` / `test(` at the start of a line in any *.test.ts. */
function countTests(): number {
  let n = 0;
  for (const root of ["packages", "apps"]) {
    walk(join(repoRoot, root), (p) => {
      if (!p.endsWith(".test.ts")) return;
      n += (readFileSync(p, "utf8").match(/^\s*(?:it|test)(?:\.\w+)?\(/gm) ?? []).length;
    });
  }
  return n;
}

/** Workspace packages: everything under packages/ and apps/ that has a package.json. */
function countPackages(): number {
  let n = 0;
  for (const root of ["packages", "apps"]) {
    let dirs: string[] = [];
    try {
      dirs = readdirSync(join(repoRoot, root));
    } catch {
      continue;
    }
    for (const d of dirs) {
      try {
        statSync(join(repoRoot, root, d, "package.json"));
        n++;
      } catch {
        /* not a package */
      }
    }
  }
  return n;
}

/**
 * The bundle cannot know its own size while it is being defined, so `__GS_BUNDLE__` is compiled to
 * this token and swapped for the real figure once every chunk exists. In dev the token survives and
 * the screen shows "dev build" instead. The figure is the gzipped JS + CSS — what a visitor
 * actually downloads — which is the only version of "bundle size" worth printing.
 *
 * Lazily loaded routes are excluded for exactly that reason. The battle table pulls in three.js,
 * which is bigger than the rest of the app put together, and nobody who never opens it downloads a
 * byte of it. Counting it would make the headline figure a number no visitor experiences.
 */
const BUNDLE_TOKEN = "__GS_BUNDLE_SIZE__";

function bundleSizePlugin(): Plugin {
  return {
    name: "grimstat-bundle-size",
    apply: "build",
    generateBundle(_options, bundle) {
      // What a visitor downloads is every chunk reachable from the entry by *static* imports. Walking
      // the graph rather than testing each chunk's own flag matters: a chunk shared by two lazy routes
      // is not itself a dynamic entry, and would otherwise be counted against everybody.
      const chunks = new Map<string, { code: string; imports: readonly string[]; isEntry: boolean }>();
      for (const file of Object.values(bundle)) if (file.type === "chunk") chunks.set(file.fileName, file);
      const loaded = new Set<string>();
      const queue = [...chunks].filter(([, c]) => c.isEntry).map(([name]) => name);
      while (queue.length) {
        const name = queue.pop()!;
        if (loaded.has(name)) continue;
        loaded.add(name);
        queue.push(...(chunks.get(name)?.imports ?? []));
      }
      let bytes = 0;
      for (const name of loaded) bytes += gzipSync(Buffer.from(chunks.get(name)!.code, "utf8")).byteLength;
      for (const file of Object.values(bundle)) {
        if (file.type === "asset" && file.fileName.endsWith(".css")) bytes += gzipSync(typeof file.source === "string" ? Buffer.from(file.source, "utf8") : Buffer.from(file.source)).byteLength;
      }
      const label = `${Math.round(bytes / 1024)} kB`;
      for (const file of Object.values(bundle)) {
        if (file.type === "chunk" && file.code.includes(BUNDLE_TOKEN)) file.code = file.code.replaceAll(BUNDLE_TOKEN, label);
      }
    },
  };
}

/* ---- the content policy the built page carries ---- */

/**
 * GitHub Pages serves files and sends no headers of its own, so the only place to state a policy is
 * a meta tag in the page itself. Without one, a link or a piece of markup that arrived with
 * imported data and got as far as the page would run with the same reach as the app, over every
 * army and collection stored on the machine.
 *
 * `{hashes}` is filled in with the hash of each inline script, so the theme script can keep running
 * before the first paint — which is the whole reason it is in the page rather than in the bundle —
 * without the policy having to allow inline script in general. The hashes are taken from the page
 * as it is actually built, so they cannot drift from what they cover.
 *
 * Styles are inline because React writes `style` attributes, and the reference-pack page carries
 * its own stylesheet. `connect-src` allows other sites because the addresses are the user's to
 * type: the corpus relay and the Wahapedia mirror are both fields on the Data page.
 *
 * `wasm-unsafe-eval` is there for the recogniser that reads an army list out of a picture: compiling
 * WebAssembly counts as generating script, and without it the browser refuses the module. It allows
 * WebAssembly and nothing else — `unsafe-eval`, which would also let the page run a string as code,
 * is not here. The policy is only added to the built page, so a picture read fine in development and
 * failed on the deployed site.
 *
 * `frame-ancestors` is left out because a meta tag cannot carry it.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' {hashes}",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

/** Every `<script>` in the page that has no `src`, which is what a hash has to cover. */
const INLINE_SCRIPT = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;

/**
 * Adds the policy to the built page. It is not added in dev, where the server injects inline
 * scripts of its own for hot reloading that no fixed set of hashes can cover.
 */
function cspPlugin(): Plugin {
  return {
    name: "grimstat-csp",
    apply: "build",
    transformIndexHtml: {
      order: "post",
      handler(html) {
        const hashes = [...html.matchAll(INLINE_SCRIPT)].map((m) => `'sha256-${createHash("sha256").update(m[1] ?? "", "utf8").digest("base64")}'`);
        const policy = CSP.replace("{hashes}", hashes.join(" ")).replace(/\s+/g, " ").trim();
        return html.replace(/<head>/i, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
      },
    },
  };
}

export default defineConfig({
  base,
  // pnpm gives each package its own node_modules, so @react-three/fiber can end up resolving a
  // second copy of React and its hooks then throw. One React for the whole app.
  resolve: { dedupe: ["react", "react-dom", "three"] },
  define: {
    __GS_TESTS__: JSON.stringify(countTests()),
    __GS_PACKAGES__: JSON.stringify(countPackages()),
    __GS_BUNDLE__: JSON.stringify(BUNDLE_TOKEN),
    __GS_BUILD__: JSON.stringify(buildId()),
  },
  plugins: [
    bundleSizePlugin(),
    cspPlugin(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "Grimstat",
        short_name: "Grimstat",
        description: "Unofficial, local-first Warhammer 40,000 statistics dashboard.",
        theme_color: "#15161a",
        background_color: "#15161a",
        display: "standalone",
        start_url: base,
        scope: base,
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
      workbox: {
        // Everything the app needs to start without a network, including the four typefaces. They
        // add about 69 KiB to the precache. Without them an offline visit falls back to system
        // fonts and every screen reflows. The pattern also picks up the icons and the manifest,
        // because public/ is copied into the build output this globs.
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest,woff2,json}"],
        /*
         * The recogniser's own files, which this pattern would otherwise sweep into the precache.
         * They are around 28 MB and only a reader who imports a picture ever needs them, so they are
         * fetched the first time one does and cached from then on. Precaching them would make every
         * first visit pay for a feature most visits never reach.
         */
        globIgnores: ["**/ocr/**"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: "es" },
  server: {
    port: 5173,
    strictPort: false,
    /**
     * Wahapedia sends no CORS headers, so the browser cannot read it. The dev server can, because it talks to
     * Wahapedia server to server and hands the result back from this origin. So a local run needs no
     * mirror at all. The Data page's default mirror URL in dev is this path, and the fetch button
     * gets the stratagems, enhancements and rules text straight away.
     *
     * A built site has no server of its own, so a deployment reads a published mirror instead. Both
     * paths end up at `<base>/<gameSystemId>/<Table>.csv`, which is the one shape the app fetches.
     */
    proxy: {
      // The sync API, when `pnpm --filter @grimstat/api dev` is running. Same paths as on the site.
      "/api": { target: "http://localhost:8787", changeOrigin: false },
      "/l/": { target: "http://localhost:8787", changeOrigin: false },
      ...Object.fromEntries(
        Object.entries(WAHAPEDIA_DEV_PATHS).map(([id, upstream]) => [
          `${WAHAPEDIA_DEV_PROXY}${id}`,
          { target: "https://wahapedia.ru", changeOrigin: true, rewrite: (path: string) => path.replace(`${WAHAPEDIA_DEV_PROXY}${id}`, upstream) },
        ]),
      ),
    },
  },
  build: {
    target: "es2022",
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom"],
          grid: ["react-grid-layout"],
          storage: ["dexie", "lz-string", "comlink"],
        },
      },
    },
  },
});
