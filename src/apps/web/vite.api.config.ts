import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Public API library build. Runs from repo root but the entry lives in this
// package (src/apps/web); artifacts still land in repo-root dist/ so the root
// package.json exports keep pointing at them.
export default defineConfig({
  plugins: [
    dts({
      entryRoot: resolve(__dirname, "src"),
      outDirs: resolve(__dirname, "../../../out/types"),
      bundleTypes: true,
      tsconfigPath: resolve(__dirname, "tsconfig.json"),
    }),
  ],
  build: {
    target: "es2022",
    outDir: resolve(__dirname, "../../../out/api"),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
    },
  },
});
