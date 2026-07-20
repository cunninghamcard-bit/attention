import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Public API library build. The entry is the renderer's index.ts (this dir is
// the vite/source root); artifacts land in this package's out/api (JS bundle
// plus the bundled declarations the package exports point at).
export default defineConfig({
  resolve: {
    alias: {
      "@app/shared": resolve(__dirname, "../../packages/shared"),
    },
  },
  plugins: [
    dts({
      entryRoot: resolve(__dirname, "."),
      outDirs: resolve(__dirname, "out/api"),
      bundleTypes: true,
      tsconfigPath: resolve(__dirname, "tsconfig.json"),
    }),
  ],
  build: {
    target: "es2022",
    outDir: resolve(__dirname, "out/api"),
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "index.ts"),
      formats: ["es", "cjs"],
      fileName: (format) => (format === "es" ? "index.js" : "index.cjs"),
    },
  },
});
