import { expect, test } from "../fixtures/electronApp";

// Window-level proof for the media pipeline: clicking a png in the file tree
// opens the image VIEW, and a markdown note's ![[...]] embed renders a real
// <img>. `naturalWidth > 0` asserts the bytes actually decoded — i.e. the
// app:// resource protocol served the file, not just that DOM appeared.

test("opens an image from the file tree in the image view", async ({ app }) => {
  const { page } = app;

  await openFromTree(page, "Pics/pic.png");

  const img = page.locator(".workspace-leaf.mod-active .image-container img");
  await expect(img).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
});

test("renders the ![[...]] image embed inside markdown preview", async ({ app }) => {
  const { page } = app;

  await page.locator('.nav-file-title[data-path="Note.md"]').click();
  // Ensure reading view; the default open mode may be the editor.
  await page.evaluate(() => {
    const app = (
      window as unknown as { app: { commands: { executeCommandById(id: string): boolean } } }
    ).app;
    app.commands.executeCommandById("markdown:toggle-preview");
  });

  const embed = page.locator(".internal-embed.image-embed.is-loaded img");
  await expect(embed).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => embed.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(0);
});

// The tree renders folders expanded or collapsed; only toggle when the target
// file is actually hidden (a blind folder click can collapse it).
async function openFromTree(page: import("@playwright/test").Page, path: string): Promise<void> {
  const file = page.locator(`.nav-file-title[data-path="${path}"]`);
  if (!(await file.isVisible().catch(() => false))) {
    await page
      .locator(".nav-folder-title", { hasText: path.split("/")[0] })
      .first()
      .click();
  }
  await file.click();
}
