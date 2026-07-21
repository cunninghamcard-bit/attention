import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Tests live centralized under tests/{web,desktop}/** (mirror paths) and
// reach their subjects through these aliases into the workspace lanes.
// (@app/shared rides here for the tests lane only — app lanes resolve it
// via the package mechanism; see the root tsconfig note.)
const alias = {
  "@web": resolve(__dirname, "apps/web"),
  "@desktop": resolve(__dirname, "apps/desktop/main"),
  "@preload": resolve(__dirname, "apps/desktop/preload"),
  "@app/shared": resolve(__dirname, "packages/shared"),
};

export default defineConfig({
  test: {
    coverage: {
      reporter: ["text", "html"],
      reportsDirectory: "reports/coverage",
    },
    // Two projects, two honest environments: the renderer suite runs under
    // jsdom with the web setup; the shell suite (main-process subjects) runs
    // under node without it. The root architecture alarms ride with web.
    projects: [
      {
        resolve: { alias },
        test: {
          name: "web",
          environment: "jsdom",
          include: ["tests/web/**/*.test.{ts,tsx}", "tests/*.test.{ts,tsx}"],
          setupFiles: ["./tests/web/setup.ts"],
        },
      },
      {
        resolve: { alias },
        test: {
          name: "desktop",
          environment: "node",
          include: ["tests/desktop/**/*.test.{ts,tsx}"],
        },
      },
    ],
  },
});
