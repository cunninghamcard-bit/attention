import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Desktop tests import their two shared items from the web package.
    alias: {
      "@app/web": resolve(__dirname, "src/apps/web/src"),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "src/apps/web/src/**/*.test.{ts,tsx}",
      "src/apps/desktop/**/*.test.ts",
      "src/apps/server/**/*.test.ts",
    ],
    setupFiles: ["./src/apps/web/src/test-setup.ts"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
