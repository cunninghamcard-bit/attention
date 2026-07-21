import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests live centralized under tests/{web,desktop}/** (mirror paths) and
    // reach their subjects through these aliases into the workspace lanes.
    alias: {
      "@web": resolve(__dirname, "apps/web"),
      "@desktop": resolve(__dirname, "apps/desktop/main"),
      "@preload": resolve(__dirname, "apps/desktop/preload"),
      "@app/shared": resolve(__dirname, "packages/shared"),
      "@shared": resolve(__dirname, "packages/shared"),
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
