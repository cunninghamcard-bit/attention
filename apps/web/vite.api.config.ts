/**
 * Input: node:path, vite, vite-plugin-dts
 * Output: default
 * Pos: Public API bundle and declaration build configuration
 *
 * 🔄 Self-reference: When this file changes, update this header
 */

import { resolve } from "node:path";
import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

// Public API library build. The entry is the renderer's index.ts (this dir is
// the vite/source root); artifacts land in this package's out/api (JS bundle
// plus the bundled declarations the package exports point at).
export default defineConfig({
  plugins: [
    dts({
      entryRoot: resolve(import.meta.dirname, "../.."),
      outDirs: resolve(import.meta.dirname, "out/api"),
      bundleTypes: false,
      tsconfigPath: resolve(import.meta.dirname, "tsconfig.api.json"),
    }),
  ],
  build: {
    target: "es2022",
    outDir: resolve(import.meta.dirname, "out/api"),
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, "index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
  },
});
