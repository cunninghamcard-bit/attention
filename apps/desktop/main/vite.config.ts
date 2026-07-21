import { resolve } from "node:path";
import { cpSync, realpathSync } from "node:fs";
import { defineConfig } from "vite";
import { builtinModules } from "node:module";

/**
 * Build target for the Electron main process + preload.
 *
 * Emits CommonJS `out/desktop/main.cjs` and `out/desktop/preload.cjs`
 * (launched via `electron out/desktop/main.cjs`). Electron, node-pty and all
 * Node builtins stay external — Electron provides the former, the latter is a
 * native module. @electron/remote is an ordinary npm package that gets bundled.
 * This target is completely separate from the renderer (`../../web/vite.config.ts`)
 * and the library (`../../web/vite.api.config.ts`).
 */
const nodeBuiltins = new Set([...builtinModules, ...builtinModules.map((name) => `node:${name}`)]);
const desktopOut = resolve(__dirname, "../../../out/desktop");

export default defineConfig({
  plugins: [
    {
      name: "copy-node-pty-runtime",
      closeBundle() {
        cpSync(
          realpathSync(resolve(__dirname, "../node_modules/node-pty")),
          resolve(desktopOut, "node_modules/node-pty"),
          { recursive: true },
        );
      },
    },
  ],
  build: {
    // Emit into the single out/ roof (electron out/desktop/main.cjs); the web
    // bundle sits at the sibling out/web so main resolves it relatively.
    outDir: desktopOut,
    emptyOutDir: true,
    target: "node20",
    minify: false,
    sourcemap: true,
    lib: {
      entry: {
        main: resolve(__dirname, "main.ts"),
        preload: resolve(__dirname, "../preload/preload.ts"),
      },
      formats: ["cjs"],
      fileName: (_format, entryName) => `${entryName}.cjs`,
    },
    rollupOptions: {
      external: (source) =>
        source === "electron" || source === "node-pty" || nodeBuiltins.has(source),
    },
  },
});
