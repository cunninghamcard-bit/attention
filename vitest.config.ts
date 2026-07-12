import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests live centralized under tests/{web,desktop}/** (mirror paths)
    // and reach their subjects through these aliases.
    alias: {
      "@app/web": resolve(__dirname, "src/apps/web/src"),
      "@web": resolve(__dirname, "src/apps/web/src"),
      "@desktop": resolve(__dirname, "src/apps/desktop"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/web/setup.ts"],
    coverage: {
      reporter: ["text", "html"],
      reportsDirectory: "out/coverage",
    },
  },
});
