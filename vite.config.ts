import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
    ...(process.env.ANALYZE ? [visualizer({ filename: "dist/stats.html", gzipSize: true, brotliSize: true })] : []),
  ],
  server: {
    port: 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
    // Keep previous hashed chunks: a running app:// instance lazy-loads its
    // chunks (e.g. the terminal's ghostty-web split) on first use — if a
    // rebuild wiped them, opening a terminal in the old window dies with
    // "Failed to fetch dynamically imported module".
    // ponytail: dist accumulates old hashes on dev machines; a packaging
    // pipeline should clean once with `vite build --emptyOutDir`.
    emptyOutDir: false,
  },
});
