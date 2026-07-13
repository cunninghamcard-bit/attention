import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Public API library build. The entry is the renderer's index.ts (this dir is
// the vite/source root); artifacts land in the single out/ roof (out/api,
// out/types) that the root package.json exports point at.
export default defineConfig({
  resolve: {
    alias: {
      "@shared": resolve(__dirname, "../shared"),
    },
  },
  plugins: [
    dts({
      entryRoot: resolve(__dirname, "."),
      outDirs: resolve(__dirname, "../../out/types"),
      bundleTypes: true,
      tsconfigPath: resolve(__dirname, "tsconfig.json"),
    }),
  ],
  build: {
    target: "es2022",
    outDir: resolve(__dirname, "../../out/api"),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "index.ts"),
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
    },
  },
});
