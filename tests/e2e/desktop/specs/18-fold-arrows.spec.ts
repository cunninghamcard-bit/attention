import { expect, test } from "../fixtures/electronApp";

// The heading and list fold indicators were built with the right classes but
// no icon was ever injected into them, so the arrow was invisible and the
// rotation app.css drives on .collapse-icon.is-collapsed had nothing to turn.
test("reading-view fold arrows have an icon and rotate when collapsed", async ({ launchApp }) => {
  const { page } = await launchApp();
  await page.waitForSelector(".nav-file-title");

  await page.evaluate(async () => {
    const app = (window as unknown as { app: any }).app;
    const file = await app.vault.create(
      "Home/Fold.md",
      "# Heading\n\nbody\n\n- item one\n  - nested\n",
    );
    const leaf = app.workspace.getLeaf(false);
    await leaf.openFile(file);
  });
  // Invisible until hover or collapsed (app.css opacity:0 default) — wait
  // for it to exist in the DOM, not for it to be visible.
  await page.waitForSelector(".heading-collapse-indicator svg", {
    state: "attached",
    timeout: 30_000,
  });
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => {
    const heading = document.querySelector(".heading-collapse-indicator") as HTMLElement;
    const list = document.querySelector(".list-collapse-indicator") as HTMLElement;
    return {
      headingHasSvg: Boolean(heading.querySelector("svg")),
      listHasSvg: Boolean(list.querySelector("svg")),
      headingRotation: getComputedStyle(heading.querySelector("svg")!).transform,
    };
  });
  expect(before.headingHasSvg).toBe(true);
  expect(before.listHasSvg).toBe(true);

  // The indicator sits in the gutter (app.css positions it outside the
  // heading's own box, like TreeItem's chevron), so it has no hit-testable
  // rect for a real pointer click. Dispatch on the element directly instead.
  await page.evaluate(() => {
    (document.querySelector(".heading-collapse-indicator") as HTMLElement).dispatchEvent(
      new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }),
    );
  });
  await page.waitForTimeout(200);

  const after = await page.evaluate(() => {
    const heading = document.querySelector(".heading-collapse-indicator") as HTMLElement;
    return {
      isCollapsed: heading.classList.contains("is-collapsed"),
      rotation: getComputedStyle(heading.querySelector("svg")!).transform,
    };
  });
  expect(after.isCollapsed).toBe(true);
  expect(after.rotation).not.toBe(before.headingRotation);
});
