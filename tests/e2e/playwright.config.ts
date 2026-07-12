import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export default defineConfig({
  testDir: ".",
  // Desktop specs launch Electron and run under their own deliberate regime
  // (playwright.desktop.config.ts: workers 1, no webServer, 120s timeout) —
  // without this ignore, plain `pnpm run e2e` would re-run them here too.
  testIgnore: ["**/desktop/**"],
  timeout: 30_000,
  outputDir: "../../reports/test-results",
  fullyParallel: true,
  reporter: [["list"], ["html", { open: "never", outputFolder: "../../reports/playwright" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "pnpm run dev",
    cwd: REPO_ROOT,
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
});
