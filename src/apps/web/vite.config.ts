import { resolve } from "node:path";
import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

// Config lives in the web app package (src/apps/web); the renderer bundle still
// emits to the repo-root `dist/` the Electron main serves from (join(here, "..",
// "dist") in src/apps/desktop/main.ts).
const rootDist = resolve(__dirname, "../../../dist");

export default defineConfig({
  root: __dirname,
  // Static assets (fonts, icons) live at the repo root, not under this package.
  publicDir: resolve(__dirname, "public"),
  plugins: [
    ...(process.env.ANALYZE ? [visualizer({ filename: resolve(rootDist, "stats.html"), gzipSize: true, brotliSize: true })] : []),
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
