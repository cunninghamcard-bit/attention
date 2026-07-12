import { _electron as electron, expect, test as base, type ElectronApplication, type Page } from "@playwright/test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Window-level desktop e2e fixture, after DeepChat's test/e2e architecture:
// - `_electron.launch` drives the REAL built app (dist-electron/main.cjs)
// - a throwaway vault + userData + CLI socket per test file (our existing
//   E2E_* hermetic seams — the same pattern as DEEPCHAT_E2E_USER_DATA_DIR)
// - `app` auto-launches/closes; `launchApp` is the factory that makes
//   RESTART tests possible (close + relaunch inside one test)
// - renderer console + pageerror output is captured and attached to every
//   test, so a failure ships with its full context

const FIXTURE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(FIXTURE_DIR, "..", "..", "..", "..");
const MAIN_CJS = join(REPO_ROOT, "dist-electron", "main.cjs");

// A valid 1x1 red PNG — enough for a real decode (naturalWidth === 1).
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

export interface DesktopAppInstance {
  electronApp: ElectronApplication;
  page: Page;
  close: () => Promise<void>;
}

interface DesktopFixtures {
  vaultPath: string;
  app: DesktopAppInstance;
  launchApp: () => Promise<DesktopAppInstance>;
}

function seedVault(vault: string): void {
  mkdirSync(join(vault, "Pics"), { recursive: true });
  writeFileSync(join(vault, "Pics", "pic.png"), TINY_PNG);
  writeFileSync(join(vault, "Note.md"), "# Demo\n\nEmbedded image:\n\n![[pic.png]]\n\nSee [[Doc]].\n");
  writeFileSync(join(vault, "Doc.md"), "# A\n## B\nbody text\n");
}

export const test = base.extend<DesktopFixtures>({
  // Owns the throwaway workspace: tests that read/write vault files depend on
  // this for the real on-disk path; launchApp builds its env from it.
  vaultPath: async ({}, use) => {
    const base = mkdtempSync(join(tmpdir(), "workbench-desktop-e2e-"));
    const vault = join(base, "vault");
    seedVault(vault);
    try {
      await use(vault);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  },

  launchApp: async ({ vaultPath }, use, testInfo) => {
    if (!existsSync(MAIN_CJS)) {
      throw new Error("dist-electron/main.cjs missing — run: pnpm run build && pnpm run build:electron");
    }

    const base = dirname(vaultPath);
    const env = {
      ...process.env,
      E2E_VAULT_PATH: vaultPath,
      E2E_USER_DATA: join(base, "userData"),
      E2E_CLI_SOCKET: join(base, "cli.sock"),
    };

    const consoleLogs: string[] = [];
    const pageErrors: string[] = [];
    const launched = new Set<DesktopAppInstance>();
    let launchCount = 0;

    const launchApp = async (): Promise<DesktopAppInstance> => {
      launchCount += 1;
      const label = `launch-${launchCount}`;
      const electronApp = await electron.launch({ args: [MAIN_CJS], cwd: REPO_ROOT, env, timeout: 60_000 });

      const instance: DesktopAppInstance = {
        electronApp,
        page: undefined as unknown as Page,
        close: async () => {
          launched.delete(instance);
          await electronApp.close().catch(() => undefined);
        },
      };
      launched.add(instance);

      const page = await electronApp.firstWindow();
      page.on("console", (message) => consoleLogs.push(`[${label}][${message.type()}] ${message.text()}`));
      page.on("pageerror", (error) => pageErrors.push(`[${label}] ${error.message}`));
      await page.waitForLoadState("domcontentloaded");
      // App-ready contract: the workspace shell and the file tree are up.
      await expect(page.locator(".workspace")).toBeVisible({ timeout: 30_000 });
      await expect(page.locator(".nav-files-container").first()).toBeVisible({ timeout: 30_000 });
      instance.page = page;
      return instance;
    };

    try {
      await use(launchApp);
    } finally {
      for (const instance of [...launched].reverse()) await instance.close();
      await testInfo.attach("renderer-console.log", {
        body: Buffer.from(consoleLogs.join("\n") || "No renderer console output"),
        contentType: "text/plain",
      });
      await testInfo.attach("renderer-errors.log", {
        body: Buffer.from(pageErrors.join("\n") || "No renderer page errors"),
        contentType: "text/plain",
      });
      // An uncaught renderer exception fails the test even when every UI
      // assertion passed — desktop usability means a clean renderer.
      expect.soft(pageErrors, "renderer page errors").toEqual([]);
    }
  },

  app: async ({ launchApp }, use) => {
    const app = await launchApp();
    try {
      await use(app);
    } finally {
      await app.close();
    }
  },
});

export { expect } from "@playwright/test";
