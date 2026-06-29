import { expect, test } from "@playwright/test";

test("loads the reconstructed Obsidian shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator(".workspace")).toBeVisible();
});
