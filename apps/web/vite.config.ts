import { resolve } from "node:path";
import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

// The renderer is its own vite root (src/renderer). Its bundle emits to the
// single out/ roof at out/web, which the Electron main serves via the app://
// protocol from the sibling out/desktop (join(here, "..", "web") in main.ts).
const rootDist = resolve(__dirname, "../../out/web");

export default defineConfig({
  root: __dirname,
  // Static assets (fonts, scripts like /lib/readability.js) served verbatim.
  publicDir: resolve(__dirname, "public"),
  // The native-seam port contracts live one level up in src/shared.
  resolve: {
    alias: {
      "@app/shared": resolve(__dirname, "../../packages/shared"),
    },
  },
  plugins: [
    ...(process.env.ANALYZE
      ? [
          visualizer({
            filename: resolve(rootDist, "stats.html"),
            gzipSize: true,
            brotliSize: true,
          }),
        ]
      : []),
  ],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
    outDir: rootDist,
    // Keep previous hashed chunks: a running app:// instance lazy-loads its
    // chunks (e.g. the terminal's ghostty-web split) on first use — if a
    // rebuild wiped them, opening a terminal in the old window dies with
    // "Failed to fetch dynamically imported module".
    // ponytail: dist accumulates old hashes on dev machines; a packaging
    // pipeline should clean once with `vite build --emptyOutDir`.
    emptyOutDir: false,
    rollupOptions: {
      input: {
        // Two pages, like the real app: the vault renderer (index.html) and
        // the starter/vault-chooser page (starter.html).
        index: resolve(__dirname, "index.html"),
        starter: resolve(__dirname, "starter.html"),
      },
    },
  },
});
