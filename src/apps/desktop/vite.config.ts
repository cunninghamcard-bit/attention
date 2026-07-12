import { resolve } from "node:path";
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
  // The desktop main imports its two shared items (SystemMenuItem, URL_SCHEME)
  // from the web package as `@app/web/*`; alias it to the web source so the
  // electron bundle resolves the .ts directly (web exports "./*": "./src/*").
  resolve: {
    alias: {
      "@app/web": resolve(__dirname, "../web/src"),
    },
  },
  build: {
    // Emit to repo-root dist-electron/ (electron dist-electron/main.cjs).
    outDir: resolve(__dirname, "../../../dist-electron"),
    emptyOutDir: true,
    target: "node20",
    minify: false,
    sourcemap: true,
    lib: {
      entry: {
        main: resolve(__dirname, "main.ts"),
        preload: resolve(__dirname, "preload.ts"),
      },
      formats: ["cjs"],
      fileName: (_format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: (source) =>
        source === "electron" ||
        source === "node-pty" ||
        source.startsWith("@electron/remote") ||
        nodeBuiltins.has(source),
    },
  },
});
