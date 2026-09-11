import { readdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/** Deployed under a sub-path on GitHub Pages (e.g. "/Grimstat/"); "/" for local dev. */
const base = process.env.VITE_BASE ?? "/";

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

export default defineConfig({
  base,
  // pnpm gives each package its own node_modules, so @react-three/fiber can end up resolving a
  // second copy of React and its hooks then throw. One React for the whole app.
  resolve: { dedupe: ["react", "react-dom", "three"] },
  define: {
    __GS_TESTS__: JSON.stringify(countTests()),
    __GS_PACKAGES__: JSON.stringify(countPackages()),
    __GS_BUNDLE__: JSON.stringify(BUNDLE_TOKEN),
  },
  plugins: [
    bundleSizePlugin(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["favicon.svg", "icon-192.png", "icon-512.png"],
      manifest: {
        name: "Grimstat",
        short_name: "Grimstat",
        description: "Unofficial, local-first Warhammer 40,000 statistics dashboard. Ships no game data.",
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
        globPatterns: ["**/*.{js,css,html,svg,png,ico,webmanifest}"],
        navigateFallback: "index.html",
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  worker: { format: "es" },
  server: { port: 5173, strictPort: false },
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
