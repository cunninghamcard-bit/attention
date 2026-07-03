import { defineConfig } from "vite";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig({
  plugins: [
    ...(process.env.ANALYZE ? [visualizer({ filename: "dist/stats.html", gzipSize: true, brotliSize: true })] : []),
  ],
  server: {
    port: Number(process.env.PORT) || 5173,
    strictPort: false,
  },
  build: {
    target: "es2022",
  },
});
