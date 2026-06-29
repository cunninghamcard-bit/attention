import { defineConfig } from "vite";
import dts from "vite-plugin-dts";

export default defineConfig({
  plugins: [
    dts({
      entryRoot: "src",
      outDir: "dist/types",
      rollupTypes: true,
      tsconfigPath: "tsconfig.json",
    }),
  ],
  build: {
    target: "es2022",
    outDir: "dist/api",
    emptyOutDir: false,
    lib: {
      entry: "src/index.ts",
      formats: ["es", "cjs"],
      fileName: (format) => format === "es" ? "index.js" : "index.cjs",
    },
  },
});
