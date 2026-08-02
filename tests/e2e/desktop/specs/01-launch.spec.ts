import { expect, test } from "../fixtures/electronApp";

// DeepChat lesson #1: the first smoke is just "the shell comes up" — cheap,
// runs everywhere, and its screenshot is the visual baseline.
test("launches the desktop shell on the seeded vault", async ({ app }, testInfo) => {
  const { page } = app;

  // Both workspace roots are up: Home (the replica) and the seeded mount.
  await expect(page.locator('.nav-folder-title[data-path="Home"]')).toBeVisible();
  await expect(page.locator('.nav-folder-title[data-path="vault"]')).toBeVisible();

  // The seeded files appear in the file tree under the mount.
  await expect(page.locator(".nav-file-title", { hasText: "Note" }).first()).toBeVisible();
  await expect(page.locator(".nav-file-title", { hasText: "Doc" }).first()).toBeVisible();
  await expect(page.locator(".nav-folder-title", { hasText: "Pics" }).first()).toBeVisible();

  await page.screenshot({ path: testInfo.outputPath("launch.png"), fullPage: true });
});
