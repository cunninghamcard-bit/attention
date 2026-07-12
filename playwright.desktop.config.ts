import { defineConfig } from "@playwright/test";

// Desktop (Electron) e2e — DeepChat-style: serial, generous timeouts, and
// failure artifacts retained. Run `pnpm run build && pnpm run build:electron`
// first; then `pnpm run e2e:desktop`.
export default defineConfig({
  testDir: "./tests/e2e/desktop/specs",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  outputDir: "./test-results/desktop",
  use: {
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "retain-on-failure",
  },
});
