import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests live centralized under tests/{web,desktop}/** (mirror paths) and
    // reach their subjects through these aliases into the single-package src/.
    alias: {
      "@app/web": resolve(__dirname, "src/renderer"),
      "@web": resolve(__dirname, "src/renderer"),
      "@desktop": resolve(__dirname, "src/main"),
      "@preload": resolve(__dirname, "src/preload"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/web/setup.ts"],
    coverage: {
      reporter: ["text", "html"],
      reportsDirectory: "reports/coverage",
    },
  },
});
