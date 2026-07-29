import { existsSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "../fixtures/electronApp";

// DeepChat lesson #2 (their 03-session-persistence): the `launchApp` factory
// makes restart tests one-liners — do something, close, relaunch, assert it
// survived. Here: the workspace layout (an open image tab) must round-trip
// through the vault's .obsidian/workspace.json.
test("restores the open tab across an app restart", async ({ launchApp, vaultPath }) => {
  const first = await launchApp();

  const file = first.page.locator('.nav-file-title[data-path="Pics/pic.png"]');
  if (!(await file.isVisible().catch(() => false))) {
    await first.page.locator(".nav-folder-title", { hasText: "Pics" }).first().click();
  }
  await file.click();
  await expect(first.page.locator(".workspace-leaf.mod-active .image-container img")).toBeVisible({
    timeout: 15_000,
  });

  // The layout save is debounced; give it a beat before killing the app.
  await first.page.waitForTimeout(2_000);
  await first.close();

  // Deliberately NOT asserted here any more: `.obsidian/` in the opened folder.
  // Config lives once under the app's config home and nothing is written into
  // an opened folder (see provideDesktopAdapter in bootstrap.ts), so a
  // workspace.json beside the notes would mean that boundary had broken. What
  // matters is that the layout round-trips at all, which the relaunch below
  // proves end to end.
  expect(existsSync(join(vaultPath, ".obsidian", "workspace.json"))).toBe(false);

  const second = await launchApp();
  await expect(second.page.locator(".workspace-leaf .image-container img").first()).toBeVisible({
    timeout: 20_000,
  });
  await second.close();
});
