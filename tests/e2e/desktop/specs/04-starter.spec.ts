import { _electron as electron, expect, test } from "@playwright/test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The starter (vault chooser) window — launched WITHOUT the E2E_VAULT_PATH
// seed so main's real `ke()` path runs: zero persisted-open vaults means the
// starter comes up instead of a vault window.

const SPEC_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SPEC_DIR, "..", "..", "..", "..");
const MAIN_CJS = join(REPO_ROOT, "out", "desktop", "main.cjs");

function starterEnv(base: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    E2E_USER_DATA: join(base, "userData"),
    E2E_CLI_SOCKET: join(base, "cli.sock"),
  };
  delete env.E2E_VAULT_PATH;
  delete env.ELECTRON_RENDERER_URL;
  return env;
}

test("a fresh profile boots into the starter with Quick start", async (_fixtures, testInfo) => {
  const base = mkdtempSync(join(tmpdir(), "workbench-starter-e2e-"));
  const app = await electron.launch({
    args: [MAIN_CJS],
    cwd: REPO_ROOT,
    env: starterEnv(base),
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    await expect(page.locator(".starter-screen")).toBeVisible();
    // Empty registry: no recent-vaults sidebar, Quick start front and center.
    await expect(page.locator(".recent-vaults")).toBeHidden();
    await expect(page.locator(".quick-start-container button")).toHaveText("Quick start");
    await expect(page.locator(".setting-item-name", { hasText: "Create new vault" })).toBeVisible();
    await expect(
      page.locator(".setting-item-name", { hasText: "Open folder as vault" }),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("starter-fresh.png") });
  } finally {
    await app.close();
    rmSync(base, { recursive: true, force: true });
  }
});

test("clicking a registered vault opens its window and the starter closes itself", async (_fixtures, testInfo) => {
  const base = mkdtempSync(join(tmpdir(), "workbench-starter-e2e-"));
  const vaultPath = join(base, "picked-vault");
  mkdirSync(vaultPath, { recursive: true });
  // Registered but NOT open — startup still lands on the starter, with the
  // vault waiting in the recent list.
  mkdirSync(join(base, "userData"), { recursive: true });
  writeFileSync(
    join(base, "userData", "obsidian.json"),
    JSON.stringify({ vaults: { e2evault0000: { path: vaultPath, ts: 1 } } }),
  );
  const app = await electron.launch({
    args: [MAIN_CJS],
    cwd: REPO_ROOT,
    env: starterEnv(base),
    timeout: 60_000,
  });
  try {
    const page = await app.firstWindow();
    const item = page.locator(".recent-vaults-list-item", { hasText: "picked-vault" });
    await expect(item).toBeVisible();
    await expect(page.locator(".quick-start-container button")).toBeHidden();
    await page.screenshot({ path: testInfo.outputPath("starter-recent.png") });

    await item.click();
    // vault-open acks true -> the starter renderer window.close()es; the
    // vault window is the survivor.
    await expect
      .poll(
        async () => {
          const titles = await Promise.all(app.windows().map((win) => win.title().catch(() => "")));
          return titles.length;
        },
        { timeout: 15_000 },
      )
      .toBe(1);
    const [vaultWindow] = app.windows();
    await expect(vaultWindow.locator(".workspace")).toBeVisible({ timeout: 15_000 });
  } finally {
    await app.close();
    rmSync(base, { recursive: true, force: true });
  }
});
