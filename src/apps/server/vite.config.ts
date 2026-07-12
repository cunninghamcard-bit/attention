import { resolve } from "node:path";
import { builtinModules } from "node:module";
import { defineConfig } from "vite";

/**
 * Build target for the agent server (@app/server). The chat-bridge is the roof
 * that pulls in every engine; @earendil-works/pi-coding-agent and all Node
 * builtins stay external (provided by the Node runtime, not bundled).
 */
const nodeBuiltins = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => `node:${name}`),
]);

export default defineConfig({
  build: {
    outDir: resolve(__dirname, "../../../dist-server"),
    emptyOutDir: true,
    target: "node20",
    minify: false,
    sourcemap: true,
    lib: {
      entry: resolve(__dirname, "chat-bridge.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    rollupOptions: {
      external: (source) =>
        source.startsWith("@earendil-works/") || nodeBuiltins.has(source),
    },
  },
});
