import { expect, test } from "../fixtures/electronApp";

const widths = () =>
  [...document.querySelectorAll<HTMLElement>(".workspace-tab-header")].map((el) => ({
    inline: el.style.width,
    actual: Math.round(el.getBoundingClientRect().width),
  }));

// Closing a tab locks the remaining widths so the close buttons stay under the
// pointer. Releasing that lock is the part that is easy to get wrong: Obsidian
// eases each header back to its natural width over 250ms, and a natural width
// can only be measured at runtime, so this lives in the JS animator rather
// than app.css. Clearing the inline width instead would snap.
test("tab widths ease back to natural after a close", async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    for (const name of ["Note.md", "Doc.md", "Note.md", "Doc.md"]) {
      const file = app.vault.getFiles().find((f: any) => f.name === name);
      await app.workspace.getLeaf("tab").openFile(file);
    }
  });
  await page.waitForTimeout(1_500);

  const headers = page.locator(".workspace-tab-header");
  const target = headers.nth(2);
  await target.hover();
  await target.locator(".workspace-tab-header-inner-close-button").click();
  await page.waitForTimeout(300);

  // With the pointer still over the bar the surviving widths are pinned inline.
  const locked = (await page.evaluate(widths)).filter((w) => w.inline !== "");
  expect(locked.length).toBeGreaterThan(0);
  const lockedWidth = locked[0].actual;

  // Leaving the bar releases the lock and starts the ease.
  await page.mouse.move(600, 700);
  const samples: number[] = [];
  for (let index = 0; index < 8; index++) {
    samples.push((await page.evaluate(widths))[2].actual);
    await page.waitForTimeout(40);
  }

  await page.waitForTimeout(600);
  const settled = (await page.evaluate(widths))[2];

  // The natural width is wider than the locked one, and the bar passes through
  // it rather than jumping — a snap would show only the two endpoints.
  expect(settled.actual).toBeGreaterThan(lockedWidth);
  const intermediate = samples.filter((w) => w > lockedWidth && w < settled.actual);
  expect(intermediate.length).toBeGreaterThan(0);

  // The animation hands the element back to the stylesheet when it settles.
  expect(settled.inline).toBe("");
  expect(
    await page.evaluate(
      () =>
        document.querySelectorAll<HTMLElement>(".workspace-tab-header")[2].style.transition,
    ),
  ).toBe("");
});
