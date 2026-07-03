import { defineConfig } from "vite";
import { builtinModules } from "node:module";

/**
 * Build target for the Electron main process + preload.
 *
 * Emits CommonJS `dist-electron/main.cjs` and `dist-electron/preload.cjs`
 * (launched via `electron dist-electron/main.cjs`). Electron, @electron/remote
 * and all Node builtins stay external — they are provided by the Electron
 * runtime, not bundled. This target is completely separate from the renderer
 * (`vite.config.ts`) and the library (`vite.api.config.ts`).
 */
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export default defineConfig({
  build: {
    outDir: "dist-electron",
    emptyOutDir: true,
    target: "node20",
    minify: false,
    sourcemap: true,
    lib: {
      entry: {
        main: "electron/main.ts",
        preload: "electron/preload.ts",
      },
      formats: ["cjs"],
      fileName: (_format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: (source) =>
        source === "electron" ||
        source.startsWith("@electron/remote") ||
        nodeBuiltins.has(source),
    },
  },
});
