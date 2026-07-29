import { expect, test } from "../fixtures/electronApp";

// Collapsing the sidebar used to write width and display in the same frame, so
// the pane vanished. Obsidian slides it shut over 140ms. The natural width is
// only known at runtime, so this lives in the JS animator rather than app.css.
test("the sidebar slides shut and back open instead of vanishing", async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  const dockWidth = () =>
    page.evaluate(() => {
      const el = document.querySelector(".workspace-split.mod-left-split") as HTMLElement | null;
      return el ? Math.round(el.getBoundingClientRect().width) : -1;
    });

  const openWidth = await dockWidth();
  expect(openWidth).toBeGreaterThan(0);

  await page.evaluate(() => {
    const app = (window as unknown as { app: any }).app;
    app.workspace.leftSplit.collapse();
  });

  const closing: number[] = [];
  for (let index = 0; index < 8; index++) {
    closing.push(await dockWidth());
    await page.waitForTimeout(20);
  }
  // Passes through a partly-closed width rather than jumping to zero.
  expect(closing.filter((w) => w > 0 && w < openWidth).length).toBeGreaterThan(0);

  await page.waitForTimeout(400);
  expect(await dockWidth()).toBe(0);

  await page.evaluate(() => {
    const app = (window as unknown as { app: any }).app;
    app.workspace.leftSplit.expand();
  });
  const opening: number[] = [];
  for (let index = 0; index < 8; index++) {
    opening.push(await dockWidth());
    await page.waitForTimeout(20);
  }
  expect(opening.filter((w) => w > 0 && w < openWidth).length).toBeGreaterThan(0);

  // And it hands the geometry back: no inline width or overflow left pinned.
  await page.waitForTimeout(400);
  expect(await dockWidth()).toBe(openWidth);
  expect(
    await page.evaluate(
      () =>
        (document.querySelector(".workspace-split.mod-left-split") as HTMLElement).style.overflow,
    ),
  ).toBe("");
});
